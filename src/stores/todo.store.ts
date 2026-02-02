import { defineStore } from 'pinia';
import { ref } from 'vue';
import { TodoItem } from '../types/index.ts';

export const useTodoStore = defineStore('todo', () => {
  const todos = ref<TodoItem[]>([
    { id: '1', text: '完成 Vue 3 重构', completed: false, category: 'academic' },
    { id: '2', text: '预约图书馆研讨间', completed: true, category: 'personal' },
    { id: '3', text: '准备 CET-6 考试', completed: false, category: 'urgent' },
    { id: '4', text: '向导师汇报进度', completed: false, category: 'urgent' },
  ]);

  const addTodo = (text: string) => {
    if (!text.trim()) return;
    const newItem: TodoItem = {
      id: Date.now().toString(),
      text,
      completed: false,
      category: 'personal',
    };
    todos.value = [newItem, ...todos.value];
  };

  const toggleTodo = (id: string) => {
    const todo = todos.value.find(t => t.id === id);
    if (todo) todo.completed = !todo.completed;
  };

  const deleteTodo = (id: string) => {
    todos.value = todos.value.filter(t => t.id !== id);
  };

  return { todos, addTodo, toggleTodo, deleteTodo };
});