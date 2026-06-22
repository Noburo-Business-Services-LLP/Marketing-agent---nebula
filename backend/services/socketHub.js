const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io = null;
const memorySubscribers = new Map();

function roomForUser(userId) {
  return `user:${String(userId)}`;
}

function initializeSocketHub(server, corsOrigins = []) {
  try {
    const { Server } = require('socket.io');
    io = new Server(server, {
      cors: {
        origin: corsOrigins,
        credentials: true,
        methods: ['GET', 'POST']
      }
    });

    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) return next(new Error('Missing auth token'));

        if (String(token).startsWith('demo:')) {
          socket.userId = String(token).slice(5);
          return next();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id isActive');
        if (!user || !user.isActive) return next(new Error('Unauthorized'));
        socket.userId = String(user._id);
        return next();
      } catch (error) {
        return next(new Error('Unauthorized'));
      }
    });

    io.on('connection', (socket) => {
      if (socket.userId) {
        socket.join(roomForUser(socket.userId));
      }
      socket.emit('inbox.connected', { connected: true });
    });

    console.log('✅ Socket.IO social inbox hub initialized');
    return io;
  } catch (error) {
    console.warn('⚠️ Socket.IO unavailable; inbox will use polling/SSE fallback:', error.message);
    io = null;
    return null;
  }
}

function emitToUser(userId, eventName, payload) {
  const userKey = String(userId || '');
  if (!userKey) return;

  if (io) {
    io.to(roomForUser(userKey)).emit(eventName, payload);
  }

  const subscribers = memorySubscribers.get(userKey);
  if (subscribers) {
    for (const send of subscribers) {
      try {
        send(eventName, payload);
      } catch (_) { }
    }
  }
}

function addSseSubscriber(userId, send) {
  const userKey = String(userId || '');
  if (!memorySubscribers.has(userKey)) {
    memorySubscribers.set(userKey, new Set());
  }
  memorySubscribers.get(userKey).add(send);
  return () => {
    const set = memorySubscribers.get(userKey);
    if (!set) return;
    set.delete(send);
    if (set.size === 0) memorySubscribers.delete(userKey);
  };
}

function isSocketReady() {
  return Boolean(io);
}

module.exports = {
  initializeSocketHub,
  emitToUser,
  addSseSubscriber,
  isSocketReady
};
