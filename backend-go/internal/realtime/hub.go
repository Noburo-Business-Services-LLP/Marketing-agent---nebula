package realtime

import (
	"encoding/json"
	"sync"

	"github.com/gofiber/contrib/websocket"
)

type Event struct {
	UserID string `json:"-"`
	Type   string `json:"type"`
	Data   any    `json:"data"`
}

type client struct {
	userID string
	conn   *websocket.Conn
	send   chan []byte
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[*client]bool
	register   chan *client
	unregister chan *client
	broadcast  chan Event
}

func NewHub() *Hub {
	return &Hub{
		clients:    map[*client]bool{},
		register:   make(chan *client),
		unregister: make(chan *client),
		broadcast:  make(chan Event, 256),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = true
			h.mu.Unlock()
		case c := <-h.unregister:
			h.mu.Lock()
			if h.clients[c] {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()
		case event := <-h.broadcast:
			payload, _ := json.Marshal(event)
			h.mu.RLock()
			for c := range h.clients {
				if c.userID == event.UserID {
					select {
					case c.send <- payload:
					default:
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) Broadcast(event Event) {
	h.broadcast <- event
}

func (h *Hub) Serve(userID string, conn *websocket.Conn) {
	c := &client{userID: userID, conn: conn, send: make(chan []byte, 32)}
	h.register <- c
	defer func() {
		h.unregister <- c
		_ = conn.Close()
	}()

	go func() {
		for payload := range c.send {
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return
			}
		}
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}
