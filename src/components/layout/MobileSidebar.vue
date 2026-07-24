<script setup>
import { onMounted, onUnmounted } from 'vue';
import Sidebar from './Sidebar.vue';

const props = defineProps({
  modelValue: Boolean,
});

const emit = defineEmits(['update:modelValue']);

const close = () => emit('update:modelValue', false);

const handleKeydown = (e) => {
  if (e.key === 'Escape' && props.modelValue) {
    close();
  }
};

onMounted(() => document.addEventListener('keydown', handleKeydown));
onUnmounted(() => document.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-40"
      >
        <!-- 遮罩层 -->
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-sm"
          @click.self="close"
        />

        <!-- 侧边栏面板 -->
        <div class="absolute top-0 left-0 h-full w-72 max-w-[85vw] shadow-2xl drawer-panel">
          <Sidebar />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 遮罩层淡入淡出 */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}

/* 侧边栏面板滑入滑出 */
.drawer-enter-active .drawer-panel {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-leave-active .drawer-panel {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-enter-from .drawer-panel {
  transform: translateX(-100%);
}
.drawer-leave-to .drawer-panel {
  transform: translateX(-100%);
}
</style>