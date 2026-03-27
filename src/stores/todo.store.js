import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useTodoStore = defineStore('todo', () => {
  const todos = ref([
    { id: '1', text: '学习 Vue 3', completed: false, category: 'academic' },
    { id: '2', text: '预约图书馆研讨间', completed: true, category: 'personal' },
    { id: '3', text: '准备 CET-6 考试', completed: false, category: 'urgent' },
  ]);

  const addTodo = (text) => {
    if (!text.trim()) return;
    todos.value = [{ id: Date.now().toString(), text, completed: false, category: 'personal' }, ...todos.value];
  };

  const toggleTodo = (id) => {
    const todo = todos.value.find((item) => item.id === id);
    if (todo) todo.completed = !todo.completed;
  };

  const deleteTodo = (id) => {
    todos.value = todos.value.filter((item) => item.id !== id);
  };

  return { todos, addTodo, toggleTodo, deleteTodo };
});
