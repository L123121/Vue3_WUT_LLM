<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '../../stores/chat.store.js';
import { useLanguageStore } from '../../stores/language.store.js';
import { ChevronDown, ChevronRight, Plus, Check, X, MessageSquare, Edit3, Trash2 } from 'lucide-vue-next';

const chatStore = useChatStore();
const languageStore = useLanguageStore();
const route = useRoute();
const router = useRouter();
const isExpanded = ref(true);
const editingId = ref(null);
const editingTitle = ref('');
const text = computed(() => languageStore.tm('chat'));

const formatTime = (date) => {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return text.value.justNow;
  if (minutes < 60) return languageStore.t('chat.minutesAgo', { count: minutes });
  if (hours < 24) return languageStore.t('chat.hoursAgo', { count: hours });
  if (days < 7) return languageStore.t('chat.daysAgo', { count: days });
  return languageStore.formatDate(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const startEdit = (conv) => { editingId.value = conv.id; editingTitle.value = conv.title; };
const saveEdit = () => {
  if (editingId.value && editingTitle.value.trim()) chatStore.renameConversation(editingId.value, editingTitle.value);
  editingId.value = null;
  editingTitle.value = '';
};
const cancelEdit = () => { editingId.value = null; editingTitle.value = ''; };
const handleCreate = () => { chatStore.createConversation(); if (route.path !== '/chat') router.push('/chat'); };
const handleSwitch = (id) => { if (editingId.value === id) return; chatStore.switchConversation(id); if (route.path !== '/chat') router.push('/chat'); };
const handleDelete = (id, event) => { event.stopPropagation(); if (confirm(text.value.deleteConfirm)) chatStore.deleteConversation(id); };
const getPreview = (conv) => {
  const preview = chatStore.getLastMessagePreview(conv);
  return preview === '点击开始新对话' ? text.value.defaultPreview : preview;
};
</script>

<template>
  <div class="mt-4 border-t border-slate-100 dark:border-gray-800 pt-4">
    <div class="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800 rounded-lg mx-2 transition-colors" @click="isExpanded = !isExpanded">
      <div class="flex items-center gap-2">
        <component :is="isExpanded ? ChevronDown : ChevronRight" :size="14" class="text-slate-400 dark:text-slate-500" />
        <span class="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider">{{ text.listTitle }}</span>
        <span class="text-[10px] text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">{{ chatStore.conversations.length }}</span>
      </div>
      <button @click.stop="handleCreate" class="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all duration-200" :title="text.createConversation">
        <Plus :size="14" />
      </button>
    </div>

    <div v-if="isExpanded" class="mt-1 px-2 space-y-1 max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent">
      <div v-for="conv in chatStore.sortedConversations" :key="conv.id" @click="handleSwitch(conv.id)" :class="['group relative flex flex-col px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200', chatStore.currentConversationId === conv.id ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' : 'hover:bg-slate-50 dark:hover:bg-gray-800 border border-transparent']">
        <div v-if="editingId === conv.id" class="flex items-center gap-2">
          <input v-model="editingTitle" @click.stop @keyup.enter="saveEdit" @keyup.escape="cancelEdit" class="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white" autofocus />
          <button @click.stop="saveEdit" class="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"><Check :size="14" /></button>
          <button @click.stop="cancelEdit" class="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><X :size="14" /></button>
        </div>

        <template v-else>
          <div class="flex items-center gap-2">
            <MessageSquare :size="14" :class="[chatStore.currentConversationId === conv.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500']" />
            <span :class="['flex-1 text-sm font-medium truncate', chatStore.currentConversationId === conv.id ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300']">{{ conv.title }}</span>
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button @click.stop="startEdit(conv)" class="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors" :title="text.editTitle"><Edit3 :size="12" /></button>
              <button @click.stop="(event) => handleDelete(conv.id, event)" class="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors" :title="text.deleteConversation"><Trash2 :size="12" /></button>
            </div>
          </div>
          <div class="flex items-center justify-between mt-1 pl-5">
            <span class="text-xs text-slate-400 dark:text-slate-500 truncate flex-1 mr-2">{{ getPreview(conv) }}</span>
            <span class="text-[10px] text-slate-400 dark:text-slate-600 whitespace-nowrap">{{ formatTime(conv.updatedAt) }}</span>
          </div>
        </template>
      </div>

      <div v-if="chatStore.conversations.length === 0" class="text-center py-6 text-slate-400 dark:text-slate-600 text-sm">{{ text.emptyConversations }}</div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar { width: 4px; }
.scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background-color: rgb(203 213 225); border-radius: 9999px; }
.dark .scrollbar-thin::-webkit-scrollbar-thumb { background-color: rgb(55 65 81); }
</style>
