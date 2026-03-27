<script setup>
import { ref, computed } from 'vue';
import { useTodoStore } from '../stores/todo.store.js';
import { useLanguageStore } from '../stores/language.store.js';
import { Plus, Trash2, Calendar, Tag, Check } from 'lucide-vue-next';

const todoStore = useTodoStore();
const languageStore = useLanguageStore();
const text = computed(() => languageStore.tm('todo'));
const newText = ref('');

const handleAdd = () => {
  todoStore.addTodo(newText.value);
  newText.value = '';
};

const getCategoryColor = (cat) => {
  switch(cat) {
    case 'academic': return 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300';
    case 'urgent': return 'bg-rose-100 text-rose-600 dark:bg-rose-900 dark:text-rose-300';
    default: return 'bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-300';
  }
};

const getCategoryLabel = (cat) => {
  if (cat === 'academic') return text.value.academic;
  if (cat === 'urgent') return text.value.urgent;
  return text.value.personal;
};
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6 animate-fade-in">
    <div class="flex justify-between items-end">
      <div>
        <h2 class="text-2xl font-bold text-slate-800 dark:text-white transition-colors duration-300">{{ text.title }}</h2>
        <p class="text-slate-500 dark:text-gray-400 transition-colors duration-300">{{ text.subtitle }}</p>
      </div>
      <div class="text-sm font-medium text-slate-600 dark:text-gray-300 bg-white dark:bg-gray-800 px-3 py-1 rounded-full shadow-sm border dark:border-gray-700 transition-all duration-300">
        {{ text.completed }}: {{ todoStore.todos.filter(t => t.completed).length }} / {{ todoStore.todos.length }}
      </div>
    </div>

    <div class="bg-white dark:bg-gray-900 p-2 rounded-xl shadow-lg shadow-slate-200/50 dark:shadow-black/20 flex items-center border border-slate-100 dark:border-gray-800 transition-all duration-300 ease-in-out">
      <input
        type="text"
        v-model="newText"
        @keydown.enter="handleAdd"
        :placeholder="text.placeholder"
        class="flex-1 px-4 py-3 outline-none text-slate-700 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 bg-transparent"
      />
      <button
        @click="handleAdd"
        class="bg-green-600 hover:bg-green-700 text-white p-3 rounded-lg transition-colors mr-1 shadow-md shadow-green-500/20"
      >
        <Plus :size="20" />
      </button>
    </div>

    <div class="space-y-3">
      <div
        v-for="todo in todoStore.todos"
        :key="todo.id"
        :class="['group flex items-center bg-white dark:bg-gray-900 p-4 rounded-xl transition-all duration-300 border', todo.completed ? 'border-transparent bg-slate-50 dark:bg-gray-800/50 opacity-75' : 'border-slate-100 dark:border-gray-800 shadow-sm hover:shadow-md hover:border-green-200 dark:hover:border-green-900/50']"
      >
        <button
          @click="todoStore.toggleTodo(todo.id)"
          :class="['w-6 h-6 rounded-full border-2 flex items-center justify-center mr-4 transition-colors duration-300', todo.completed ? 'bg-green-500 border-green-500' : 'border-slate-300 dark:border-gray-600 hover:border-green-500']"
        >
          <Check v-if="todo.completed" class="w-4 h-4 text-white" />
        </button>

        <div class="flex-1">
          <span :class="['text-base transition-colors duration-300', todo.completed ? 'line-through text-slate-400 dark:text-gray-500' : 'text-slate-800 dark:text-gray-200 font-medium']">
            {{ todo.text }}
          </span>
          <div class="flex items-center mt-1 space-x-3">
            <span :class="['text-xs px-2 py-0.5 rounded flex items-center transition-colors duration-300', getCategoryColor(todo.category)]">
              <Tag :size="10" class="mr-1" />
              {{ getCategoryLabel(todo.category) }}
            </span>
            <span class="text-xs text-slate-400 dark:text-gray-500 flex items-center transition-colors duration-300">
              <Calendar :size="10" class="mr-1" /> {{ text.today }}
            </span>
          </div>
        </div>

        <button
          @click="todoStore.deleteTodo(todo.id)"
          class="text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 p-2 opacity-0 group-hover:opacity-100 transition-all duration-300"
        >
          <Trash2 :size="18" />
        </button>
      </div>
      <div v-if="todoStore.todos.length === 0" class="text-center py-12 text-slate-400 dark:text-gray-500 transition-colors duration-300">
        <p>{{ text.empty }}</p>
      </div>
    </div>
  </div>
</template>
