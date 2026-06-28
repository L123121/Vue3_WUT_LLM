import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟 memory-store
vi.mock('../src/services/memory-store', () => {
  const store = new Map();
  const sets = new Map();
  return {
    redis: {
      sadd: vi.fn(async (k, v) => {
        if (!sets.has(k)) sets.set(k, new Set());
        sets.get(k).add(v); return 1;
      }),
      srem: vi.fn(async (k, v) => { const s = sets.get(k); if (s) { s.delete(v); return 1; } return 0; }),
      smembers: vi.fn(async (k) => [...(sets.get(k) || [])]),
      scard: vi.fn(async (k) => (sets.get(k) || new Set()).size),
      sismember: vi.fn(async (k, v) => (sets.get(k) || new Set()).has(v)),
      hset: vi.fn(async (k, ...args) => {
        if (!store.has(k)) store.set(k, {});
        const obj = store.get(k);
        if (args.length === 1 && typeof args[0] === 'object') Object.assign(obj, args[0]);
        else for (let i = 0; i < args.length; i += 2) obj[args[i]] = args[i + 1];
        return args.length / 2;
      }),
      hgetall: vi.fn(async (k) => store.get(k) || null),
      hget: vi.fn(async (k, f) => (store.get(k) || {})[f] || null),
      hdel: vi.fn(async (k, f) => { delete (store.get(k) || {})[f]; return 1; }),
      rpush: vi.fn(async (k, v) => {
        if (!store.has(k)) store.set(k, []);
        store.get(k).push(v); return 1;
      }),
      lrange: vi.fn(async (k, start, end) => {
        const list = store.get(k) || [];
        return end === -1 ? list.slice(start) : list.slice(start, end + 1);
      }),
      llen: vi.fn(async (k) => (store.get(k) || []).length),
      ltrim: vi.fn(async (k, start, end) => {
        const list = store.get(k);
        if (!list) return;
        store.set(k, end === -1 ? list.slice(start) : list.slice(start, end + 1));
      }),
      del: vi.fn(async (k) => { store.delete(k); sets.delete(k); return 1; }),
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
          exec: async () => ops.map(() => [null, 'OK']),
        };
      }),
    },
  };
});

