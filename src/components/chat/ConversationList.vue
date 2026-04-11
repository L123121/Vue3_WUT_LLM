<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '../../stores/chat.store';
import { useLanguageStore } from '../../stores/language.store';
import { ChevronDown, ChevronRight, Plus, Check, X, MessageSquare, Edit3, Trash2, Search } from 'lucide-vue-next';
import type { Conversation } from '../../types/index';

const chatStore = useChatStore();
const languageStore = useLanguageStore();
const route = useRoute();
const router = useRouter();

const isExpanded = ref(true);
const editingId = ref<string | null>(null);
const editingTitle = ref('');
const searchQuery = ref('');

const labels = computed(() => {
  if (languageStore.isChinese) {
    return {
      justNow: '刚刚',
      minutesAgo: (value: number) => `${value}分钟前`,
      hoursAgo: (value: number) => `${value}小时前`,
      daysAgo: (value: number) => `${value}天前`,
      title: '会话列表',
      create: '新建会话',
      edit: '编辑标题',
      remove: '删除会话',
      empty: '暂无会话，点击上方 + 新建',
      preview: '点击开始新对话',
      confirmDelete: '确定要删除这个会话吗？',
      searchPlaceholder: '搜索会话标题或消息内容',
      searchEmpty: '没有匹配的会话记录',
      searchResult: (value: number) => `搜索结果 ${value} 条`,
    };
  }

  return {
    justNow: 'Just now',
    minutesAgo: (value: number) => `${value} min ago`,
    hoursAgo: (value: number) => `${value} hr ago`,
    daysAgo: (value: number) => `${value} day ago`,
    title: 'Conversations',
    create: 'New conversation',
    edit: 'Rename',
    remove: 'Delete conversation',
    empty: 'No conversations yet. Click + to create one.',
    preview: 'Start a new conversation',
    confirmDelete: 'Delete this conversation?',
    searchPlaceholder: 'Search title or message content',
    searchEmpty: 'No matched conversations',
    searchResult: (value: number) => `${value} results`,
  };
});

const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase());

const buildMatchedPreview = (text: string, keyword: string) => {
  if (!keyword) return text;
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(keyword);
  if (index === -1) return text;
  const start = Math.max(0, index - 10);
  const end = Math.min(text.length, index + keyword.length + 18);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return `${prefix}${text.slice(start, end)}${suffix}`;
};

const getMatchMeta = (conv: Conversation) => {
  const keyword = normalizedQuery.value;
  if (!keyword) return { matched: true, preview: '' };

  const title = String(conv.title || '');
  if (title.toLowerCase().includes(keyword)) {
    return { matched: true, preview: title };
  }

  const matchedMessage = (conv.messages || []).find((message) => {
    const text = String(message?.text || '').toLowerCase();
    return Boolean(text) && text.includes(keyword);
  });

  if (matchedMessage) {
    return {
      matched: true,
      preview: buildMatchedPreview(String(matchedMessage.text || ''), keyword),
    };
  }

  return { matched: false, preview: '' };
};

const visibleConversations = computed(() => chatStore.sortedConversations.filter((conv) => getMatchMeta(conv).matched));

const formatTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return labels.value.justNow;
  if (minutes < 60) return labels.value.minutesAgo(minutes);
  if (hours < 24) return labels.value.hoursAgo(hours);
  if (days < 7) return labels.value.daysAgo(days);
  return languageStore.formatDate(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const startEdit = (conv: Conversation) => {
  editingId.value = conv.id;
  editingTitle.value = conv.title;
};

const saveEdit = () => {
  if (editingId.value && editingTitle.value.trim()) {
    chatStore.renameConversation(editingId.value, editingTitle.value);
  }
  cancelEdit();
};

const cancelEdit = () => {
  editingId.value = null;
  editingTitle.value = '';
};

const handleCreate = () => {
  chatStore.createConversation();
  if (route.path !== '/chat') {
    router.push('/chat');
  }
};

const handleSwitch = (id: string) => {
  if (editingId.value === id) return;
  chatStore.switchConversation(id);
  if (route.path !== '/chat') {
    router.push('/chat');
  }
};

const handleDelete = (id: string, e: Event) => {
  e.stopPropagation();
  if (confirm(labels.value.confirmDelete)) {
    chatStore.deleteConversation(id);
  }
};

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
};

