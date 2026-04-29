/**
 * RAG 知识库 API
 */

const API_URL = '/api/rag';

/**
 * 获取文档列表
 */
export const getDocuments = async (params = {}) => {
  const query = new URLSearchParams();
  if (params.category) query.append('category', params.category);
  if (params.page) query.append('page', params.page);
  if (params.limit) query.append('limit', params.limit);

  const response = await fetch(`${API_URL}/documents?${query.toString()}`);
  return response.json();
};

/**
 * 添加文档
 */
export const addDocument = async (doc) => {
  const response = await fetch(`${API_URL}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc)
  });
  return response.json();
};

/**
 * 上传文件（支持 PDF、DOCX、TXT、MD）
 */
export const uploadFile = async (file, category = 'general', title = '') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);
  if (title) formData.append('title', title);

  const response = await fetch(`${API_URL}/documents/upload`, {
    method: 'POST',
    body: formData
  });
  return response.json();
};

/**
 * 批量添加文档
 */
export const addDocuments = async (documents) => {
  const response = await fetch(`${API_URL}/documents/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents })
  });
  return response.json();
};

/**
 * 删除文档
 */
export const deleteDocument = async (id) => {
  const response = await fetch(`${API_URL}/documents/${id}`, {
    method: 'DELETE'
  });
  return response.json();
};

/**
 * 获取文档内容
 */
export const getDocumentContent = async (id) => {
  const response = await fetch(`${API_URL}/documents/${id}`);
  return response.json();
};

/**
 * 获取知识库统计
 */
export const getStats = async () => {
  const response = await fetch(`${API_URL}/stats`);
  return response.json();
};
