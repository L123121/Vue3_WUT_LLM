import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useToastStore = defineStore('toast', () => {
  const toasts = ref([]);

  const add = (message, type = 'info', duration = 3000) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const toast = { id, message, type, duration };
    toasts.value.push(toast);

    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
  };

  const remove = (id) => {
    const index = toasts.value.findIndex((toast) => toast.id === id);
    if (index !== -1) toasts.value.splice(index, 1);
  };

  return {
    toasts,
    add,
    remove,
    success: (message, duration) => add(message, 'success', duration),
    error: (message, duration) => add(message, 'error', duration),
    warning: (message, duration) => add(message, 'warning', duration),
    info: (message, duration) => add(message, 'info', duration),
  };
});
