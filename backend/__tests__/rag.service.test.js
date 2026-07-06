import { describe, it, expect, vi, beforeEach } from 'vitest';

function getRagService() {
  delete require.cache[require.resolve('../src/services/rag.service')];
  return require('../src/services/rag.service').RagService;
}

describe('RagService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按 chatdocFileId 精确映射父文档和引用片段', async () => {
    const RagService = getRagService();
    const rag = new RagService({ getCompletion: vi.fn() });

    rag.documentService = {
      getDocumentsByChatdocFileIds: vi.fn().mockResolvedValue(new Map([
        ['file-b', {
          id: 'doc-b',
          title: 'B 文档',
          category: 'library',
          content: 'B 内容',
          chunkCount: 5,
          chatdocFileId: 'file-b',
          metadata: {}
        }],
        ['file-a', {
          id: 'doc-a',
          title: 'A 文档',
          category: 'academic',
          content: 'A 内容',
          chunkCount: 3,
          chatdocFileId: 'file-a',
          metadata: {}
        }]
      ]))
    };

    const result = await rag.assembleParentContext({
      'file-a': [2],
      'file-b': [1, 3]
    });

    expect(rag.documentService.getDocumentsByChatdocFileIds).toHaveBeenCalledWith(['file-a', 'file-b']);
    expect(result.sources.map(s => s.title)).toEqual(['A 文档', 'B 文档']);
    expect(result.sources.map(s => s.matchedChunkIds)).toEqual([[2], [1, 3]]);
    expect(result.context).toContain('【文档 1】A 文档');
    expect(result.context).toContain('【文档 2】B 文档');
  });

  it('查询 ChatDoc 文件时透传 category 并在无来源时返回明确提示', async () => {
    const RagService = getRagService();
    const rag = new RagService({ getCompletion: vi.fn() });

    rag.rerankEnabled = false;
    rag.documentService = {
      getAllChatdocFileIds: vi.fn().mockResolvedValue(['file-library'])
    };
    rag.chatdocService = {
      chat: vi.fn().mockResolvedValue({ content: '不应直接采信的回答', fileRefer: {} })
    };

    const result = await rag.chatdocChat('图书馆几点开门？', [], { category: 'library' });

    expect(rag.documentService.getAllChatdocFileIds).toHaveBeenCalledWith({ category: 'library' });
    expect(rag.chatdocService.chat).toHaveBeenCalledWith(
      ['file-library'],
      [{ role: 'user', content: '图书馆几点开门？' }],
      { category: 'library' }
    );
    expect(result.sources).toEqual([]);
    expect(result.reply).toContain('没有检索到足够可靠的来源');
  });
});
