import { apiGet, apiPost, apiDelete } from './client.js';

/**
 * 学校教务系统 API 封装
 */
export const schoolApi = {
  // 获取绑定状态
  getStatus: () => apiGet('/school/status').then(res => res.json()),

  // 绑定教务账号
  bind: (studentId, password) => apiPost('/school/bind', { studentId, password }).then(res => res.json()),

  // 解绑教务账号
  unbind: () => apiDelete('/school/bind').then(res => res.json()),

  // 教务直接登录
  login: (studentId, password) => apiPost('/school/login', { studentId, password }).then(res => res.json()),

  // 查询成绩
  getGrades: (semester) => {
    const query = semester ? `?semester=${semester}` : '';
    return apiGet(`/school/grades${query}`).then(res => res.json());
  },

  // 查询课表
  getSchedule: (semester) => {
    const query = semester ? `?semester=${semester}` : '';
    return apiGet(`/school/schedule${query}`).then(res => res.json());
  },

  // 查询考试安排
  getExams: (semester) => {
    const query = semester ? `?semester=${semester}` : '';
    return apiGet(`/school/exams${query}`).then(res => res.json());
  },

  // 获取可用学期列表
  getSemesters: () => apiGet('/school/semesters').then(res => res.json())
};
