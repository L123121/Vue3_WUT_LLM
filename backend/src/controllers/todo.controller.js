const todoService = require('../services/todo.service');
const { successResponse, errorResponse } = require('../utils/response');

const getAllTodos = async (req, res, next) => {
  try {
    const userId = 'u1';
    const todos = await todoService.getTodos(userId);
    successResponse(res, todos);
  } catch (error) {
    next(error);
  }
};

const createTodo = async (req, res, next) => {
  try {
    const userId = 'u1';
    const newTodo = await todoService.createTodo(userId, req.body);
    successResponse(res, newTodo, 'Todo created');
  } catch (error) {
    next(error);
  }
};

const toggleTodo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const todo = await todoService.updateTodo(id, { completed: req.body.completed });
    if (!todo) {
      return errorResponse(res, 'Todo not found', 404);
    }
    successResponse(res, todo, 'Todo updated');
  } catch (error) {
    next(error);
  }
};

const deleteTodo = async (req, res, next) => {
  try {
    const { id } = req.params;
    const success = await todoService.deleteTodo(id);
    if (!success) {
      return errorResponse(res, 'Todo not found', 404);
    }
    successResponse(res, null, 'Todo deleted');
  } catch (error) {
    next(error);
  }
};

module.exports = { getAllTodos, createTodo, toggleTodo, deleteTodo };
