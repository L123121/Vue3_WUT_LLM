import { apiGet, apiPost } from './client.js';

/**
 * 对话分享快照 API
 */

/**
 * 创建分享快照，返回 { code, url, createdAt }
 * @param {Object} payload { title, messages }
 */
export const createShareSnapshot = async (payload) => {
  const response = await apiPost('/share', payload);
  if (!response.ok) throw new Error('创建分享失败');
  const data = await response.json();
  return data.data;
};

/**
 * 读取公开分享快照（无需登录）
 * @param {string} code 8 位短码
 */
export const fetchSharedSnapshot = async (code) => {
  const response = await apiGet(`/share/${code}`);
  if (!response.ok) return null;
  const data = await response.json();
  return data.data;
};
