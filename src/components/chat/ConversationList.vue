<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useChatStore } from '../../stores/chat.store';
import { useLanguageStore } from '../../stores/language.store';
import { ChevronDown, ChevronRight, Plus, Check, X, MessageSquare, Edit3, Trash2, Search, AlertTriangle } from 'lucide-vue-next';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';

const chatStore = useChatStore();
const languageStore = useLanguageStore();
const route = useRoute();
const router = useRouter();

const isExpanded = ref(true);
const editingId = ref(null);
const editingTitle = ref('');
const searchQuery = ref('');

// 删除确认弹窗状态
const showDeleteConfirm = ref(false);
const deletingConversationId = ref(null);
const deletingConversationTitle = ref('');

// 虚拟滚动配置
const ITEM_SIZE = 72; // 每个会话项的高度（像素）
const MIN_ITEMS_FOR_VIRTUAL = 20; // 超过此数量启用虚拟滚动

const labels = computed(() => ({
  justNow: '刚刚',
  minutesAgo: (value) => `${value}分钟前`,
  hoursAgo: (value) => `${value}小时前`,
  daysAgo: (value) => `${value}天前`,
  title: '会话列表',
  create: '新建会话',
  edit: '编辑标题',
  remove: '删除会话',
  empty: '暂无会话，点击上方 + 新建',
  preview: '点击开始新对话',
  confirmDelete: '确定要删除这个会话吗？',
  confirmDeleteTitle: '删除会话',
  confirmDeleteWarning: '删除后将无法恢复，该会话的所有消息都将丢失。',
  confirmDeleteButton: '确认删除',
  cancelButton: '取消',
  searchPlaceholder: '搜索会话标题或消息内容',
  searchEmpty: '没有匹配的会话记录',
  searchResult: (value) => `搜索结果 ${value} 条`,
}));

const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase());

// 是否启用虚拟滚动
const shouldUseVirtualScroll = computed(() => {
  return visibleConversations.value.length > MIN_ITEMS_FOR_VIRTUAL;
});

const buildMatchedPreview = (text, keyword) => {
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

const getMatchMeta = (conv) => {
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

const formatTime = (date) => {
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

const startEdit = (conv) => {
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

const handleSwitch = (id) => {
  if (editingId.value === id) return;
  chatStore.switchConversation(id);
  if (route.path !== '/chat') {
    router.push('/chat');
  }
};

// 打开删除确认弹窗
const openDeleteConfirm = (conv, e) => {
  e.stopPropagation();
  deletingConversationId.value = conv.id;
  deletingConversationTitle.value = conv.title;
  showDeleteConfirm.value = true;
};

// 确认删除
const confirmDelete = () => {
  if (deletingConversationId.value) {
    chatStore.deleteConversation(deletingConversationId.value);
  }
  closeDeleteConfirm();
};

// 关闭删除确认弹窗
const closeDeleteConfirm = () => {
  showDeleteConfirm.value = false;
  deletingConversationId.value = null;
  deletingConversationTitle.value = '';
};

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
};

const getPreview = (conv) => {
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

// 检查会话是否正在编辑
const isEditing = (convId) => editingId.value === convId;
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div
      class="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
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
      class="mt-1 flex-1 min-h-0 overflow-hidden flex flex-col"
    >
      <div class="pb-1 shrink-0">
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

      <!-- 虚拟滚动列表（会话数量超过阈值时使用） -->
      <RecycleScroller
        v-if="shouldUseVirtualScroll"
        class="flex-1 min-h-0 scrollbar-thin"
        :items="visibleConversations"
        :item-size="ITEM_SIZE"
        key-field="id"
        :buffer="200"
      >
        <template #default="{ item: conv }">
          <div
            @click="handleSwitch(conv.id)"
            :class="[
              'group relative flex flex-col px-3.5 py-3 mb-1.5 rounded-xl cursor-pointer transition-all duration-200',
              chatStore.currentConversationId === conv.id
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'hover:bg-slate-50 dark:hover:bg-gray-800'
            ]"
          >
            <div v-if="isEditing(conv.id)" class="flex items-center gap-2">
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
                    @click.stop="openDeleteConfirm(conv, $event)"
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
        </template>
      </RecycleScroller>

      <!-- 普通列表（会话数量较少时使用） -->
      <div
        v-else
        class="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent space-y-1.5"
      >
        <div
          v-for="conv in visibleConversations"
          :key="conv.id"
          @click="handleSwitch(conv.id)"
          :class="[
            'group relative flex flex-col px-3.5 py-3 rounded-xl cursor-pointer transition-all duration-200',
            chatStore.currentConversationId === conv.id
              ? 'bg-blue-50 dark:bg-blue-900/20'
              : 'hover:bg-slate-50 dark:hover:bg-gray-800'
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
                  @click.stop="openDeleteConfirm(conv, $event)"
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

    <!-- 删除确认弹窗 -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      @click.self="closeDeleteConfirm"
    >
      <div class="w-[90%] max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-slate-200 dark:border-gray-700 p-4">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertTriangle :size="20" class="text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">{{ labels.confirmDeleteTitle }}</h3>
            <p class="text-xs text-slate-500 dark:text-gray-400 truncate max-w-[200px]">{{ deletingConversationTitle }}</p>
          </div>
        </div>

        <p class="text-xs text-slate-600 dark:text-gray-300 mb-4">
          {{ labels.confirmDeleteWarning }}
        </p>

        <div class="flex justify-end gap-2">
          <button
            @click="closeDeleteConfirm"
            class="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
          >
            {{ labels.cancelButton }}
          </button>
          <button
            @click="confirmDelete"
            class="px-3 py-1.5 rounded-lg text-xs bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            {{ labels.confirmDeleteButton }}
          </button>
        </div>
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

/* 虚拟滚动样式 */
:deep(.vue-recycle-scroller) {
  overflow-y: auto;
}

:deep(.vue-recycle-scroller__item-wrapper) {
  overflow: visible;
}

:deep(.vue-recycle-scroller__item-view) {
  overflow: visible;
}
</style>
