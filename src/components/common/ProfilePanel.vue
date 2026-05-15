<script setup>
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../../stores/auth.store.js';
import { useChatStore } from '../../stores/chat.store.js';
import { useToastStore } from '../../stores/toast.store.js';
import { fetchUsageStats } from '../../api/chat.js';
import { UserRound, BarChart3, Save, Upload, Image } from 'lucide-vue-next';

const props = defineProps({
  show: Boolean,
  avatarUrl: { type: String, default: '' },
  userName: { type: String, default: '' },
});
const emit = defineEmits(['close', 'open-avatar-picker', 'update:avatar-url', 'update:user-name']);

const authStore = useAuthStore();
const chatStore = useChatStore();
const toastStore = useToastStore();

const user = computed(() => authStore.user);
const activeProfileTab = ref('profile');
const draftName = ref(props.userName);
const draftAvatar = ref(props.avatarUrl);
const remoteUsageData = ref(null);
const usageLoading = ref(false);
const usageLoadError = ref('');
const selectedUsageRange = ref(24);
const hoveredUsagePoint = ref(null);
const usageRangeOptions = [
  { label: '24小时', hours: 24 },
  { label: '7天', hours: 24 * 7 },
  { label: '30天', hours: 24 * 30 },
];

// 同步 props 变化
watch(() => props.show, (visible) => {
  if (visible) {
    draftName.value = props.userName || user.value?.name || '';
    draftAvatar.value = props.avatarUrl || user.value?.avatar || '';
    if (activeProfileTab.value === 'usage') loadUsageData();
  }
});

watch(activeProfileTab, (tab) => {
  if (tab === 'usage') loadUsageData();
});

watch(selectedUsageRange, () => {
  if (activeProfileTab.value === 'usage') loadUsageData();
});

const estimateTokens = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));
const usageRangeLabel = computed(() => usageRangeOptions.find((item) => item.hours === selectedUsageRange.value)?.label || '24小时');

const localUsageSummary = computed(() => {
  const now = Date.now();
  const from = now - selectedUsageRange.value * 60 * 60 * 1000;
  const allMessages = chatStore.conversations.flatMap((c) => c.messages || []);
  const recent = allMessages.filter((m) => {
    if (!m || m.id === 'welcome') return false;
    const ts = new Date(m.timestamp).getTime();
    return !Number.isNaN(ts) && ts >= from && ts <= now;
  });
  const inputTokens = recent.filter((m) => m.role === 'user').reduce((s, m) => s + estimateTokens(m.text), 0);
  const outputTokens = recent.filter((m) => m.role === 'model').reduce((s, m) => s + estimateTokens(m.text), 0);
  return {
    requestCount: recent.filter((m) => m.role === 'user').length,
    inputTokens, outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedTokens: 0,
    estimatedCost: (inputTokens / 1000) * 0.002 + (outputTokens / 1000) * 0.006,
  };
});

const localUsageTrend = computed(() => {
  const now = new Date();
  const useHourly = selectedUsageRange.value <= 24;
  const bucketMs = useHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const pointCount = useHourly ? selectedUsageRange.value : Math.ceil(selectedUsageRange.value / 24);
  const rangeStart = now.getTime() - selectedUsageRange.value * 60 * 60 * 1000;
  const points = Array.from({ length: pointCount }, (_, i) => {
    const start = new Date(rangeStart + i * bucketMs);
    const label = useHourly
      ? `${String(start.getHours()).padStart(2, '0')}:00`
      : `${String(start.getMonth() + 1).padStart(2, '0')}/${String(start.getDate()).padStart(2, '0')}`;
    return { label, start: start.getTime(), end: start.getTime() + bucketMs, tokens: 0 };
  });
  const allMessages = chatStore.conversations.flatMap((c) => c.messages || []);
  allMessages.forEach((m) => {
    if (!m || m.id === 'welcome') return;
    const ts = new Date(m.timestamp).getTime();
    if (Number.isNaN(ts)) return;
    const point = points.find((p) => ts >= p.start && ts < p.end);
    if (point) point.tokens += estimateTokens(m.text);
  });
  const peak = Math.max(...points.map((p) => p.tokens), 1);
  return points.map((p) => ({ ...p, heightPercent: Math.max(6, Math.round((p.tokens / peak) * 100)) }));
});

