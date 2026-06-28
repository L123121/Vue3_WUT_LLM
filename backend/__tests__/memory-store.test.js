import { describe, it, expect, beforeEach, vi } from 'vitest';

// ==================== MemoryStore 模拟 ====================
const memStore = { store: new Map(), sets: new Map() };

const memRedis = {
  sadd: vi.fn(async (k, v) => {
    if (!memStore.sets.has(k)) memStore.sets.set(k, new Set());
    memStore.sets.get(k).add(v); return 1;
  }),
  srem: vi.fn(async (k, v) => { const s = memStore.sets.get(k); if (s) { s.delete(v); return 1; } return 0; }),
  smembers: vi.fn(async (k) => [...(memStore.sets.get(k) || [])]),
  scard: vi.fn(async (k) => (memStore.sets.get(k) || new Set()).size),
  sismember: vi.fn(async (k, v) => (memStore.sets.get(k) || new Set()).has(v)),
  hset: vi.fn(async (k, ...args) => {
    if (!memStore.store.has(k)) memStore.store.set(k, {});
    const obj = memStore.store.get(k);
    if (args.length === 1 && typeof args[0] === 'object') Object.assign(obj, args[0]);
    else for (let i = 0; i < args.length; i += 2) obj[args[i]] = args[i + 1];
    return args.length / 2;
  }),
  hget: vi.fn(async (k, f) => {
    const obj = memStore.store.get(k);
    return obj ? (obj[f] ?? null) : null;
  }),
  hgetall: vi.fn(async (k) => memStore.store.get(k) || null),
  hdel: vi.fn(async (k, f) => {
    const obj = memStore.store.get(k);
    if (obj) delete obj[f];
    return 1;
  }),
  rpush: vi.fn(async (k, v) => {
    if (!memStore.store.has(k)) memStore.store.set(k, []);
    memStore.store.get(k).push(v); return 1;
  }),
  lrange: vi.fn(async (k, start, end) => {
    const list = memStore.store.get(k) || [];
    return end === -1 ? list.slice(start) : list.slice(start, end + 1);
  }),
  llen: vi.fn(async (k) => (memStore.store.get(k) || []).length),
  ltrim: vi.fn(async (k, start, end) => {
    const list = memStore.store.get(k);
    if (!list) return;
    memStore.store.set(k, end === -1 ? list.slice(start) : list.slice(start, end + 1));
  }),
  del: vi.fn(async (k) => { memStore.store.delete(k); memStore.sets.delete(k); return 1; }),
  expire: vi.fn(async () => {}),
  pipeline: vi.fn(() => {
    const ops = [];
    return {
      sadd: (k, v) => ops.push(['sadd', [k, v]]),
      srem: (k, v) => ops.push(['srem', [k, v]]),
      smembers: (k) => ops.push(['smembers', [k]]),
      scard: (k) => ops.push(['scard', [k]]),
      hset: (k, ...a) => ops.push(['hset', [k, ...a]]),
      hdel: (k, f) => ops.push(['hdel', [k, f]]),
      hgetall: (k) => ops.push(['hgetall', [k]]),
      rpush: (k, v) => ops.push(['rpush', [k, v]]),
      lrange: (k, s, e) => ops.push(['lrange', [k, s, e]]),
      llen: (k) => ops.push(['llen', [k]]),
      ltrim: (k, s, e) => ops.push(['ltrim', [k, s, e]]),
      del: (k) => ops.push(['del', [k]]),
      expire: () => {},
      exec: async () => {
        const results = [];
        for (const [cmd, args] of ops) {
          try {
            const result = await runRedisCmd(cmd, args, memRedis, memStore);
            results.push([null, result]);
          } catch (err) {
            results.push([err, null]);
          }
        }
        return results;
      },
    };
  }),
};

// ==================== ConversationStore 模拟 ====================
const convStoreData = { store: new Map() };

