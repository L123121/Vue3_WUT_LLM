import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export const useNotificationStore = defineStore('notification', () => {
  const preferences = ref({ system: true, message: true, alert: true });
  const notifications = ref([
    { id: '1', title: '系统升级完成', message: '武理小精灵已更新至 v2.0 版本，新增了 AI 对话功能。', time: '10分钟前', read: false, type: 'system' },
    { id: '2', title: '新任务提醒', message: '您有一个新的待办事项：“复习计算机网络” 需要处理。', time: '1小时前', read: false, type: 'alert' },
    { id: '3', title: '欢迎新同学', message: '欢迎使用武理小精灵！这里是您的智慧校园助手。', time: '2天前', read: true, type: 'message' },
  ]);

  const unreadCount = computed(() => notifications.value.filter((notification) => !notification.read).length);
  const togglePreference = (type) => { preferences.value[type] = !preferences.value[type]; };
  const markAsRead = (id) => {
    const notification = notifications.value.find((item) => item.id === id);
    if (notification) notification.read = true;
  };
  const markAllAsRead = () => notifications.value.forEach((notification) => { notification.read = true; });
  const removeNotification = (id) => {
    const index = notifications.value.findIndex((item) => item.id === id);
    if (index !== -1) notifications.value.splice(index, 1);
  };
  const addNotification = (notification) => {
    if (!preferences.value[notification.type]) return;
    notifications.value.unshift({ ...notification, id: Date.now().toString(), read: false, time: '刚刚' });
  };
  const clearAll = () => { notifications.value = []; };

  return { notifications, preferences, unreadCount, togglePreference, markAsRead, markAllAsRead, removeNotification, clearAll, addNotification };
});