const usageSummary = computed(() => remoteUsageData.value?.summary || localUsageSummary.value);

const usageTrend = computed(() => {
  const source = remoteUsageData.value?.trend?.length ? remoteUsageData.value.trend : localUsageTrend.value;
  const peak = Math.max(...source.map((item) => item.tokens || 0), 1);
  return source.map((item) => ({ ...item, height: `${Math.max(6, Math.round(((item.tokens || 0) / peak) * 100))}%` }));
});

const usageChartPoints = computed(() => {
  const data = usageTrend.value || [];
  if (!data.length) return [];
  const maxTokens = Math.max(...data.map((item) => item.tokens || 0), 1);
  const denominator = Math.max(data.length - 1, 1);
  return data.map((item, index) => {
    const x = (index / denominator) * 100;
    const y = 100 - ((item.tokens || 0) / maxTokens) * 90;
    return { ...item, x, y, value: item.tokens || 0 };
  });
});

const usagePolyline = computed(() => usageChartPoints.value.map((p) => `${p.x},${p.y}`).join(' '));

const handlePointHover = (point) => { hoveredUsagePoint.value = point; };
const clearPointHover = () => { hoveredUsagePoint.value = null; };

const loadUsageData = async () => {
  usageLoading.value = true;
  usageLoadError.value = '';
  try {
    const data = await fetchUsageStats(selectedUsageRange.value);
    remoteUsageData.value = data;
  } catch (error) {
    console.warn('Load usage stats failed:', error);
    usageLoadError.value = '后端统计暂不可用，当前展示本地估算值';
    remoteUsageData.value = null;
  } finally {
    usageLoading.value = false;
  }
};

const saveProfile = () => {
  if (!draftName.value.trim()) {
    toastStore.error('用户名不能为空');
    return;
  }
  authStore.updateUser({ name: draftName.value.trim(), avatar: draftAvatar.value.trim() || '' });
  emit('update:user-name', draftName.value.trim());
  emit('update:avatar-url', draftAvatar.value.trim());
  toastStore.success('个人信息已更新');
};

const handleAvatarUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toastStore.error('请选择图片文件'); return; }
  if (file.size > 2 * 1024 * 1024) { toastStore.error('图片大小不能超过2MB'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    draftAvatar.value = e.target.result;
    toastStore.success('头像已更新，点击保存生效');
  };
  reader.onerror = () => { toastStore.error('图片读取失败'); };
  reader.readAsDataURL(file);
};
</script>

