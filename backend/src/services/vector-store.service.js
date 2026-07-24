"use strict";

const config = require('../config');
const { EmbeddingService } = require('./embedding.service');

let _sharedMemoryDocs = [];

class VectorStoreService {
  constructor() {
    const vectorConfig = config.vectorStore || {};

    this.backend = vectorConfig.backend || 'milvus';
    this.collectionName = vectorConfig.collectionName || 'wuli_elf_chunks';
    this.address = vectorConfig.milvusAddress || 'localhost:19530';
    this.token = vectorConfig.milvusToken || '';
    this.denseField = vectorConfig.denseField || 'dense_vector';
    this.sparseField = vectorConfig.sparseField || 'sparse_vector';
    this.vectorWeight = vectorConfig.vectorWeight ?? 0.6;
    this.sparseWeight = vectorConfig.sparseWeight ?? 0.4;
    this.bm25Enabled = process.env.VECTOR_STORE_BM25 !== 'false';

    this._milvus = null;
    this._milvusLib = null;
    this._collectionReady = false;
    this._milvusUnavailable = false;
  }

  async addChunks(ids, embeddings, documents, metadatas) {
    if (!ids.length) return;

    const normalizedEmbeddings = embeddings.map(embedding => this._normalizeEmbedding(embedding));
    const sample = normalizedEmbeddings.find(embedding => embedding?.dense?.length);

    if (sample && await this._ensureMilvusCollection(sample)) {
      try {
        await this._insertMilvusRows(ids, normalizedEmbeddings, documents, metadatas);
        return;
      } catch (err) {
        this._markMilvusUnavailable(`[VectorStore] Milvus 写入失败，降级内存模式: ${err.message}`);
      }
    }

    this._addMemoryRows(ids, normalizedEmbeddings, documents, metadatas);
  }

  async search(queryEmbedding, topK = 10, filter = null, queryText = '') {
    const embedding = this._normalizeEmbedding(queryEmbedding);
    if (!embedding?.dense?.length) return [];

    if (await this._canSearchMilvus()) {
      try {
        return await this._searchMilvus(embedding, topK, filter, queryText);
      } catch (err) {
        this._markMilvusUnavailable(`[VectorStore] Milvus 混合检索失败，降级内存模式: ${err.message}`);
      }
    }

    return this._searchMemory(embedding, topK, filter);
  }

  async deleteByDocId(docId) {
    if (await this._canSearchMilvus()) {
      try {
        await this._milvus.delete({
          collection_name: this.collectionName,
          filter: `docId == ${JSON.stringify(docId)} or parentId == ${JSON.stringify(docId)}`,
        });
      } catch (err) {
        this._markMilvusUnavailable(`[VectorStore] Milvus 删除索引失败，继续删除内存索引: ${err.message}`);
      }
    }

    _sharedMemoryDocs = _sharedMemoryDocs.filter(d =>
      d.metadata?.docId !== docId && d.metadata?.parentId !== docId
    );
  }

  async resetCollection() {
    if (await this._canSearchMilvus()) {
      try {
        await this._milvus.dropCollection({ collection_name: this.collectionName });
      } catch (err) {
        if (!/not exist|not found/i.test(err.message)) {
          this._markMilvusUnavailable(`[VectorStore] Milvus 重置 collection 失败: ${err.message}`);
        }
      }
      this._collectionReady = false;
    }

    _sharedMemoryDocs = [];
    console.log(`[VectorStore] 重置 collection: ${this.collectionName}`);
  }

  async count() {
    if (await this._canSearchMilvus()) {
      try {
        const resp = await this._milvus.getCollectionStatistics({ collection_name: this.collectionName });
        const statArrayValue = Array.isArray(resp?.stats)
          ? resp.stats.find(item => item.key === 'row_count')?.value
          : undefined;
        const rowCount = resp?.stats?.row_count ?? resp?.data?.row_count ?? resp?.row_count ?? statArrayValue;
        const parsed = Number(rowCount);
        if (Number.isFinite(parsed)) return parsed;
      } catch (err) {
        this._markMilvusUnavailable(`[VectorStore] Milvus count 失败，返回内存计数: ${err.message}`);
      }
    }
    return _sharedMemoryDocs.length;
  }

  async isAvailable() {
    return await this._canSearchMilvus() || _sharedMemoryDocs.length > 0 || true;
  }

  async _ensureMilvusCollection(sampleEmbedding) {
    if (this.backend === 'memory' || this._milvusUnavailable) return false;
    const client = this._getMilvusClient();
    if (!client) return false;

    try {
      const has = await client.hasCollection({ collection_name: this.collectionName, timeout: 2000 });
      if (!this._statusOk(has)) return false;

      if (!has.value) {
        await this._createMilvusCollection(sampleEmbedding.dense.length);
      }

      await client.loadCollection({ collection_name: this.collectionName }).catch(() => {});
      this._collectionReady = true;
      console.log(`[VectorStore] 使用 Milvus 后端: ${this.address}/${this.collectionName}`);
      return true;
    } catch (err) {
      this._markMilvusUnavailable(`[VectorStore] Milvus 不可用，使用内存模式: ${err.message}`);
      return false;
    }
  }

