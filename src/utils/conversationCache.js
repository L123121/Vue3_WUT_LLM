/**
 * 统一会话持久化层
 *
 * 合并原有的 3 套 localStorage 备份机制为 1 套：
 *   - chat_local_conversations_cache (chatHelpers)
 *   - chat_messages_backup (conversation.store)
 *   - chat_msgs_direct (message.store)
 *
 * 使用版本化 schema，便于未来迁移。
 */

const CACHE_KEY = 'chat_cache';
const CACHE_VERSION = 1;

/**
 * 读取完整缓存
 * @returns {{ version: number, conversations: Array, currentId: string, updatedAt: string } | null}
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
 * @param {Array} conversations
 * @param {string} currentId
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
 * @param {Array} allConversations - 完整的 conversations 数组
 * @param {string} currentId
 * @param {string} [dirtyConvId] - 发生变更的会话 ID（可选）
 */
export function saveIncremental(allConversations, currentId = '', dirtyConvId) {
  try {
    const cached = loadCache();
    const existingMap = new Map((cached?.conversations || []).map(c => [c.id, c]));
    const incomingMap = new Map(allConversations.map(c => [c.id, c]));

    // 合并：新数据覆盖旧数据
    if (dirtyConvId && existingMap.has(dirtyConvId)) {
      const updated = incomingMap.get(dirtyConvId);
      if (updated) {
        existingMap.set(dirtyConvId, updated);
      }
    } else {
      // 全量替换
      incomingMap.forEach((conv, id) => existingMap.set(id, conv));
    }

    // 移除已删除的会话
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
 * 从旧版备份恢复消息（兼容迁移）
 * 检查所有旧 key，将消息合并到 conversations 中
 * @param {Array} conversations
 * @returns {Array} 恢复消息后的 conversations
 */
export function restoreFromLegacyBackups(conversations) {
  const convMap = new Map(conversations.map(c => [c.id, c]));
  let restored = false;

  // 1. 从 chat_messages_backup 恢复
  try {
    const raw = localStorage.getItem('chat_messages_backup');
    if (raw) {
      const backup = JSON.parse(raw);
      if (backup?.messages && Array.isArray(backup.messages) && backup.messages.length > 0) {
        const conv = convMap.get(backup.conversationId);
        if (conv && (!conv.messages || conv.messages.length <= 1)) {
          conv.messages = backup.messages;
          restored = true;
        }
      }
    }
  } catch {
    // 忽略解析失败
  }

  // 2. 从 chat_msgs_direct 恢复
  if (!restored) {
    try {
      const raw = localStorage.getItem('chat_msgs_direct');
      if (raw) {
        const direct = JSON.parse(raw);
        if (direct?.messages && Array.isArray(direct.messages) && direct.messages.length > 0) {
          const conv = convMap.get(direct.conversationId);
          if (conv && (!conv.messages || conv.messages.length <= 1)) {
            conv.messages = direct.messages;
            restored = true;
          }
        }
      }
    } catch {
      // 忽略解析失败
    }
  }

  // 3. 从 chat_local_conversations_cache 恢复（如果新缓存为空）
  if (!restored && conversations.length === 0) {
    try {
      const raw = localStorage.getItem('chat_local_conversations_cache');
      if (raw) {
        const legacy = JSON.parse(raw);
        if (Array.isArray(legacy) && legacy.length > 0) {
          return legacy;
        }
      }
    } catch {
      // 忽略
    }
  }

  if (restored) {
    // 恢复成功后写回新缓存
    saveCache([...convMap.values()], '');
  }

  return [...convMap.values()];
}

/**
 * 迁移旧数据到新缓存后，清理旧 key
 */
export function cleanupLegacyKeys() {
  const legacyKeys = [
    'chat_messages_backup',
    'chat_msgs_direct',
    'chat_local_conversations_cache',
  ];
  for (const key of legacyKeys) {
    try { localStorage.removeItem(key); } catch {
      // ignore
    }
  }
}
