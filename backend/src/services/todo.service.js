// In-memory storage for demonstration
let todos = [
  {
    id: '1',
    text: '完成 Vue 3 重构',
    completed: false,
    category: 'academic',
    userId: 'u1',
    createdAt: new Date()
  },
  {
    id: '2',
    text: '预约图书馆研讨间',
    completed: true,
    category: 'personal',
    userId: 'u1',
    createdAt: new Date()
  }
];

const getTodos = async (userId) => {
  return todos.filter(t => t.userId === userId);
};

const createTodo = async (userId, data) => {
  const newTodo = {
    id: Date.now().toString(),
    text: data.text || '',
    completed: false,
    category: data.category || 'personal',
    userId,
    createdAt: new Date()
  };
  todos.unshift(newTodo);
  return newTodo;
};

const updateTodo = async (id, updates) => {
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return undefined;
  todos[index] = { ...todos[index], ...updates };
  return todos[index];
};

const deleteTodo = async (id) => {
  const initialLength = todos.length;
  todos = todos.filter(t => t.id !== id);
  return todos.length !== initialLength;
};

module.exports = { getTodos, createTodo, updateTodo, deleteTodo };
