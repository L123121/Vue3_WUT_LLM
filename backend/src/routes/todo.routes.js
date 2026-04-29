const { Router } = require('express');
const todoController = require('../controllers/todo.controller');

const router = Router();
router.get('/', todoController.getAllTodos);
router.post('/', todoController.createTodo);
router.patch('/:id', todoController.toggleTodo);
router.delete('/:id', todoController.deleteTodo);

module.exports = router;
