import { describe, it, expect, vi } from 'vitest';

const { WorkingMemory } = require('../src/services/working-memory.service');

describe('WorkingMemory 持久化', () => {
  it('endTurn 触发 onPersist 回调，输出包含已记录的步骤', async () => {
    const persisted = [];
    const wm = new WorkingMemory({ conversationId: 'conv_test_1' });
    wm.onPersist = (json) => { persisted.push(json); return Promise.resolve(); };

    wm.startTurn();
    wm.recordStep('query_grades', { semester: '2025-2026-1' }, '共 5 条成绩');
    wm.writeNote('初步分析：绩点偏高', '初步分析');
    wm.endTurn();

    // onPersist 是异步触发，等一个微任务
    await new Promise((r) => setTimeout(r, 0));

    expect(persisted).toHaveLength(1);
    expect(persisted[0].conversationId).toBe('conv_test_1');
    expect(persisted[0].turns).toHaveLength(1);
    const steps = persisted[0].turns[0].steps;
    // 一条工具调用 + 一条笔记
    expect(steps.some(s => s.tool === 'query_grades')).toBe(true);
    expect(steps.some(s => s.tool === '_note' && s.isNote)).toBe(true);
  });

  it('fromJSON 往返保留 turns 与步骤', () => {
    const wm = new WorkingMemory({ conversationId: 'conv_test_2' });
    wm.startTurn();
    wm.recordStep('query_course_schedule', { week: 3 }, '本周课表');
    wm.endTurn();

    const json = wm.toJSON();
    const restored = WorkingMemory.fromJSON(json);

    expect(restored.conversationId).toBe('conv_test_2');
    expect(restored.turns).toHaveLength(1);
    expect(restored.turns[0].steps[0].tool).toBe('query_course_schedule');
  });

  it('onPersist 抛错时不影响主流程（仅告警）', async () => {
    const wm = new WorkingMemory({ conversationId: 'conv_test_3' });
    wm.onPersist = () => Promise.reject(new Error('redis down'));

    // 不应抛出
    expect(() => wm.endTurn()).not.toThrow();
    // 给 rejected promise 一个 tick，让 catch 跑完（避免 unhandledRejection 污染其他用例）
    await new Promise((r) => setTimeout(r, 0));
  });

  it('无 onPersist 时 endTurn 安全', () => {
    const wm = new WorkingMemory({ conversationId: 'conv_test_4' });
    wm.startTurn();
    wm.recordStep('calculate', { expression: '1+1' }, '2');
    expect(() => wm.endTurn()).not.toThrow();
  });
});

describe('WorkingMemoryStore', () => {
  it('load 未命中返回 null', async () => {
    const { workingMemoryStore } = require('../src/services/working-memory-store');
    // 本地开发无 Redis，底层为 MemoryStore；未写入的 key 返回 null
    const result = await workingMemoryStore.load('conv_nonexistent_' + Math.random());
    expect(result).toBeNull();
  });

  it('save → load 往返一致（内存后端）', async () => {
    const { workingMemoryStore } = require('../src/services/working-memory-store');
    const id = 'conv_persist_' + Math.random().toString(36).slice(2);
    const payload = { conversationId: id, turns: [{ id: 't1', steps: [{ tool: 'query_grades' }] }] };

    await workingMemoryStore.save(id, payload);
    const loaded = await workingMemoryStore.load(id);

    expect(loaded).toBeTruthy();
    expect(loaded.conversationId).toBe(id);
    expect(loaded.turns[0].steps[0].tool).toBe('query_grades');

    await workingMemoryStore.delete(id);
    const after = await workingMemoryStore.load(id);
    expect(after).toBeNull();
  });
});
