const jwt = require('jsonwebtoken');

// Mock database
const users = [
  {
    id: 'u1',
    username: '2021001',
    name: '武理学子',
    avatar: 'https://api.dicebear.com/7.x/notionists/svg?seed=Felix',
    role: 'student'
  }
];

const login = async (username, password) => {
  // 验证密码
  if (password !== '123456') {
    throw new Error('Invalid credentials');
  }

  // 查找或创建用户
  const user = users.find(u => u.username === username) || {
    id: `u_${Date.now()}`,
    username,
    name: username || '武理学子',
    avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`,
    role: 'student'
  };

  // 生成 JWT token
  const token = jwt.sign(
    { userId: user.id, username: user.username },
    process.env.JWT_SECRET || 'default_secret_key',
    { expiresIn: '7d' }
  );

  return { user, token };
};

module.exports = { login };
