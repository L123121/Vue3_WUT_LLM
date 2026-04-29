"use strict";

const { ChromaClient } = require('chromadb');
const { v4: uuidv4 } = require('uuid');

class ChromaService {
  constructor() {
    this.client = null;
    this.collection = null;
    this.collectionName = 'knowledge_base';
    this.isConnected = false;
  }

  /**
   * 初始化连接
   * @param {string} host - Chroma 服务地址（默认 localhost:8000）
   */
  async connect(host = 'http://localhost:8000') {
    try {
      this.client = new ChromaClient({ path: host });

      // 测试连接
      await this.client.heartbeat();

      this.isConnected = true;
      console.log('[Chroma] 连接成功:', host);

      // 获取或创建集合
      await this.getOrCreateCollection();

      return true;
    } catch (error) {
      console.error('[Chroma] 连接失败:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * 获取或创建集合
   */
  async getOrCreateCollection() {
    if (!this.client) return null;

    this.collection = await this.client.getOrCreateCollection({
      name: this.collectionName,
      metadata: {
        description: '武理小精灵知识库'
      }
    });

    return this.collection;
  }

  /**
   * 添加文档向量
   * @param {Object[]} documents - 文档数组 [{id, content, embedding, metadata}]
   */
  async addDocuments(documents) {
    if (!this.collection) {
      await this.getOrCreateCollection();
    }

    if (!documents || documents.length === 0) return;

    const ids = documents.map(d => d.id || uuidv4());
    const embeddings = documents.map(d => d.embedding);
    const metadatas = documents.map(d => d.metadata || {});
    const contents = documents.map(d => d.content);

    await this.collection.add({
      ids,
      embeddings,
      metadatas,
      documents: contents
    });

    console.log(`[Chroma] 添加 ${documents.length} 条文档`);
    return ids;
  }

  /**
   * 相似度搜索
   * @param {number[]} queryEmbedding - 查询向量
   * @param {number} topK - 返回结果数量
   * @param {Object} where - 元数据过滤条件
   * @returns {Promise<Object[]>} 相似文档列表
   */
  async search(queryEmbedding, topK = 5, where = null) {
    if (!this.collection) {
      await this.getOrCreateCollection();
    }

    const queryOptions = {
      queryEmbeddings: [queryEmbedding],
      nResults: topK
    };

    if (where) {
      queryOptions.where = where;
    }

    const results = await this.collection.query(queryOptions);

    // 格式化结果
    return results.ids[0].map((id, index) => ({
      id,
      content: results.documents[0][index],
      metadata: results.metadatas[0][index],
      distance: results.distances?.[0]?.[index] || null
    }));
  }

  /**
   * 删除文档
   * @param {string[]} ids - 文档 ID 数组
   */
  async deleteDocuments(ids) {
    if (!this.collection || !ids || ids.length === 0) return;

    await this.collection.delete({ ids });
    console.log(`[Chroma] 删除 ${ids.length} 条文档`);
  }

  /**
   * 根据条件删除文档
   * @param {Object} where - 元数据过滤条件
   */
  async deleteByMetadata(where) {
    if (!this.collection) return;

    await this.collection.delete({ where });
    console.log(`[Chroma] 按条件删除文档`);
  }

  /**
   * 获取集合统计信息
   */
  async getStats() {
    if (!this.collection) {
      await this.getOrCreateCollection();
    }

    const count = await this.collection.count();
    return {
      collectionName: this.collectionName,
      documentCount: count,
      isConnected: this.isConnected
    };
  }

  /**
   * 清空集合
   */
  async clearCollection() {
    if (!this.client) return;

    try {
      await this.client.deleteCollection({ name: this.collectionName });
      this.collection = null;
      await this.getOrCreateCollection();
      console.log('[Chroma] 集合已清空');
    } catch (error) {
      console.error('[Chroma] 清空失败:', error.message);
    }
  }
}

// 单例模式
const chromaService = new ChromaService();

module.exports = { ChromaService, chromaService };
