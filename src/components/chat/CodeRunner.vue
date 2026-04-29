<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  code: { type: String, default: '' },
  language: { type: String, default: 'javascript' }
});

const emit = defineEmits(['close']);

const iframeRef = ref(null);
const output = ref([]);
const isRunning = ref(false);
const executionTime = ref(null);

// 生成沙箱 HTML
const sandboxHtml = computed(() => {
  if (props.language !== 'javascript' && props.language !== 'js') {
    return '';
  }

  // 注入 console 拦截脚本
  const wrappedCode = `
    (function() {
      const originalConsole = { ...console };
      const outputs = [];

      // 重写 console 方法
      ['log', 'error', 'warn', 'info'].forEach(method => {
        console[method] = function(...args) {
          const serialized = args.map(arg => {
            if (arg === undefined) return 'undefined';
            if (arg === null) return 'null';
            if (typeof arg === 'function') return arg.toString();
            if (typeof arg === 'object') {
              try {
                return JSON.stringify(arg, null, 2);
              } catch (e) {
                return String(arg);
              }
            }
            return String(arg);
          }).join(' ');

          parent.postMessage({
            type: 'console',
            method,
            content: serialized
          }, '*');

          originalConsole[method](...args);
        };
      });

      // 捕获错误
      window.onerror = function(msg, url, line, col, error) {
        parent.postMessage({
          type: 'error',
          content: msg + (line ? ' (line ' + line + ')' : '')
        }, '*');
        return true;
      };

      // 执行用户代码
      try {
        const startTime = performance.now();
        const result = (function() {
          ${props.code}
        })();
        const endTime = performance.now();

        // 返回执行时间
        parent.postMessage({
          type: 'timing',
          duration: Math.round(endTime - startTime)
        }, '*');

        // 如果有返回值
        if (result !== undefined) {
          console.log(result);
        }

        // 执行完成
        parent.postMessage({ type: 'done' }, '*');
      } catch (e) {
        parent.postMessage({
          type: 'error',
          content: e.message
        }, '*');
        parent.postMessage({ type: 'done' }, '*');
      }
    })();
  `;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
        <style>
          body { margin: 0; padding: 0; }
        </style>
      </head>
      <body>
        <script>${wrappedCode}<\/script>
      </body>
    </html>
  `;
});

// 监听 iframe 消息
const handleMessage = (event) => {
  const { type, method, content, duration } = event.data || {};

  if (type === 'console') {
    output.value.push({
      type: method,
      content,
      timestamp: Date.now()
    });
  } else if (type === 'error') {
    output.value.push({
      type: 'error',
      content,
      timestamp: Date.now()
    });
  } else if (type === 'timing') {
    executionTime.value = duration;
  } else if (type === 'done') {
    isRunning.value = false;
  }
};

// 运行代码
const runCode = () => {
  if (props.language !== 'javascript' && props.language !== 'js') {
    output.value = [{
      type: 'error',
      content: `暂不支持 ${props.language} 语言执行，仅支持 JavaScript`,
      timestamp: Date.now()
    }];
    return;
  }

  output.value = [];
  executionTime.value = null;
  isRunning.value = true;

  // 重新加载 iframe
  if (iframeRef.value) {
    iframeRef.value.srcdoc = sandboxHtml.value;
  }
};

// 清空输出
const clearOutput = () => {
  output.value = [];
  executionTime.value = null;
};

// 关闭面板
const close = () => {
  emit('close');
};

// 获取输出样式
const getOutputClass = (type) => {
  const classes = {
    log: 'text-gray-200',
    error: 'text-red-400',
    warn: 'text-yellow-400',
    info: 'text-blue-400'
  };
  return classes[type] || 'text-gray-200';
};

onMounted(() => {
  window.addEventListener('message', handleMessage);
});

onUnmounted(() => {
  window.removeEventListener('message', handleMessage);
});
</script>

<template>
  <div class="code-runner fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" @click.self="close">
    <div class="bg-slate-900 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-slate-700">
      <!-- 头部 -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div class="flex items-center gap-2">
          <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <span class="font-medium text-white">代码执行</span>
          <span class="text-xs text-gray-500 bg-slate-800 px-2 py-0.5 rounded">{{ language }}</span>
        </div>
        <button @click="close" class="text-gray-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- 代码预览 -->
      <div class="px-4 py-2 border-b border-slate-700 bg-slate-800/50">
        <pre class="text-xs text-gray-300 overflow-x-auto max-h-32"><code>{{ code }}</code></pre>
      </div>

      <!-- 控制栏 -->
      <div class="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
        <button
          @click="runCode"
          :disabled="isRunning"
          class="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
          </svg>
          {{ isRunning ? '执行中...' : '运行' }}
        </button>
        <button
          @click="clearOutput"
          class="px-3 py-1.5 text-gray-400 hover:text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
        >
          清空
        </button>
        <div v-if="executionTime !== null" class="ml-auto text-xs text-gray-500">
          执行耗时: {{ executionTime }}ms
        </div>
      </div>

      <!-- 输出区域 -->
      <div class="flex-1 overflow-auto p-4 bg-slate-950 min-h-[200px]">
        <div v-if="output.length === 0" class="text-gray-500 text-sm text-center py-8">
          点击"运行"执行代码
        </div>
        <div v-else class="space-y-1 font-mono text-sm">
          <div
            v-for="(item, index) in output"
            :key="index"
            :class="getOutputClass(item.type)"
            class="py-0.5"
          >
            <span v-if="item.type === 'error'" class="text-red-500 mr-2">✗</span>
            <span v-else-if="item.type === 'warn'" class="text-yellow-500 mr-2">⚠</span>
            <span v-else class="text-gray-500 mr-2">›</span>
            <span class="whitespace-pre-wrap break-all">{{ item.content }}</span>
          </div>
        </div>
      </div>

      <!-- 隐藏的 iframe -->
      <iframe
        ref="iframeRef"
        sandbox="allow-scripts"
        class="hidden"
      />
    </div>
  </div>
</template>
