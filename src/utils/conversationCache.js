/**
 * 统一会话持久化层
 *
 * 缓存按用户隔离：chat_cache:<userId>（未登录为 chat_cache:guest）。
 * 每个账号的未同步消息只存在于自己的命名空间里，重新登录/切换账号
 * 不会读到别人的缓存，也不会在登录时被整体清掉。
 */

const LEGACY_CACHE_KEY = 'chat_cache';
const CACHE_VERSION = 1;
// 缓存大小预算（字符数）：超预算时淘汰最旧会话，防止 localStorage 配额溢出导致全量写入失败
const CACHE_SIZE_BUDGET = 3_000_000;

/**
 * 按用户解析缓存 key。userId 为空（游客态）时使用独立的 guest 命名空间。
 */
export function getCacheKey(userId = null) {
  return userId ? `chat_cache:${userId}` : 'chat_cache:guest';
}

function readCacheAt(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 读取指定用户的完整缓存
 */
export function loadCache(userId = null) {
  return readCacheAt(getCacheKey(userId));
}

/**
 * 保存完整缓存（带容量保护：超过预算时淘汰最旧会话，避免配额溢出后全量丢失）
 *
 * ⚠️ 空列表不落盘：会话列表为空只可能是「重置/登录切换」造成的瞬时状态，
 * 此时缓存里可能还留着同步失败期间未上传的消息（唯一副本），绝不能覆盖。
 */
export function saveCache(conversations, currentId = '', userId = null) {
  if (!Array.isArray(conversations) || conversations.length === 0) return;

  const serialize = (list) => JSON.stringify({
    version: CACHE_VERSION,
    conversations: list,
    currentId,
    updatedAt: new Date().toISOString(),
  });

  try {
    let list = conversations;
    let serialized = serialize(list);
    // 超预算：从最旧的非当前会话开始淘汰，直到体积回落到预算内
    while (serialized.length > CACHE_SIZE_BUDGET && list.length > 1) {
      const candidates = list
        .filter((c) => c.id !== currentId)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      if (candidates.length === 0) break;
      const dropId = candidates[candidates.length - 1].id;
      list = list.filter((c) => c.id !== dropId);
      serialized = serialize(list);
    }
    localStorage.setItem(getCacheKey(userId), serialized);
  } catch (err) {
    console.warn('[Cache] 保存失败 (可能超出 localStorage 配额):', err.message);
  }
}

/**
 * 增量保存：只更新指定会话，合并后全量写入
 */
export function saveIncremental(allConversations, currentId = '', dirtyConvId, userId = null) {
  if (!Array.isArray(allConversations) || allConversations.length === 0) return;

  try {
    const cached = loadCache(userId);
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

    saveCache([...existingMap.values()], currentId, userId);
  } catch (err) {
    console.warn('[Cache] 增量保存失败:', err.message);
  }
}

/**
 * 清空指定用户的缓存（含旧版全局 key）。仅在「已确认同步成功」的登出流程调用，
 * 登录/401 等无法保证同步成功的路径禁止调用，否则会丢失未同步消息的唯一副本。
 */
export function clearCache(userId = null) {
  try { localStorage.removeItem(getCacheKey(userId)); } catch { /* ignore */ }
  try { localStorage.removeItem(LEGACY_CACHE_KEY); } catch { /* ignore */ }
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
