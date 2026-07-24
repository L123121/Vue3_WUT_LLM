"use strict";

const crypto = require('crypto');
const { promisify } = require('util');
const { redis: store } = require('./memory-store');
const config = require('../config');

const scrypt = promisify(crypto.scrypt);
const USERS_KEY = 'auth:users';
const USERS_BY_ID_KEY = 'auth:users_by_id';
const USERNAME_RE = /^[a-zA-Z0-9_.@-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 6;
const BLOCKED_USERNAMES = [
  'admin', 'root', 'system', 'test', 'guest', 'null', 'undefined',
  '管理员', '系统', '测试', '客服',
];

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name || user.username,
    role: user.role || 'user',
    studentId: user.studentId || '',
    approved: user.approved !== false,
    createdAt: user.createdAt,
  };
}

function createAuthError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, passwordHash) {
  const [scheme, salt, expectedHex] = String(passwordHash || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

class AuthService {
  validateRegistration({ username, password, studentId }) {
    const normalizedUsername = normalizeUsername(username);
    if (!USERNAME_RE.test(normalizedUsername)) {
      throw createAuthError('INVALID_USERNAME', '用户名需为 3-32 位，可包含字母、数字、下划线、点、横线或 @');
    }
    if (BLOCKED_USERNAMES.includes(normalizedUsername)) {
      throw createAuthError('INVALID_USERNAME', '该用户名不可用，请换一个');
    }
    if (!password || String(password).length < PASSWORD_MIN_LENGTH) {
      throw createAuthError('INVALID_PASSWORD', `密码至少 ${PASSWORD_MIN_LENGTH} 位`);
    }
    if (studentId && String(studentId).trim().length > 32) {
      throw createAuthError('INVALID_STUDENT_ID', '学号长度不能超过 32 位');
    }
    return normalizedUsername;
  }

  async register({ username, password, studentId }) {
    const normalizedUsername = this.validateRegistration({ username, password, studentId });
    const existing = await store.hget(USERS_KEY, normalizedUsername);
    if (existing) {
      throw createAuthError('USERNAME_EXISTS', '用户名已存在', 409);
    }

    const user = {
      id: `user_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString('hex')}`,
      username: normalizedUsername,
      name: normalizedUsername,
      passwordHash: await hashPassword(password),
      role: 'user',
      studentId: studentId ? String(studentId).trim() : '',
      approved: true,
      createdAt: new Date().toISOString(),
    };

    await store.hset(USERS_KEY, normalizedUsername, user);
    await store.hset(USERS_BY_ID_KEY, user.id, normalizedUsername);
    return publicUser(user);
  }

  async login({ username, password }) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername || !password) {
      throw createAuthError('MISSING_CREDENTIALS', '请输入用户名和密码');
    }

    // 管理员账号：通过统一登录入口验证
    if (normalizedUsername === normalizeUsername(config.admin.username) && password === config.admin.password) {
      return {
        id: 'admin',
        username: config.admin.username || 'admin',
        name: '管理员',
        role: 'admin',
        studentId: '',
        approved: true,
      };
    }

    const user = await store.hget(USERS_KEY, normalizedUsername);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw createAuthError('INVALID_CREDENTIALS', '用户名或密码错误', 401);
    }
    if (user.approved === false) {
      throw createAuthError('ACCOUNT_PENDING', '账号待审核，请联系管理员', 403);
    }

    return publicUser(user);
  }

  async changePassword(userId, currentPassword, newPassword) {
    if (!userId || !currentPassword || !newPassword) {
      throw createAuthError('MISSING_PARAMS', '缺少必要参数');
    }
    if (String(newPassword).length < PASSWORD_MIN_LENGTH) {
      throw createAuthError('INVALID_PASSWORD', `密码至少 ${PASSWORD_MIN_LENGTH} 位`);
    }

    // 管理员不允许通过此接口修改密码
    if (userId === 'admin') {
      throw createAuthError('ADMIN_NOT_ALLOWED', '管理员密码请在环境变量中修改', 403);
    }

    const username = await store.hget(USERS_BY_ID_KEY, userId);
    if (!username) {
      throw createAuthError('USER_NOT_FOUND', '用户不存在', 404);
    }

    const user = await store.hget(USERS_KEY, username);
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw createAuthError('INVALID_CREDENTIALS', '当前密码错误', 401);
    }

    user.passwordHash = await hashPassword(newPassword);
    await store.hset(USERS_KEY, username, user);
    return publicUser(user);
  }

  async getUserById(userId) {
    if (!userId) return null;
    if (userId === 'admin') {
      return {
        id: 'admin',
        username: config.admin.username || 'admin',
        name: '管理员',
        role: 'admin',
        studentId: '',
        approved: true,
      };
    }

    const username = await store.hget(USERS_BY_ID_KEY, userId);
    if (!username) return null;
    const user = await store.hget(USERS_KEY, username);
    return publicUser(user);
  }
}

module.exports = new AuthService();