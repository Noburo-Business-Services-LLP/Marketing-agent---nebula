'use strict';
// HTTP-level harness for routes/auth.js: the real router in a tiny express app on a random 127.0.0.1 port, with the
// User model's statics swapped for an in-memory store and the OTP mailer stubbed (codes captured, nothing sent).
// No database, no provider. `restore()` puts every swapped function back.
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');

function createAuthHarness({ seed = [] } = {}) {
  const User = require('../../models/User');
  const otpService = require('../../services/otpService');
  const passwordHash = require('../../services/passwordHash');
  const docs = new Map(); // id -> plain object
  const sent = []; // { email, otp }
  const saved = {};
  const swap = (obj, name, fn) => { if (!(name in saved)) saved[name] = { obj, fn: obj[name] }; obj[name] = fn; };
  const matches = (d, q) => Object.entries(q || {}).every(([k, v]) => (k === '_id' ? String(d._id) === String(v) : d[k] === v));
  const hydrate = (plain) => {
    const doc = User.hydrate({ ...plain });
    doc.save = async function save() {
      if (this.password && !/^\$2[aby]\$/.test(this.password)) { // a plain password was set: hash it like the pre-save hook
        if (!this.isNew) this.tokenVersion = (Number(this.tokenVersion) || 0) + 1;
        this.password = await passwordHash.hash(this.password, { rounds: 10 });
      }
      const obj = this.toObject({ depopulate: true });
      if (obj.otp === undefined || this.otp === undefined) delete obj.otp;
      docs.set(String(this._id), obj);
      return this;
    };
    return doc;
  };
  const query = (find) => {
    const q = {
      select() { return q; }, lean() { q.isLean = true; return q; },
      then(res, rej) { return Promise.resolve().then(() => { const d = find(); return d ? (q.isLean ? { ...d } : hydrate(d)) : null; }).then(res, rej); }
    };
    return q;
  };
  const applyUpdate = (d, u) => {
    const set = u.$set || (u.$inc ? {} : u);
    for (const [k, v] of Object.entries(set)) {
      if (k.startsWith('$')) continue;
      const parts = k.split('.'); let at = d;
      for (let i = 0; i < parts.length - 1; i += 1) { at[parts[i]] = at[parts[i]] || {}; at = at[parts[i]]; }
      at[parts[parts.length - 1]] = v;
    }
    for (const [k, v] of Object.entries(u.$inc || {})) {
      const parts = k.split('.'); let at = d;
      for (let i = 0; i < parts.length - 1; i += 1) { at[parts[i]] = at[parts[i]] || {}; at = at[parts[i]]; }
      at[parts[parts.length - 1]] = (Number(at[parts[parts.length - 1]]) || 0) + v;
    }
  };

  swap(User, 'findOne', (q) => query(() => [...docs.values()].find((d) => matches(d, q)) || null));
  swap(User, 'findById', (id) => query(() => docs.get(String(id)) || null));
  swap(User, 'exists', async (q) => ([...docs.values()].some((d) => matches(d, q)) ? { _id: 1 } : null));
  swap(User, 'updateOne', async (f, u) => { const d = [...docs.values()].find((x) => matches(x, f)); if (d) applyUpdate(d, u); return { matchedCount: d ? 1 : 0 }; });
  swap(User, 'findByIdAndUpdate', async (id, u) => { const d = docs.get(String(id)); if (d) applyUpdate(d, u); return d ? hydrate(d) : null; });
  swap(User, 'create', async (obj) => { const doc = hydrate({ _id: new mongoose.Types.ObjectId(), ...obj }); doc.isNew = true; await doc.save(); doc.isNew = false; return doc; });
  swap(otpService, 'sendOTP', async (email, otp) => { sent.push({ email, otp }); return { id: 'stub' }; });

  async function addUser(fields) {
    const _id = fields._id || new mongoose.Types.ObjectId();
    const password = fields.password ? await passwordHash.hash(fields.password, { rounds: 10 }) : undefined;
    const d = { isActive: true, isVerified: true, firstName: 'Zz', tokenVersion: 0, ...fields, _id, password };
    docs.set(String(_id), d);
    return d;
  }

  let server = null;
  async function start({ router = require('../../routes/auth'), before = [] } = {}) {
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    for (const mw of before) app.use(mw);
    app.use('/api/auth', router);
    server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    return `http://127.0.0.1:${server.address().port}`;
  }

  function call(base, p, { method = 'POST', body, token, ip, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const u = new URL(base + p);
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { 'X-Forwarded-For': ip } : {}),
        ...headers
      } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ } resolve({ status: res.statusCode, body: json, text }); });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async function restore() {
    for (const [name, { obj, fn }] of Object.entries(saved)) obj[name] = fn;
    if (server) await new Promise((r) => server.close(r));
  }

  return { docs, sent, addUser, start, call, restore, User };
}

module.exports = { createAuthHarness };