  async _canSearchMilvus() {
    if (this._collectionReady) return true;
    if (this.backend === 'memory' || this._milvusUnavailable) return false;

    const client = this._getMilvusClient();
    if (!client) return false;

    try {
      const has = await client.hasCollection({ collection_name: this.collectionName, timeout: 2000 });
      if (this._statusOk(has) && has.value) {
        await client.loadCollection({ collection_name: this.collectionName }).catch(() => {});
        this._collectionReady = true;
        console.log(`[VectorStore] 使用 Milvus 后端: ${this.address}/${this.collectionName}`);
        return true;
      }
    } catch (err) {
      this._markMilvusUnavailable(`[VectorStore] Milvus 不可用，使用内存模式: ${err.message}`);
    }
    return false;
  }

  _getMilvusClient() {
    if (this._milvus) return this._milvus;

    try {
      this._milvusLib = require('@zilliz/milvus2-sdk-node');
      const { MilvusClient } = this._milvusLib;
      this._milvus = new MilvusClient({
        address: this.address,
        token: this.token || undefined,
        timeout: 5000,
        maxRetries: 0,
        __SKIP_CONNECT__: true,
      });
      return this._milvus;
    } catch (err) {
      this._markMilvusUnavailable(`[VectorStore] Milvus SDK 不可用，使用内存模式: ${err.message}`);
      return null;
    }
  }

  async _createMilvusCollection(denseDim) {
    const { DataType } = this._milvusLib;
    const fields = [
      { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 256 },
      { name: 'docId', data_type: DataType.VarChar, max_length: 256 },
      { name: 'parentId', data_type: DataType.VarChar, max_length: 256 },
      { name: 'parentText', data_type: DataType.VarChar, max_length: 8192 },
      { name: 'parentIdx', data_type: DataType.Int64 },
      { name: 'title', data_type: DataType.VarChar, max_length: 512 },
      { name: 'category', data_type: DataType.VarChar, max_length: 128 },
      { name: 'chunkIndex', data_type: DataType.Int64 },
      { name: 'text', data_type: DataType.VarChar, max_length: 8192 },
      { name: this.denseField, data_type: DataType.FloatVector, dim: denseDim },
      { name: this.sparseField, data_type: DataType.SparseFloatVector },
    ];

    await this._milvus.createCollection({
      collection_name: this.collectionName,
      fields,
      description: 'WUT RAG child chunks with BGE-small-zh dense + n-gram sparse vectors',
      enable_dynamic_field: false,
    });

    await this._createMilvusIndexes();
    await this._milvus.loadCollectionSync({ collection_name: this.collectionName });
    console.log(`[VectorStore] 创建 Milvus collection: ${this.collectionName} (dense dim=${denseDim})`);
  }

  async _createMilvusIndexes() {
    const { IndexType, MetricType } = this._milvusLib;
    const indexJobs = [
      this._milvus.createIndex({
        collection_name: this.collectionName,
        field_name: this.denseField,
        index_name: `${this.denseField}_idx`,
        index_type: IndexType.AUTOINDEX,
        metric_type: MetricType.COSINE,
      }),
      // sparse_vector 仍然需要索引（BM25 查询层用 BM25 度量，索引层仍用 IP）
      this._milvus.createIndex({
        collection_name: this.collectionName,
        field_name: this.sparseField,
        index_name: `${this.sparseField}_idx`,
        index_type: IndexType.SPARSE_INVERTED_INDEX,
        metric_type: MetricType.IP,
      }),
    ];

    await Promise.all(indexJobs.map(job => job.catch(err => {
      if (!/already|exist/i.test(err.message)) throw err;
    })));
  }

  async _insertMilvusRows(ids, embeddings, documents, metadatas) {
    const data = ids.map((id, index) => {
      const metadata = metadatas[index] || {};
      const embedding = embeddings[index];
      return {
        id,
        docId: String(metadata.docId || ''),
        parentId: String(metadata.parentId || metadata.docId || ''),
        parentText: this._truncate(metadata.parentText || '', 8192),
        parentIdx: Number(metadata.parentIdx ?? -1),
        title: this._truncate(metadata.title || '', 512),
        category: this._truncate(metadata.category || 'general', 128),
        chunkIndex: Number(metadata.chunkIndex ?? index),
        text: this._truncate(documents[index] || '', 8192),
        [this.denseField]: embedding.dense,
        [this.sparseField]: embedding.sparse || {},
      };
    });

    await this._milvus.insert({ collection_name: this.collectionName, data });
    await this._milvus.flush({ collection_names: [this.collectionName] }).catch(() => {});
  }

