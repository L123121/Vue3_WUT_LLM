"use strict";

const fs = require('fs');
const path = require('path');

/**
 * 存储层 — 自动选择后端
 *
 * 有 REDIS_URL 环境变量 → RedisStore（生产环境）
 * 无 REDIS_URL          → MemoryStore（本地开发）
 *
 * 导出接口不变：{ redis, conversationStore }
 */

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

// ========== 本地开发：文件持久化内存存储 ==========

class MemoryStore {
  constructor() {
    this._data = new Map();
    this._sets = new Map();
    this._saveTimer = null;
    this._dirty = false;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const json = JSON.parse(raw);
      if (json._data) this._data = new Map(Object.entries(json._data));
      if (json._sets) {
        this._sets = new Map(
          Object.entries(json._sets).map(([k, v]) => [k, new Set(v)])
        );
      }
      console.log('[Store] Data restored from local JSON file.');
    } catch (e) {
      console.warn('[Store] Failed to read local JSON store:', e.message);
    }
  }

  _scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      try {
        if (!this._dirty) return;
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const json = JSON.stringify({
          _data: Object.fromEntries(this._data),
          _sets: Object.fromEntries([...this._sets].map(([k, v]) => [k, [...v]])),
        });
        fs.writeFileSync(DATA_FILE, json, 'utf-8');
        this._dirty = false;
      } catch (e) {
        console.error('[Store] 持久化写入失败:', e.message);
      }
      this._saveTimer = null;
    }, 200);
  }

  pipeline() {
    const ops = [];
    const exec = async () => {
      const results = [];
      for (const [cmd, args] of ops) {
        try { results.push([null, await this[cmd](...args)]); }
        catch (e) { results.push([e, null]); }
      }
      return results;
    };
    return {
      sadd: (k, v) => ops.push(['sadd', [k, v]]),
      srem: (k, v) => ops.push(['srem', [k, v]]),
      smembers: (k) => ops.push(['smembers', [k]]),
      scard: (k) => ops.push(['scard', [k]]),
      hset: (k, ...args) => ops.push(['hset', [k, ...args]]),
      hdel: (k, f) => ops.push(['hdel', [k, f]]),
      hgetall: (k) => ops.push(['hgetall', [k]]),
      hget: (k, f) => ops.push(['hget', [k, f]]),
      rpush: (k, v) => ops.push(['rpush', [k, v]]),
      lrange: (k, start, end) => ops.push(['lrange', [k, start, end]]),
      llen: (k) => ops.push(['llen', [k]]),
      ltrim: (k, start, end) => ops.push(['ltrim', [k, start, end]]),
      del: (k) => ops.push(['del', [k]]),
      expire: () => {},
      exec,
    };
  }

  async sadd(key, value) {
    if (!this._sets.has(key)) this._sets.set(key, new Set());
    this._sets.get(key).add(value);
    this._scheduleSave();
    return 1;
  }

  async srem(key, value) {
    const set = this._sets.get(key);
    if (!set) return 0;
    set.delete(value);
    this._scheduleSave();
    return 1;
  }

  async smembers(key) {
    const set = this._sets.get(key);
    return set ? [...set] : [];
  }

  async scard(key) {
    const set = this._sets.get(key);
    return set ? set.size : 0;
  }

  async sismember(key, value) {
    const set = this._sets.get(key);
    return set ? set.has(value) : false;
  }

  async hset(key, ...args) {
    if (!this._data.has(key)) this._data.set(key, {});
    const obj = this._data.get(key);
    if (args.length === 1 && typeof args[0] === 'object') {
      Object.assign(obj, args[0]);
    } else {
      for (let i = 0; i < args.length; i += 2) obj[args[i]] = args[i + 1];
    }
    this._scheduleSave();
    return args.length / 2;
  }

  async hgetall(key) { return this._data.get(key) || null; }

  async hget(key, field) {
    const obj = this._data.get(key);
    return obj ? obj[field] : null;
  }

  async hdel(key, field) {
    const obj = this._data.get(key);
    if (!obj || !(field in obj)) return 0;
    delete obj[field];
    this._scheduleSave();
    return 1;
  }

  async rpush(key, value) {
    if (!this._data.has(key)) this._data.set(key, []);
    this._data.get(key).push(value);
    this._scheduleSave();
    return 1;
  }

  async lrange(key, start, end) {
    const list = this._data.get(key) || [];
    if (end === -1) return list.slice(start);
    return list.slice(start, end + 1);
  }

  async llen(key) {
    const list = this._data.get(key);
    return list ? list.length : 0;
  }

  async ltrim(key, start, end) {
    const list = this._data.get(key);
    if (!list) return;
    this._data.set(key, end === -1 ? list.slice(start) : list.slice(start, end + 1));
    this._scheduleSave();
  }

  async del(key) {
    this._data.delete(key);
    this._sets.delete(key);
    this._scheduleSave();
    return 1;
  }

  async expire() { /* no-op */ }

  get status() { return 'ready'; }
}

// ========== 选择后端 ==========

let store;
const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
  const { RedisStore } = require('./redis-store');
  store = new RedisStore(REDIS_URL);
  console.log('[Store] 使用 Redis Cloud');
} else {
  store = new MemoryStore();
  console.log('[Store] 使用本地内存存储（开发模式）');
}

// ========== 会话管理 ==========

const createConversationId = () =>
  `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

class ConversationStore {
  _getKey(userId) { return `conversations:${userId}`; }

  _normalizeConversation(conversation = {}) {
    const now = new Date().toISOString();
    return {
      id: String(conversation.id || createConversationId()),
      title: String(conversation.title || '新会话'),
      messages: Array.isArray(conversation.messages) ? conversation.messages : [],
      createdAt: conversation.createdAt || now,
      updatedAt: conversation.updatedAt || now,
    };
  }

  async getConversations(userId) {
    const all = await store.hgetall(this._getKey(userId));
    if (!all) return [];
    return Object.values(all)
      .map((raw) => {
        try { return this._normalizeConversation(typeof raw === 'string' ? JSON.parse(raw) : raw); }
        catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  async getConversation(userId, conversationId) {
    const raw = await store.hget(this._getKey(userId), String(conversationId));
    if (!raw) return null;
    try { return this._normalizeConversation(typeof raw === 'string' ? JSON.parse(raw) : raw); }
    catch { return null; }
  }

  async createConversation(userId, title = '新会话') {
    const conversation = this._normalizeConversation({
      title: title && String(title).trim() ? String(title).trim() : '新会话',
      messages: [],
    });
    await store.hset(this._getKey(userId), conversation.id, conversation);
    return conversation;
  }

  async saveConversation(userId, conversationId, updates = {}) {
    const existing = await this.getConversation(userId, conversationId);
    if (!existing) return null;
    const next = this._normalizeConversation({
      ...existing,
      ...(updates.title !== undefined ? { title: String(updates.title || '').trim() || existing.title } : {}),
      ...(updates.messages !== undefined ? { messages: Array.isArray(updates.messages) ? updates.messages : existing.messages } : {}),
      updatedAt: new Date().toISOString(),
    });
    await store.hset(this._getKey(userId), next.id, next);
    return next;
  }

  async renameConversation(userId, conversationId, title) {
    return !!(await this.saveConversation(userId, conversationId, { title }));
  }

  async clearMessages(userId, conversationId) {
    return !!(await this.saveConversation(userId, conversationId, { messages: [] }));
  }

  async deleteConversation(userId, conversationId) {
    return (await store.hdel(this._getKey(userId), String(conversationId))) > 0;
  }
}

const conversationStore = new ConversationStore();

module.exports = { redis: store, conversationStore };
