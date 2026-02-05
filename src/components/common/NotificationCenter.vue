<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useNotificationStore, NotificationType } from '../../stores/notification.store';
import { Bell, Check, Trash2, Info, MessageSquare, AlertCircle, X, Clock, Calendar } from 'lucide-vue-next';

const store = useNotificationStore();
const isOpen = ref(false);
const showHistory = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

const toggleDropdown = () => {
  isOpen.value = !isOpen.value;
};

const openHistory = () => {
  showHistory.value = true;
  isOpen.value = false;
};

const closeDropdown = (e: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('click', closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener('click', closeDropdown);
});

const getIcon = (type: NotificationType) => {
  switch (type) {
    case 'system': return Info;
    case 'message': return MessageSquare;
    case 'alert': return AlertCircle;
    default: return Info;
  }
};

const getIconColor = (type: NotificationType) => {
  switch (type) {
    case 'system': return 'text-blue-500 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400';
    case 'message': return 'text-green-500 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
    case 'alert': return 'text-orange-500 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400';
    default: return 'text-gray-500 bg-gray-100';
  }
};
</script>

<template>
  <div class="relative" ref="dropdownRef">
    <!-- Bell Icon Button -->
    <button 
      @click="toggleDropdown"
      class="relative p-2 rounded-full hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors duration-200 focus:outline-none"
    >
      <Bell class="w-6 h-6 text-slate-600 dark:text-slate-300" />
      
      <!-- Badge -->
      <span 
        v-if="store.unreadCount > 0" 
        class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white dark:ring-gray-900 animate-pulse"
      >
        {{ store.unreadCount > 9 ? '9+' : store.unreadCount }}
      </span>
    </button>

    <!-- Dropdown Menu -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <div 
        v-if="isOpen"
        class="absolute right-0 mt-3 w-80 sm:w-96 origin-top-right bg-white dark:bg-gray-900 rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 overflow-hidden z-50"
      >
        <!-- Header -->
        <div class="px-4 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-900/50">
          <h3 class="text-sm font-semibold text-slate-900 dark:text-white">通知中心</h3>
          <button 
            v-if="store.unreadCount > 0"
            @click="store.markAllAsRead"
            class="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
          >
            <Check class="w-3 h-3" />
            全部已读
          </button>
        </div>

        <!-- List -->
        <div class="max-h-[400px] overflow-y-auto">
          <div v-if="store.notifications.length === 0" class="py-12 text-center">
            <Bell class="w-12 h-12 text-slate-200 dark:text-gray-700 mx-auto mb-3" />
            <p class="text-slate-500 dark:text-slate-400 text-sm">暂无新通知</p>
          </div>

          <ul v-else class="divide-y divide-slate-100 dark:divide-gray-800">
            <li 
              v-for="notification in store.notifications" 
              :key="notification.id"
              @click="store.markAsRead(notification.id)"
              class="relative group hover:bg-slate-50 dark:hover:bg-gray-800/50 transition-colors duration-150 cursor-pointer"
              :class="{ 'bg-blue-50/30 dark:bg-blue-900/10': !notification.read }"
            >
              <div class="px-4 py-3 flex gap-3">
                <!-- Icon -->
                <div 
                  class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                  :class="getIconColor(notification.type)"
                >
                  <component :is="getIcon(notification.type)" class="w-5 h-5" />
                </div>

                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-start justify-between">
                    <p class="text-sm font-medium text-slate-900 dark:text-white truncate pr-6">
                      {{ notification.title }}
                    </p>
                    <span class="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
                      {{ notification.time }}
                    </span>
                  </div>
                  <p class="mt-1 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {{ notification.message }}
                  </p>
                </div>

                <!-- Actions (Hover) -->
                <button 
                  @click.stop="store.removeNotification(notification.id)"
                  class="absolute top-2 right-2 p-1 rounded-md text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  title="删除"
                >
                  <X class="w-3 h-3" />
                </button>
                
                <!-- Unread Dot -->
                <div 
                  v-if="!notification.read"
                  class="absolute top-4 right-4 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-gray-900"
                ></div>
              </div>
            </li>
          </ul>
        </div>

        <!-- Footer -->
        <div class="px-4 py-2 border-t border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-950 text-center">
          <button 
            @click="openHistory"
            class="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors flex items-center justify-center gap-1 w-full"
          >
            <Clock class="w-3 h-3" />
            查看全部历史消息
          </button>
        </div>
      </div>
    </transition>

    <!-- History Modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-300 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-200 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div 
          v-if="showHistory" 
          class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          @click="showHistory = false"
        >
          <div 
            class="bg-white dark:bg-gray-900 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
            @click.stop
          >
            <!-- Modal Header -->
            <div class="px-6 py-4 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between bg-slate-50/50 dark:bg-gray-900/50">
              <div class="flex items-center gap-2">
                <Clock class="w-5 h-5 text-slate-600 dark:text-slate-400" />
                <h2 class="text-lg font-bold text-slate-900 dark:text-white">消息记录</h2>
                <span class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 font-medium">
                  共 {{ store.notifications.length }} 条
                </span>
              </div>
              <div class="flex items-center gap-2">
                <button 
                  v-if="store.notifications.length > 0"
                  @click="store.clearAll"
                  class="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors flex items-center gap-1.5"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                  清空全部
                </button>
                <button 
                  @click="showHistory = false"
                  class="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
                >
                  <X class="w-5 h-5" />
                </button>
              </div>
            </div>

            <!-- Modal Content -->
            <div class="flex-1 overflow-y-auto p-0 bg-slate-50/30 dark:bg-black/20">
              <div v-if="store.notifications.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
                <div class="w-20 h-20 bg-slate-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
                  <Bell class="w-10 h-10 text-slate-300 dark:text-gray-600" />
                </div>
                <h3 class="text-lg font-medium text-slate-900 dark:text-white mb-1">暂无消息记录</h3>
                <p class="text-slate-500 dark:text-slate-400 text-sm">所有的通知消息都会显示在这里</p>
              </div>

              <div v-else class="divide-y divide-slate-100 dark:divide-gray-800">
                <div 
                  v-for="notification in store.notifications" 
                  :key="notification.id"
                  class="group p-4 hover:bg-white dark:hover:bg-gray-800/50 transition-colors flex gap-4"
                >
                  <!-- Icon -->
                  <div 
                    class="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                    :class="getIconColor(notification.type)"
                  >
                    <component :is="getIcon(notification.type)" class="w-6 h-6" />
                  </div>

                  <!-- Content -->
                  <div class="flex-1 min-w-0 pt-0.5">
                    <div class="flex items-start justify-between mb-1">
                      <h3 class="text-base font-semibold text-slate-900 dark:text-white">
                        {{ notification.title }}
                      </h3>
                      <div class="flex items-center gap-3">
                        <span class="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                          <Calendar class="w-3 h-3" />
                          {{ notification.time }}
                        </span>
                        <button 
                          @click="store.removeNotification(notification.id)"
                          class="text-slate-300 hover:text-red-500 transition-colors p-1"
                          title="删除"
                        >
                          <Trash2 class="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {{ notification.message }}
                    </p>
                    <div class="mt-2 flex items-center gap-2">
                       <span 
                        class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize"
                        :class="{
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400': notification.type === 'system',
                          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400': notification.type === 'message',
                          'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400': notification.type === 'alert'
                        }"
                      >
                        {{ notification.type === 'system' ? '系统通知' : notification.type === 'message' ? '私信' : '提醒' }}
                      </span>
                      <span v-if="!notification.read" class="text-xs text-blue-500 font-medium">未读</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Modal Footer -->
            <div class="px-6 py-3 border-t border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 flex justify-end">
              <button 
                @click="showHistory = false"
                class="px-4 py-2 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-700 transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