const getPreview = (conv: Conversation) => {
  const searchPreview = getMatchMeta(conv).preview;
  if (normalizedQuery.value && searchPreview) {
    return searchPreview;
  }

  const preview = chatStore.getLastMessagePreview(conv);
  if (preview === '点击开始新对话') {
    return labels.value.preview;
  }
  return preview;
};
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div
      class="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800 rounded-lg mx-1 transition-colors"
      @click="toggleExpanded"
    >
      <div class="flex items-center gap-2">
        <component
          :is="isExpanded ? ChevronDown : ChevronRight"
          :size="14"
          class="text-slate-400 dark:text-slate-500"
        />
        <span class="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider">
          {{ labels.title }}
        </span>
        <span class="text-[10px] text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
          {{ chatStore.conversations.length }}
        </span>
      </div>
      <button
        @click.stop="handleCreate"
        class="p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all duration-200"
        :title="labels.create"
      >
        <Plus :size="14" />
      </button>
    </div>

    <div
      v-if="isExpanded"
      class="mt-1 px-1.5 pb-2 space-y-1.5 flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent"
    >
      <div class="px-1 pb-1">
        <div class="relative">
          <Search :size="13" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            v-model="searchQuery"
            class="w-full h-8 pl-8 pr-8 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            :placeholder="labels.searchPlaceholder"
          />
          <button
            v-if="searchQuery"
            @click="searchQuery = ''"
            class="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-gray-300"
          >
            <X :size="12" />
          </button>
        </div>
        <p v-if="normalizedQuery" class="mt-1 text-[10px] text-slate-400 dark:text-slate-500 px-1">
          {{ labels.searchResult(visibleConversations.length) }}
        </p>
      </div>

      <div
        v-for="conv in visibleConversations"
        :key="conv.id"
        @click="handleSwitch(conv.id)"
        :class="[
          'group relative flex flex-col px-3.5 py-3 rounded-xl cursor-pointer transition-all duration-200',
          chatStore.currentConversationId === conv.id
            ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
            : 'hover:bg-slate-50 dark:hover:bg-gray-800 border border-transparent'
        ]"
      >
        <div v-if="editingId === conv.id" class="flex items-center gap-2">
          <input
            v-model="editingTitle"
            @click.stop
            @keyup.enter="saveEdit"
            @keyup.escape="cancelEdit"
            class="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-700 border border-slate-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            autofocus
          />
          <button
            @click.stop="saveEdit"
            class="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded"
          >
            <Check :size="14" />
          </button>
          <button
            @click.stop="cancelEdit"
            class="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
          >
            <X :size="14" />
          </button>
        </div>

        <template v-else>
          <div class="flex items-center gap-2">
            <MessageSquare
              :size="14"
              :class="[
                chatStore.currentConversationId === conv.id
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-slate-400 dark:text-slate-500'
              ]"
            />
            <span
              :class="[
                'flex-1 text-sm font-medium truncate',
                chatStore.currentConversationId === conv.id
                  ? 'text-blue-700 dark:text-blue-300'
                  : 'text-slate-700 dark:text-slate-300'
              ]"
            >
              {{ conv.title }}
            </span>

            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                @click.stop="startEdit(conv)"
                class="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                :title="labels.edit"
              >
                <Edit3 :size="12" />
              </button>
              <button
                @click.stop="(e) => handleDelete(conv.id, e)"
                class="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                :title="labels.remove"
              >
                <Trash2 :size="12" />
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between mt-1 pl-5">
            <span class="text-xs text-slate-400 dark:text-slate-500 truncate flex-1 mr-2">
              {{ getPreview(conv) }}
            </span>
            <span class="text-[10px] text-slate-400 dark:text-slate-600 whitespace-nowrap">
              {{ formatTime(conv.updatedAt) }}
            </span>
          </div>
        </template>
      </div>

      <div
        v-if="chatStore.conversations.length === 0"
        class="text-center py-6 text-slate-400 dark:text-slate-600 text-sm"
      >
        {{ labels.empty }}
      </div>

      <div
        v-else-if="normalizedQuery && visibleConversations.length === 0"
        class="text-center py-6 text-slate-400 dark:text-slate-600 text-xs"
      >
        {{ labels.searchEmpty }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: rgb(203 213 225);
  border-radius: 9999px;
}

.dark .scrollbar-thin::-webkit-scrollbar-thumb {
  background-color: rgb(55 65 81);
}
</style>