  async _searchMilvus(embedding, topK, filter, queryText = '') {
    const { MetricType, WeightedRanker } = this._milvusLib;
    const data = [
      {
        anns_field: this.denseField,
        data: embedding.dense,
        metric_type: MetricType.COSINE,
        params: {},
      },
    ];

    // 稀疏检索：n-gram 整数 key 稀疏向量
    if (embedding.sparse && Object.keys(embedding.sparse).length > 0) {
      data.push({
        anns_field: this.sparseField,
        data: embedding.sparse,
        metric_type: MetricType.IP,
        params: {},
      });
    }

    const resp = await this._milvus.hybridSearch({
      collection_name: this.collectionName,
      data,
      limit: topK,
      filter: this._buildMilvusFilter(filter),
      output_fields: ['id', 'docId', 'parentId', 'parentText', 'parentIdx', 'title', 'category', 'chunkIndex', 'text'],
      rerank: WeightedRanker([this.vectorWeight, this.sparseWeight]),
    });

    const rows = Array.isArray(resp?.results?.[0]) ? resp.results.flat() : (resp?.results || []);
    return rows.map(row => this._rowToSearchResult(row, 'milvus_hybrid'));
  }

  _addMemoryRows(ids, embeddings, documents, metadatas) {
    for (let i = 0; i < ids.length; i++) {
      const metadata = metadatas[i] || {};
      _sharedMemoryDocs.push({
        id: ids[i],
        dense: embeddings[i]?.dense || null,
        sparse: embeddings[i]?.sparse || {},
        document: documents[i],
        metadata: {
          ...metadata,
          parentId: metadata.parentId || metadata.docId,
        },
      });
    }
  }

  _searchMemory(embedding, topK, filter) {
    let candidates = _sharedMemoryDocs;
    if (filter) {
      candidates = candidates.filter(doc =>
        Object.entries(filter).every(([key, value]) => doc.metadata?.[key] === value)
      );
    }

    const scored = candidates.map(doc => {
      const denseScore = EmbeddingService.cosineSimilarity(embedding.dense, doc.dense);
      const sparseScore = EmbeddingService.sparseSimilarity(embedding.sparse, doc.sparse);
      const score = this.vectorWeight * denseScore + this.sparseWeight * sparseScore;
      return {
        id: doc.id,
        docId: doc.metadata?.docId || '',
        parentId: doc.metadata?.parentId || doc.metadata?.docId || '',
        parentText: doc.metadata?.parentText || '',
        parentIdx: doc.metadata?.parentIdx ?? -1,
        text: doc.document || '',
        score,
        title: doc.metadata?.title || '',
        category: doc.metadata?.category || '',
        chunkIndex: doc.metadata?.chunkIndex ?? -1,
        _vectorScore: denseScore,
        _sparseScore: sparseScore,
        _hybridScore: score,
        _retrievalChannels: ['vector', 'sparse'],
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  _rowToSearchResult(row, channel) {
    const score = Number(row.score ?? row.distance ?? 0);
    return {
      id: String(row.id || ''),
      docId: row.docId || '',
      parentId: row.parentId || row.docId || '',
      parentText: row.parentText || '',
      parentIdx: row.parentIdx ?? -1,
      text: row.text || '',
      score: Number.isFinite(score) ? score : 0,
      title: row.title || '',
      category: row.category || '',
      chunkIndex: Number(row.chunkIndex ?? -1),
      _vectorScore: Number.isFinite(score) ? score : 0,
      _sparseScore: Number.isFinite(score) ? score : 0,
      _hybridScore: Number.isFinite(score) ? score : 0,
      _retrievalChannels: [channel, 'vector', 'sparse'],
    };
  }

  _normalizeEmbedding(embedding) {
    if (!embedding) return null;
    if (Array.isArray(embedding)) return { dense: embedding, sparse: {} };
    if (Array.isArray(embedding.dense)) {
      return {
        dense: embedding.dense,
        sparse: embedding.sparse || {},
      };
    }
    if (Array.isArray(embedding.embedding)) {
      return {
        dense: embedding.embedding,
        sparse: embedding.sparse || embedding.sparse_vector || {},
      };
    }
    return null;
  }

  _buildMilvusFilter(filter) {
    if (!filter) return undefined;
    return Object.entries(filter)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key} == ${JSON.stringify(String(value))}`)
      .join(' and ') || undefined;
  }

  _statusOk(resp) {
    const status = resp?.status || resp;
    if (!status) return true;
    const code = status.error_code ?? status.code;
    return code === undefined || code === 'Success' || code === 0;
  }

  _markMilvusUnavailable(message) {
    if (!this._milvusUnavailable) console.warn(message);
    this._milvusUnavailable = true;
    this._collectionReady = false;
  }

  _truncate(value, maxLength) {
    return String(value || '').slice(0, maxLength);
  }
}

module.exports = { VectorStoreService };