const convStore = {
  createConversation: vi.fn(async (userId, title = '新会话') => {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conv = {
      id,
      title: String(title).trim() || '新会话',
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const key = `conv:${userId}`;
    const existing = convStoreData.store.get(key) || [];
    existing.push(conv);
    convStoreData.store.set(key, existing);
    return conv;
  }),
  getConversations: vi.fn(async (userId) => {
    const list = convStoreData.store.get(`conv:${userId}`) || [];
    return [...list].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }),
  getConversation: vi.fn(async (userId, convId) => {
    const list = convStoreData.store.get(`conv:${userId}`) || [];
    return list.find(c => c.id === convId) || null;
  }),
  saveConversation: vi.fn(async (userId, convId, updates = {}) => {
    const list = convStoreData.store.get(`conv:${userId}`) || [];
    const idx = list.findIndex(c => c.id === convId);
    if (idx === -1) return null;
    const existing = list[idx];
    const next = {
      ...existing,
      ...(updates.title !== undefined ? { title: String(updates.title || '').trim() || existing.title } : {}),
      ...(updates.messages !== undefined ? { messages: Array.isArray(updates.messages) ? updates.messages : existing.messages } : {}),
      updatedAt: new Date().toISOString(),
    };
    list[idx] = next;
    convStoreData.store.set(`conv:${userId}`, list);
    return next;
  }),
  renameConversation: vi.fn(async (userId, convId, title) => {
    const updated = await convStore.saveConversation(userId, convId, { title });
    return !!updated;
  }),
  clearMessages: vi.fn(async (userId, convId) => {
    const list = convStoreData.store.get(`conv:${userId}`) || [];
    const idx = list.findIndex(c => c.id === convId);
    if (idx === -1) return false;
    list[idx] = { ...list[idx], messages: [], updatedAt: new Date().toISOString() };
    convStoreData.store.set(`conv:${userId}`, list);
    return true;
  }),
  deleteConversation: vi.fn(async (userId, convId) => {
    const list = convStoreData.store.get(`conv:${userId}`) || [];
    const idx = list.findIndex(c => c.id === convId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    convStoreData.store.set(`conv:${userId}`, list);
    return true;
  }),
};

// ==================== 辅助函数 ====================
async function runRedisCmd(cmd, args, redis, data) {
  switch (cmd) {
    case 'sadd': return redis.sadd(...args);
    case 'srem': return redis.srem(...args);
    case 'smembers': return redis.smembers(...args);
    case 'scard': return redis.scard(...args);
    case 'sismember': return redis.sismember(...args);
    case 'hset': return redis.hset(...args);
    case 'hdel': return redis.hdel(...args);
    case 'hget': return redis.hget(...args);
    case 'hgetall': return redis.hgetall(...args);
    case 'rpush': return redis.rpush(...args);
    case 'lrange': return redis.lrange(...args);
    case 'llen': return redis.llen(...args);
    case 'ltrim': return redis.ltrim(...args);
    case 'del': return redis.del(...args);
    case 'expire': return redis.expire(...args);
    default: throw new Error(`Unknown command: ${cmd}`);
  }
}

// ==================== MemoryStore 测试 ====================

describe('MemoryStore (memory-store.js)', () => {
  beforeEach(() => {
    memStore.store.clear();
    memStore.sets.clear();
    vi.clearAllMocks();
  });

  describe('Set 操作', () => {
    it('sadd 添加元素到集合', async () => {
      await memRedis.sadd('test:set', 'a');
      await memRedis.sadd('test:set', 'b');
      expect(await memRedis.smembers('test:set')).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('srem 从集合删除元素', async () => {
      await memRedis.sadd('test:set', 'a');
      await memRedis.sadd('test:set', 'b');
      await memRedis.srem('test:set', 'a');
      expect(await memRedis.smembers('test:set')).toEqual(['b']);
    });

    it('scard 返回集合大小', async () => {
      await memRedis.sadd('test:set', 'a');
      await memRedis.sadd('test:set', 'b');
      expect(await memRedis.scard('test:set')).toBe(2);
    });

    it('sismember 检查元素是否存在', async () => {
      await memRedis.sadd('test:set', 'x');
      expect(await memRedis.sismember('test:set', 'x')).toBe(true);
      expect(await memRedis.sismember('test:set', 'y')).toBe(false);
    });
  });

  describe('Hash 操作', () => {
    it('hset / hget / hgetall', async () => {
      await memRedis.hset('test:hash', 'name', '张三');
      await memRedis.hset('test:hash', 'age', '20');
      expect(await memRedis.hget('test:hash', 'name')).toBe('张三');
      expect(await memRedis.hget('test:hash', 'age')).toBe('20');
      expect(await memRedis.hgetall('test:hash')).toEqual({ name: '张三', age: '20' });
    });

    it('hdel 删除字段', async () => {
      await memRedis.hset('test:hash', 'a', '1');
      await memRedis.hset('test:hash', 'b', '2');
      await memRedis.hdel('test:hash', 'a');
      expect(await memRedis.hget('test:hash', 'a')).toBeNull();
      expect(await memRedis.hget('test:hash', 'b')).toBe('2');
    });

    it('不存在的 hash 返回 null', async () => {
      expect(await memRedis.hgetall('nonexistent')).toBeNull();
    });
  });

  describe('List 操作', () => {
    it('rpush / lrange / llen', async () => {
      await memRedis.rpush('test:list', 'a');
      await memRedis.rpush('test:list', 'b');
      await memRedis.rpush('test:list', 'c');
      expect(await memRedis.llen('test:list')).toBe(3);
      expect(await memRedis.lrange('test:list', 0, -1)).toEqual(['a', 'b', 'c']);
    });

    it('ltrim 截断列表', async () => {
      await memRedis.rpush('test:list', 'a');
      await memRedis.rpush('test:list', 'b');
      await memRedis.rpush('test:list', 'c');
      await memRedis.ltrim('test:list', 0, 1);
      expect(await memRedis.lrange('test:list', 0, -1)).toEqual(['a', 'b']);
    });
  });

  describe('Key 操作', () => {
    it('del 删除 key', async () => {
      await memRedis.hset('test:key', 'field', 'value');
      await memRedis.del('test:key');
      expect(await memRedis.hgetall('test:key')).toBeNull();
    });
  });

  describe('pipeline', () => {
    it('批量执行命令', async () => {
      const pipe = memRedis.pipeline();
      pipe.sadd('pipeline:set', 'a');
      pipe.sadd('pipeline:set', 'b');
      pipe.smembers('pipeline:set');
      pipe.scard('pipeline:set');

      const results = await pipe.exec();
      results.forEach(([err]) => expect(err).toBeNull());
      expect(results[2][1]).toEqual(expect.arrayContaining(['a', 'b']));
      expect(results[3][1]).toBe(2);
    });
  });
});

// ==================== ConversationStore 测试 ====================

describe('ConversationStore (memory-store.js)', () => {
  beforeEach(() => {
    convStoreData.store.clear();
    vi.clearAllMocks();
  });

  it('创建会话', async () => {
    const conv = await convStore.createConversation('user1', '测试会话');
    expect(conv.id).toBeTruthy();
    expect(conv.title).toBe('测试会话');
    expect(conv.messages).toEqual([]);
    expect(conv.createdAt).toBeTruthy();
  });

  it('创建会话使用默认标题', async () => {
    const conv = await convStore.createConversation('user1');
    expect(conv.title).toBe('新会话');
  });

  it('获取会话列表', async () => {
    const conv1 = await convStore.createConversation('user1', '会话A');
    await new Promise(r => setTimeout(r, 10));
    const conv2 = await convStore.createConversation('user1', '会话B');
    const list = await convStore.getConversations('user1');
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe('会话B');
    expect(list[1].title).toBe('会话A');
  });

  it('获取单个会话', async () => {
    const conv = await convStore.createConversation('user1', '单独会话');
    const found = await convStore.getConversation('user1', conv.id);
    expect(found).toBeTruthy();
    expect(found.title).toBe('单独会话');
  });

  it('不存在的会话返回 null', async () => {
    expect(await convStore.getConversation('user1', 'nonexistent')).toBeNull();
  });

  it('保存/更新会话', async () => {
    const conv = await convStore.createConversation('user1', '旧标题');
    await new Promise(r => setTimeout(r, 10));
    const updated = await convStore.saveConversation('user1', conv.id, { title: '新标题' });
    expect(updated.title).toBe('新标题');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(conv.updatedAt).getTime());
  });

  it('重命名会话', async () => {
    const conv = await convStore.createConversation('user1', '原名');
    expect(await convStore.renameConversation('user1', conv.id, '新名字')).toBe(true);
    const found = await convStore.getConversation('user1', conv.id);
    expect(found.title).toBe('新名字');
  });

  it('清空会话消息', async () => {
    const conv = await convStore.createConversation('user1', '测试');
    await convStore.saveConversation('user1', conv.id, {
      messages: [{ role: 'user', content: '你好' }]
    });
    expect(await convStore.clearMessages('user1', conv.id)).toBe(true);
    const found = await convStore.getConversation('user1', conv.id);
    expect(found.messages).toEqual([]);
  });

  it('删除会话', async () => {
    const conv = await convStore.createConversation('user1', '待删除');
    expect(await convStore.deleteConversation('user1', conv.id)).toBe(true);
    expect(await convStore.getConversation('user1', conv.id)).toBeNull();
  });

  it('用户之间隔离', async () => {
    await convStore.createConversation('userA', 'A的会话');
    await convStore.createConversation('userB', 'B的会话');
    const listA = await convStore.getConversations('userA');
    expect(listA).toHaveLength(1);
    expect(listA[0].title).toBe('A的会话');
    const listB = await convStore.getConversations('userB');
    expect(listB).toHaveLength(1);
    expect(listB[0].title).toBe('B的会话');
  });
});