describe('MemoryService', () => {
  let MemoryService;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete require.cache[require.resolve('../src/services/memory.service')];
    MemoryService = (require('../src/services/memory.service')).MemoryService;
  });

  describe('短期记忆', () => {
    it('保存并获取短期记忆', async () => {
      const ms = new MemoryService();
      await ms.saveShortTerm('user1', '用户查询了成绩');
      const result = await ms.getShortTerm('user1');
      expect(result).toContain('用户查询了成绩');
    });

    it('多次保存只保留最近5条', async () => {
      const ms = new MemoryService();
      for (let i = 1; i <= 7; i++) await ms.saveShortTerm('user1', `记忆第${i}条`);
      const result = await ms.getShortTerm('user1');
      const lines = result.split('\n').filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(5);
      expect(result).not.toContain('记忆第1条');
      expect(result).toContain('记忆第7条');
    });

    it('清空短期记忆', async () => {
      const ms = new MemoryService();
      await ms.saveShortTerm('user1', '测试');
      await ms.clearShortTerm('user1');
      expect(await ms.getShortTerm('user1')).toBe('');
    });

    it('无记忆返回空字符串', async () => {
      const ms = new MemoryService();
      expect(await ms.getShortTerm('nonexistent')).toBe('');
    });
  });

  describe('长期记忆', () => {
    it('添加并获取长期记忆', async () => {
      const ms = new MemoryService();
      const entry = await ms.addLongTerm('user1', { type: 'preference', content: '简洁回答' });
      expect(entry.id).toMatch(/^mem_/);
      expect(entry.type).toBe('preference');
    });

    it('超过50条自动截断', async () => {
      const ms = new MemoryService();
      for (let i = 0; i < 55; i++) await ms.addLongTerm('user1', { type: 'fact', content: `记忆${i}` });
      expect((await ms.getLongTerm('user1')).length).toBeLessThanOrEqual(50);
    });

    it('按关键词匹配排序', async () => {
      const ms = new MemoryService();
      await ms.addLongTerm('user1', { type: 'fact', content: '计算机专业' });
      await ms.addLongTerm('user1', { type: 'fact', content: '数学成绩好' });
      await ms.addLongTerm('user1', { type: 'fact', content: '喜欢物理' });
      const result = await ms.getLongTerm('user1', '数学');
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].content).toContain('数学');
    });

    it('删除长期记忆', async () => {
      const ms = new MemoryService();
      const entry = await ms.addLongTerm('user1', { type: 'fact', content: '待删除' });
      await ms.removeLongTerm('user1', entry.id);
      expect((await ms.getLongTerm('user1')).find(m => m.id === entry.id)).toBeUndefined();
    });

    it('清空长期记忆', async () => {
      const ms = new MemoryService();
      await ms.addLongTerm('user1', { type: 'fact', content: '测试' });
      await ms.clearLongTerm('user1');
      expect(await ms.getLongTerm('user1')).toEqual([]);
    });
  });

  describe('用户画像', () => {
    it('更新并获取', async () => {
      const ms = new MemoryService();
      await ms.updateProfile('user1', { name: '张三', major: '计算机' });
      const profile = await ms.getProfile('user1');
      expect(profile.name).toBe('张三');
      expect(profile.major).toBe('计算机');
      expect(profile.updatedAt).toBeTruthy();
    });

    it('合并画像', async () => {
      const ms = new MemoryService();
      await ms.updateProfile('user1', { name: '张三' });
      await ms.updateProfile('user1', { grade: '2021级' });
      const profile = await ms.getProfile('user1');
      expect(profile.name).toBe('张三');
      expect(profile.grade).toBe('2021级');
    });

    it('不存在的用户返回空对象', async () => {
      const ms = new MemoryService();
      expect(await ms.getProfile('nonexistent')).toEqual({});
    });
  });

  describe('记忆上下文构建', () => {
    it('构建完整上下文', async () => {
      const ms = new MemoryService();
      await ms.updateProfile('user1', { name: '李四', major: '软件工程' });
      await ms.addLongTerm('user1', { type: 'preference', content: '喜欢Python' });
      await ms.saveShortTerm('user1', '讨论了项目');
      const context = await ms.buildMemoryContext('user1', 'Python');
      expect(context).toContain('用户信息');
      expect(context).toContain('相关记忆');
      expect(context).toContain('近期对话');
    });

    it('无 userId 返回空', async () => {
      expect(await (new MemoryService()).buildMemoryContext(null)).toBe('');
    });

    it('无数据返回空', async () => {
      expect(await (new MemoryService()).buildMemoryContext('newuser')).toBe('');
    });
  });

  describe('自动记忆提取', () => {
    it('提取偏好', async () => {
      const ms = new MemoryService();
      await ms.extractAndSave('user1', '我喜欢简洁回答', '好的');
      const mems = await ms.getLongTerm('user1');
      expect(mems.some(m => m.type === 'preference')).toBe(true);
    });

    it('提取画像', async () => {
      const ms = new MemoryService();
      await ms.extractAndSave('user1', '我是计算机学院的学生', '你好！');
      // 画像通过 updateProfile 存入 hash，不是 long-term list
      const profile = await ms.getProfile('user1');
      expect(profile.college).toBe('计算机学院');
    });

    it('提取关键问答', async () => {
      const ms = new MemoryService();
      await ms.extractAndSave('user1', '我成绩如何？', '你的成绩是95分，在班级中排名第3，表现优秀，继续保持良好的学习状态！');
      expect((await ms.getLongTerm('user1')).some(m => m.type === 'qa')).toBe(true);
    });
  });

  describe('统计', () => {
    it('getStats 返回各维度计数', async () => {
      const ms = new MemoryService();
      await ms.saveShortTerm('user1', '摘要');
      await ms.addLongTerm('user1', { type: 'fact', content: '事实' });
      await ms.updateProfile('user1', { name: '测试' });
      const stats = await ms.getStats('user1');
      expect(stats).toHaveProperty('shortTermCount');
      expect(stats).toHaveProperty('longTermCount');
      expect(stats).toHaveProperty('profileFields');
    });
  });
});
