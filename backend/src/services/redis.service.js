const Redis = require('ioredis');

// Redis 配置
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || '',
  db: process.env.REDIS_DB || 0,
  retryStrategy: (times) => {
    if (times > 3) {
      console.error('Redis 连接失败，超过最大重试次数');
      return null;
    }
    return Math.min(times * 1000, 3000);
  },
};

// 创建 Redis 客户端
const redis = new Redis(redisConfig);

redis.on('connect', () => {
  console.log('✅ Redis 连接成功');
});

redis.on('error', (err) => {
  console.error('❌ Redis 连接错误:', err.message);
});

// 会话过期时间（7天）
const CONVERSATION_TTL = 7 * 24 * 60 * 60;
const CONVERSATION_MAX_MESSAGES = 500;

/**
 * 会话存储服务
 * 数据结构设计：
 * - user:{userId}:conversations -> Set (会话ID列表)
 * - conversation:{convId} -> Hash (会话详情：title, createdAt, updatedAt)
 * - conversation:{convId}:messages -> List (消息列表)
 */
class ConversationStore {
  /**
   * 创建会话
   */
  async createConversation(userId, title = '新会话') {
    const convId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // 使用事务保证原子性
    const pipeline = redis.pipeline();

    // 添加到用户的会话列表
    pipeline.sadd(`user:${userId}:conversations`, convId);

    // 存储会话详情
    pipeline.hset(`conversation:${convId}`, {
      title,
      createdAt: now,
      updatedAt: now,
      userId,
    });

    // 设置过期时间
    pipeline.expire(`conversation:${convId}`, CONVERSATION_TTL);
    pipeline.expire(`conversation:${convId}:messages`, CONVERSATION_TTL);

    await pipeline.exec();

    return {
      id: convId,
      title,
      messages: [],
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * 获取用户所有会话
   */
  async getConversations(userId) {
    // 获取用户的所有会话ID
    const convIds = await redis.smembers(`user:${userId}:conversations`);

    if (!convIds || convIds.length === 0) {
      return [];
    }

    // 批量获取会话详情
    const pipeline = redis.pipeline();
    convIds.forEach((convId) => {
      pipeline.hgetall(`conversation:${convId}`);
    });

    const results = await pipeline.exec();

    const conversations = [];
    for (let i = 0; i < convIds.length; i++) {
      const [err, data] = results[i];
      if (!err && data) {
        conversations.push({
          id: convIds[i],
          title: data.title || '新会话',
          createdAt: new Date(parseInt(data.createdAt)),
          updatedAt: new Date(parseInt(data.updatedAt)),
        });
      }
    }

    // 按更新时间倒序排列
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);

    return conversations;
  }

  /**
   * 获取会话消息
   */
  async getMessages(convId, limit = 100) {
    // 获取最新的 limit 条消息
    const messages = await redis.lrange(`conversation:${convId}:messages`, -limit, -1);

    return messages.map((msg) => {
      try {
        return JSON.parse(msg);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * 获取单个会话详情（含消息）
   */
  async getConversation(userId, convId) {
    // 验证会话归属
    const belongs = await redis.sismember(`user:${userId}:conversations`, convId);
    if (!belongs) {
      return null;
    }

    const [details, messages] = await Promise.all([
      redis.hgetall(`conversation:${convId}`),
      this.getMessages(convId),
    ]);

    if (!details || !details.title) {
      return null;
    }

    return {
      id: convId,
      title: details.title,
      messages,
      createdAt: new Date(parseInt(details.createdAt)),
      updatedAt: new Date(parseInt(details.updatedAt)),
    };
  }

  /**
   * 添加消息
   */
  async addMessage(convId, message) {
    const pipeline = redis.pipeline();

    // 添加消息到列表
    pipeline.rpush(`conversation:${convId}:messages`, JSON.stringify(message));

    // 更新会话时间
    pipeline.hset(`conversation:${convId}`, 'updatedAt', Date.now());

    // 续期会话 TTL
    pipeline.expire(`conversation:${convId}`, CONVERSATION_TTL);
    pipeline.expire(`conversation:${convId}:messages`, CONVERSATION_TTL);

    await pipeline.exec();

    // 限制消息数量，超出时删除最早的消息
    const msgCount = await redis.llen(`conversation:${convId}:messages`);
    if (msgCount > CONVERSATION_MAX_MESSAGES) {
      await redis.ltrim(`conversation:${convId}:messages`, -CONVERSATION_MAX_MESSAGES, -1);
    }
  }

  /**
   * 重命名会话
   */
  async renameConversation(userId, convId, title) {
    const belongs = await redis.sismember(`user:${userId}:conversations`, convId);
    if (!belongs) {
      return false;
    }

    await redis.hset(`conversation:${convId}`, 'title', title);
    return true;
  }

  /**
   * 删除会话
   */
  async deleteConversation(userId, convId) {
    const belongs = await redis.sismember(`user:${userId}:conversations`, convId);
    if (!belongs) {
      return false;
    }

    const pipeline = redis.pipeline();

    // 从用户会话列表移除
    pipeline.srem(`user:${userId}:conversations`, convId);

    // 删除会话详情和消息
    pipeline.del(`conversation:${convId}`);
    pipeline.del(`conversation:${convId}:messages`);

    await pipeline.exec();
    return true;
  }

  /**
   * 清空会话消息
   */
  async clearMessages(userId, convId) {
    const belongs = await redis.sismember(`user:${userId}:conversations`, convId);
    if (!belongs) {
      return false;
    }

    await redis.del(`conversation:${convId}:messages`);
    return true;
  }

  /**
   * 删除用户所有会话
   */
  async deleteAllConversations(userId) {
    const convIds = await redis.smembers(`user:${userId}:conversations`);

    if (!convIds || convIds.length === 0) {
      return;
    }

    const pipeline = redis.pipeline();

    convIds.forEach((convId) => {
      pipeline.del(`conversation:${convId}`);
      pipeline.del(`conversation:${convId}:messages`);
    });

    pipeline.del(`user:${userId}:conversations`);

    await pipeline.exec();
  }
}

module.exports = {
  redis,
  conversationStore: new ConversationStore(),
  CONVERSATION_TTL,
};