<template>
  <div
    v-if="show"
    class="profile-panel absolute top-16 mt-2 right-8 z-30 w-[420px] max-w-[calc(100%-2rem)] rounded-xl border border-slate-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-xl p-4 overflow-y-auto"
    :style="{ maxHeight: 'calc(100vh - 6rem)' }"
  >
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-bold text-slate-800 dark:text-gray-100">个人中心</h3>
      <button @click="emit('close')" class="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-gray-200">关闭</button>
    </div>

    <div class="grid grid-cols-2 gap-2 mb-3">
      <button @click="activeProfileTab = 'profile'" :class="['h-9 rounded-lg text-sm font-medium border transition-colors inline-flex items-center justify-center gap-1.5', activeProfileTab === 'profile' ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/25 dark:border-blue-700 dark:text-blue-300' : 'bg-white border-slate-200 text-slate-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300']">
        <UserRound :size="14" />
        <span>资料编辑</span>
      </button>
      <button @click="activeProfileTab = 'usage'" :class="['h-9 rounded-lg text-sm font-medium border transition-colors inline-flex items-center justify-center gap-1.5', activeProfileTab === 'usage' ? 'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-900/25 dark:border-violet-700 dark:text-violet-300' : 'bg-white border-slate-200 text-slate-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300']">
        <BarChart3 :size="14" />
        <span>Token 用量</span>
      </button>
    </div>

    <div v-if="activeProfileTab === 'profile'" class="space-y-3">
      <div class="flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-gray-800/60 border border-slate-200 dark:border-gray-700">
        <div class="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
          <template v-if="draftAvatar">
            <img :src="draftAvatar" alt="头像" class="w-full h-full object-cover" @error="draftAvatar = ''" />
          </template>
          <template v-else>
            {{ (draftName || user?.name)?.charAt(0)?.toUpperCase() || 'U' }}
          </template>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-slate-800 dark:text-gray-100">{{ draftName || user?.name }}</p>
          <p class="text-xs text-slate-500 dark:text-gray-400 mb-2">点击下方按钮更换头像</p>
          <div class="flex gap-2">
            <label class="cursor-pointer h-7 px-2.5 rounded-md text-xs bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors inline-flex items-center gap-1">
              <input type="file" accept="image/*" class="hidden" @change="handleAvatarUpload" />
              <Upload :size="12" />
              <span>上传图片</span>
            </label>
            <button @click="emit('open-avatar-picker')" class="h-7 px-2.5 rounded-md text-xs border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-700 transition-colors inline-flex items-center gap-1">
              <Image :size="12" />
              <span>选择头像</span>
            </button>
          </div>
        </div>
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">头像链接</label>
        <input v-model="draftAvatar" type="text" class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30" placeholder="输入图片URL或留空使用默认头像" />
      </div>

      <div>
        <label class="block text-xs font-semibold text-slate-700 dark:text-gray-300 mb-1">用户名</label>
        <input v-model="draftName" type="text" class="w-full h-9 px-3 text-sm rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30" placeholder="请输入用户名" />
      </div>
      <button @click="saveProfile" class="w-full h-9 rounded-lg inline-flex items-center justify-center gap-2 text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors">
        <Save :size="14" />
        <span>保存资料</span>
      </button>
    </div>

    <div v-else class="space-y-3">
      <div v-if="usageLoadError" class="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2">{{ usageLoadError }}</div>
      <div class="flex items-center gap-2">
        <button v-for="option in usageRangeOptions" :key="option.hours" @click="selectedUsageRange = option.hours" :class="['h-8 px-3 rounded-lg text-xs border transition-colors', selectedUsageRange === option.hours ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/25 dark:border-blue-700 dark:text-blue-300' : 'bg-white border-slate-200 text-slate-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300']">{{ option.label }}</button>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
          <p class="text-xs text-slate-500 dark:text-gray-400">总请求数</p>
          <p class="mt-1 text-xl font-bold text-slate-900 dark:text-white">{{ usageSummary.requestCount }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
          <p class="text-xs text-slate-500 dark:text-gray-400">总 Token</p>
          <p class="mt-1 text-xl font-bold text-slate-900 dark:text-white">{{ usageSummary.totalTokens }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
          <p class="text-xs text-slate-500 dark:text-gray-400">输入 / 输出</p>
          <p class="mt-1 text-sm font-bold text-slate-900 dark:text-white">{{ usageSummary.inputTokens }} / {{ usageSummary.outputTokens }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3 bg-slate-50 dark:bg-gray-800/60">
          <p class="text-xs text-slate-500 dark:text-gray-400">估算成本</p>
          <p class="mt-1 text-xl font-bold text-slate-900 dark:text-white">${{ usageSummary.estimatedCost.toFixed(4) }}</p>
        </div>
      </div>
      <div class="rounded-lg border border-slate-200 dark:border-gray-700 p-3">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs font-semibold text-slate-700 dark:text-gray-300">近{{ usageRangeLabel }}用量趋势</p>
          <button @click="loadUsageData" class="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">刷新</button>
        </div>
        <div v-if="usageLoading" class="h-32 flex items-center justify-center text-xs text-slate-500 dark:text-gray-400">加载中...</div>
        <div v-else class="relative h-32" @mouseleave="clearPointHover">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="w-full h-full">
            <polyline :points="usagePolyline" fill="none" stroke="currentColor" class="text-blue-500" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <circle v-for="point in usageChartPoints" :key="point.label" :cx="point.x" :cy="point.y" r="2.2" class="fill-violet-500 cursor-pointer" @mouseenter="handlePointHover(point)" />
          </svg>
          <div v-if="hoveredUsagePoint" class="absolute -top-8 px-2 py-1 rounded-md text-[10px] whitespace-nowrap bg-slate-900 text-white shadow" :style="{ left: `calc(${hoveredUsagePoint.x}% - 28px)` }">{{ hoveredUsagePoint.label }} · {{ hoveredUsagePoint.value }} tokens</div>
        </div>
        <div class="mt-2 flex justify-between text-[10px] text-slate-400 dark:text-gray-500">
          <span>{{ usageTrend[0]?.label }}</span>
          <span>{{ usageTrend[usageTrend.length - 1]?.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
