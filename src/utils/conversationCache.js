/**
 * 统一会话持久化层
 *
 * 只维护一套 localStorage 缓存（chat_cache），不再兼容旧版备份。
 */

const CACHE_KEY = 'chat_cache';
const CACHE_VERSION = 1;

/**
 * 读取完整缓存
 */
export function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 保存完整缓存
 */
export function saveCache(conversations, currentId = '') {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: CACHE_VERSION,
      conversations,
      currentId,
      updatedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('[Cache] 保存失败 (可能超出 localStorage 配额):', err.message);
  }
}

/**
 * 增量保存：只更新指定会话，合并后全量写入
 */
export function saveIncremental(allConversations, currentId = '', dirtyConvId) {
  try {
    const cached = loadCache();
    const existingMap = new Map((cached?.conversations || []).map(c => [c.id, c]));
    const incomingMap = new Map(allConversations.map(c => [c.id, c]));

    if (dirtyConvId && existingMap.has(dirtyConvId)) {
      const updated = incomingMap.get(dirtyConvId);
      if (updated) existingMap.set(dirtyConvId, updated);
    } else {
      incomingMap.forEach((conv, id) => existingMap.set(id, conv));
    }

    const incomingIds = new Set(allConversations.map(c => c.id));
    for (const [id] of existingMap) {
      if (!incomingIds.has(id)) existingMap.delete(id);
    }

    saveCache([...existingMap.values()], currentId);
  } catch (err) {
    console.warn('[Cache] 增量保存失败:', err.message);
  }
}

/**
 * 清理旧版 localStorage key（不再需要）
 */
export function cleanupLegacyKeys() {
  const legacyKeys = [
    'chat_messages_backup',
    'chat_msgs_direct',
    'chat_local_conversations_cache',
    'chat_msgs_last',
    'chat_cleared_conversations',
  ];
  for (const key of legacyKeys) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}
