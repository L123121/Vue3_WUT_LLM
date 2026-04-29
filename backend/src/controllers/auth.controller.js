const authService = require('../services/auth.service');
const { successResponse } = require('../utils/response');

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      throw new Error('Username and password are required');
    }
    const result = await authService.login(username, password);
    successResponse(res, result, 'Login successful');
  } catch (error) {
    next(error);
  }
};

module.exports = { login };
