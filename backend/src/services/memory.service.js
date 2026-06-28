"use strict";

const { redis: store } = require('./memory-store');
const { ShortTermMemory } = require('./memory/short-term-memory');
const { LongTermMemory } = require('./memory/long-term-memory');
const { UserProfile } = require('./memory/user-profile');
const { parseRedisList } = require('./memory/helpers');

/**
 * MemoryService — Agent 记忆系统（语义检索版）
 *
 * 三层记忆架构：
 * 1. 短期记忆 (short-term): 当前会话上下文压缩
 * 2. 长期记忆 (long-term): 跨会话持久化，支持语义检索 + 关键词混合匹配
 * 3. 用户画像 (profile): 自动从对话中提取
 *
 * 检索策略：embedding 语义相似度 + 关键词匹配，加权排序
 */

const MAX_LONG_TERM_CHARS = 8000;

class MemoryService {
  constructor() {
    this.shortTerm = new ShortTermMemory();
    this.longTerm = new LongTermMemory();
    this.profile = new UserProfile();
  }

  // ==================== 短期记忆（委托） ====================

  async saveShortTerm(userId, summary) {
    return this.shortTerm.save(userId, summary);
  }

  async getShortTerm(userId) {
    return this.shortTerm.get(userId);
  }

  async clearShortTerm(userId) {
    return this.shortTerm.clear(userId);
  }

  // ==================== 长期记忆（委托） ====================

  async addLongTerm(userId, memory) {
    return this.longTerm.add(userId, memory);
  }

  async getLongTerm(userId, query) {
    return this.longTerm.get(userId, query);
  }

  async removeLongTerm(userId, memoryId) {
    return this.longTerm.remove(userId, memoryId);
  }

  async clearLongTerm(userId) {
    return this.longTerm.clear(userId);
  }

  // ==================== 用户画像（委托） ====================

  async updateProfile(userId, profile) {
    return this.profile.update(userId, profile);
  }

  async getProfile(userId) {
    return this.profile.get(userId);
  }

  // ==================== 上下文注入 ====================

  async buildMemoryContext(userId, currentMessage = '') {
    if (!userId) return '';
    const parts = [];

    // 用户画像
    const profile = await this.getProfile(userId);
    const profileFields = Object.entries(profile)
      .filter(([k]) => !k.startsWith('updatedAt') && !k.startsWith('createdAt'))
      .map(([k, v]) => `- ${k}: ${v}`);
    if (profileFields.length > 0) {
      parts.push(`[用户信息]\n${profileFields.join('\n')}`);
    }

    // 长期记忆（语义检索 TOP 5）
    const longTerm = await this.getLongTerm(userId, currentMessage);
    if (longTerm.length > 0) {
      const topMemories = longTerm.slice(0, 5);
      const memText = topMemories
        .filter(m => m._score > 0.15)
        .map(m => `- [${m.type}] ${m.content}`)
        .join('\n');
      if (memText) {
        parts.push(`[相关记忆]\n${memText}`);
      }
    }

    // 短期记忆
    const shortTerm = await this.getShortTerm(userId);
    if (shortTerm) {
      parts.push(`[近期对话]\n${shortTerm}`);
    }

    if (parts.length === 0) return '';
    const context = parts.join('\n\n');
    return context.length > MAX_LONG_TERM_CHARS
      ? context.substring(0, MAX_LONG_TERM_CHARS) + '\n...'
      : context;
  }

  // ==================== 自动记忆提取 ====================

  async extractAndSave(userId, userMessage, aiReply) {
    if (!userId || !userMessage) return;

    // 1. 提取用户画像
    await this.profile.extract(userId, userMessage);

    // 2. 提取关键问答（包含具体数据）
    if (aiReply && aiReply.length > 30 && aiReply.length < 3000) {
      const hasSpecificData = /\d{4}[-/]\d{2}|成绩|课表|考试|学分|绩点|GPA|教室|图书馆/.test(aiReply);
      if (hasSpecificData) {
        await this.addLongTerm(userId, {
          type: 'qa',
          content: `用户问：${userMessage}\n回答：${aiReply.substring(0, 500)}`,
          source: 'conversation',
          confidence: 0.7,
        });
      }
    }

    // 3. 提取用户偏好
    const prefPatterns = [
      /我喜欢|我偏好|我习惯|请用|请以|我更(喜欢|倾向|愿意)/,
      /我不喜欢|我不爱|不要|别给/,
    ];
    for (const pattern of prefPatterns) {
      if (pattern.test(userMessage)) {
        await this.addLongTerm(userId, {
          type: 'preference',
          content: userMessage,
          source: 'conversation',
          confidence: 0.6,
        });
        break;
      }
    }
  }

  // ==================== 统计 ====================

  async getStats(userId) {
    const profile = await this.getProfile(userId);
    const shortTermRaw = await store.lrange(`memory:${userId}:short_term`, 0, -1);
    const longTermRaw = await store.lrange(`memory:${userId}:long_term`, 0, -1);

    const shortTermList = parseRedisList(shortTermRaw);
    const longTermList = parseRedisList(longTermRaw);

    return {
      shortTermCount: shortTermList.length,
      longTermCount: longTermList.length,
      embeddingCount: longTermList.filter(m => m.embedding).length,
      profileFields: Object.keys(profile).length,
      embedderAvailable: this.longTerm.embedder.isAvailable,
    };
  }
}

module.exports = { MemoryService };
