<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Star, ChevronDown, ChevronRight, X, Bot, User } from 'lucide-vue-next';
import { useFavoritesStore } from '../../stores/favorites.store.js';
import { useChatStore } from '../../stores/chat.store.js';

const favoritesStore = useFavoritesStore();
const chatStore = useChatStore();
const router = useRouter();
const route = useRoute();

const isExpanded = ref(true);
const toggleExpanded = () => { isExpanded.value = !isExpanded.value; };

// 收藏条目的预览文本（截断）
const getPreview = (fav) => {
  const text = fav.text || '';
  const clean = text.replace(/[-#>*`~_]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 40 ? `${clean.slice(0, 40)}…` : clean;
};

const roleIcon = (role) => (role === 'user' ? User : Bot);

// 点击收藏条目：切换到对应会话并滚动定位到该消息
const openFavorite = async (fav) => {
  if (chatStore.currentConversationId !== fav.conversationId) {
    await chatStore.switchConversation(fav.conversationId);
  }
  if (route.path !== '/chat') {
    await router.push('/chat');
  }
  // 等待消息渲染后再通知滚动定位
  setTimeout(() => {
    favoritesStore.requestScrollToMessage(fav.messageId);
  }, 100);
};

const removeFavorite = (fav, event) => {
  event.stopPropagation();
  favoritesStore.removeFavorite(fav.id);
};
</script>

<template>
  <div class="mb-2 border-t border-slate-100 dark:border-gray-800 pt-2">
    <div
      class="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
      @click="toggleExpanded"
    >
      <div class="flex items-center gap-2">
        <component :is="isExpanded ? ChevronDown : ChevronRight" :size="14" class="text-slate-400 dark:text-slate-500" />
        <Star :size="13" class="text-amber-500 dark:text-amber-400" />
        <span class="text-xs font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider">收藏</span>
        <span class="text-[10px] text-slate-400 dark:text-slate-600 bg-slate-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full">
          {{ favoritesStore.favorites.length }}
        </span>
      </div>
    </div>

    <div v-if="isExpanded" class="mt-1 space-y-1 max-h-44 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent">
      <div
        v-for="fav in favoritesStore.sortedFavorites"
        :key="fav.id"
        class="group flex items-start gap-2 px-3 py-2 rounded-xl cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
        @click="openFavorite(fav)"
      >
        <component
          :is="roleIcon(fav.role)"
          :size="13"
          class="mt-0.5 shrink-0"
          :class="fav.role === 'user' ? 'text-wut-500 dark:text-wut-400' : 'text-wut-500 dark:text-wut-400'"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-slate-600 dark:text-gray-300 truncate">
              {{ fav.conversationTitle }}
            </span>
            <button
              @click="removeFavorite(fav, $event)"
              class="p-0.5 text-slate-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              :title="'取消收藏'"
            >
              <X :size="11" />
            </button>
          </div>
          <p class="text-[11px] text-slate-400 dark:text-gray-500 truncate mt-0.5" :title="fav.text">
            {{ getPreview(fav) }}
          </p>
        </div>
      </div>

      <div v-if="favoritesStore.favorites.length === 0" class="text-center py-3 text-slate-500 dark:text-gray-400 text-[11px]">
        暂无收藏，在消息下方点 ☆ 即可收藏
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
  background-color: rgb(55 65 71);
}
</style>
