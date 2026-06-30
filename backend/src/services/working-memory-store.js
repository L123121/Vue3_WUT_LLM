"use strict";

/**
 * WorkingMemoryStore — 工作记忆持久化
 *
 * 把 WorkingMemory 的 turns 序列化到存储层（Redis 生产 / 内存本地），
 * 用 conversationId 做 key。解决进程重启 / 容器 redeploy 后多步分析
 * 上下文蒸发的问题；多实例部署时同一 conversationId 也能共享。
 *
 * TTL 与 AgentService 的 WM_TTL 对齐（30 分钟），每次保存续期。
 * 无 REDIS_URL 时底层退化为 MemoryStore（同进程内存），行为与原实现一致。
 */
const { redis: store } = require('./memory-store');

const WM_TTL_SECONDS = 30 * 60; // 30 分钟，与 AgentService.WM_TTL 对齐

class WorkingMemoryStore {
  _key(conversationId) {
    return `wm:${conversationId}`;
  }

  /**
   * 加载工作记忆
   * @param {string} conversationId
   * @returns {Promise<Object|null>} WorkingMemory.toJSON() 结构，未找到返回 null
   */
  async load(conversationId) {
    if (!conversationId) return null;
    try {
      const raw = await store.hget(this._key(conversationId), 'data');
      if (!raw) return null;
      // hget 已反序列化（RedisStore）/ 直接是对象（MemoryStore）
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      console.warn('[WMStore] 加载工作记忆失败:', err.message);
      return null;
    }
  }

  /**
   * 保存工作记忆（覆盖写 + 续期 TTL）
   * @param {string} conversationId
   * @param {Object} json — WorkingMemory.toJSON() 的输出
   */
  async save(conversationId, json) {
    if (!conversationId) return;
    try {
      await store.hset(this._key(conversationId), 'data', json);
      // 续期：每次保存重置 TTL（RedisStore 支持 expire；MemoryStore 是 no-op）
      await store.expire(this._key(conversationId), WM_TTL_SECONDS);
    } catch (err) {
      console.warn('[WMStore] 保存工作记忆失败:', err.message);
    }
  }

  /**
   * 删除工作记忆
   * @param {string} conversationId
   */
  async delete(conversationId) {
    if (!conversationId) return;
    try {
      await store.del(this._key(conversationId));
    } catch (err) {
      console.warn('[WMStore] 删除工作记忆失败:', err.message);
    }
  }
}

const workingMemoryStore = new WorkingMemoryStore();

module.exports = { WorkingMemoryStore, workingMemoryStore };
