<script setup>
import { computed, ref } from 'vue';
import { useMcpStore } from '../../stores/mcp.store.js';
import { useToastStore } from '../../stores/toast.store.js';
import { Server, Plus, Pencil, Trash2, Copy, X, Check, Download, Upload, Sparkles } from 'lucide-vue-next';

const mcpStore = useMcpStore();
const toast = useToastStore();

// 编辑器状态
const showEditor = ref(false);
const editingServer = ref(null);
const formData = ref({
  name: '',
  command: '',
  args: '',
  env: '',
  description: '',
});

// 模板选择状态
const showTemplates = ref(false);

// MCP 服务器模板
const mcpTemplates = [
  {
    name: 'GitHub',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-github',
    env: 'GITHUB_PERSONAL_ACCESS_TOKEN=your_token_here',
    description: 'GitHub API 集成，支持仓库、Issue、PR 操作',
  },
  {
    name: 'Filesystem',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-filesystem /path/to/allowed/dir',
    env: '',
    description: '文件系统访问，允许读写指定目录',
  },
  {
    name: 'Memory',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-memory',
    env: '',
    description: '持久化内存存储，用于跨会话记忆',
  },
  {
    name: 'Brave Search',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-brave-search',
    env: 'BRAVE_API_KEY=your_api_key_here',
    description: 'Brave 搜索引擎集成',
  },
  {
    name: 'Slack',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-slack',
    env: 'SLACK_BOT_TOKEN=xoxb-your-token\nSLACK_TEAM_ID=T01234567',
    description: 'Slack 工作区集成',
  },
  {
    name: 'Google Drive',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-gdrive',
    env: 'GOOGLE_OAUTH_CLIENT_ID=...\nGOOGLE_OAUTH_CLIENT_SECRET=...',
    description: 'Google Drive 文件访问',
  },
];

// 国际化标签
const labels = computed(() => ({
  title: 'MCP 服务器',
  subtitle: '管理 Model Context Protocol 服务器配置',
  add: '添加',
  enabled: '已启用',
  empty: '暂无 MCP 服务器，点击添加按钮创建',
  namePlaceholder: '服务器名称',
  commandPlaceholder: '启动命令 (如 npx, node, python)',
  argsPlaceholder: '命令参数，空格分隔 (如: -y @anthropic/mcp-server)',
  envPlaceholder: '环境变量，格式: KEY=value，每行一个',
  descPlaceholder: '可选描述说明',
  editTitle: '编辑 MCP 服务器',
  addTitle: '添加 MCP 服务器',
  save: '保存',
  cancel: '取消',
  command: '命令',
  args: '参数',
  env: '环境变量',
  confirmDelete: '确定要删除这个 MCP 服务器配置吗？',
  export: '导出',
  import: '导入',
  templates: '模板',
  exportSuccess: '配置已导出到剪贴板',
  importSuccess: '成功导入 {count} 个服务器配置',
  importError: '导入失败：{error}',
}));

// 打开添加编辑器
const openAddEditor = () => {
  editingServer.value = null;
  formData.value = { name: '', command: '', args: '', env: '', description: '' };
  showEditor.value = true;
};

// 打开编辑编辑器
const openEditEditor = (server) => {
  editingServer.value = server;
  formData.value = {
    name: server.name,
    command: server.command,
    args: server.args.join(' '),
    env: Object.entries(server.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    description: server.description || '',
  };
  showEditor.value = true;
};

// 关闭编辑器
const closeEditor = () => {
  showEditor.value = false;
  editingServer.value = null;
};

// 解析环境变量
const parseEnv = (envStr) => {
  const env = {};
  if (!envStr.trim()) return env;
  envStr.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      env[key.trim()] = valueParts.join('=').trim();
    }
  });
  return env;
};

// 保存服务器配置
const saveServer = () => {
  if (!formData.value.name.trim() || !formData.value.command.trim()) {
    return;
  }

  const data = {
    name: formData.value.name.trim(),
    command: formData.value.command.trim(),
    args: formData.value.args.trim() ? formData.value.args.trim().split(/\s+/) : [],
    env: parseEnv(formData.value.env),
    description: formData.value.description.trim(),
  };

  if (editingServer.value) {
    mcpStore.updateServer(editingServer.value.id, data);
  } else {
    mcpStore.addServer(data);
  }

  closeEditor();
};

// 删除确认
const handleDelete = (id) => {
  if (confirm(labels.value.confirmDelete)) {
    mcpStore.removeServer(id);
  }
};

// 复制配置
const handleDuplicate = (id) => {
  mcpStore.duplicateServer(id);
};

// 导出配置
const handleExport = () => {
  const config = mcpStore.toClaudeDesktopConfig();
  const jsonStr = JSON.stringify(config, null, 2);
  navigator.clipboard.writeText(jsonStr).then(() => {
    toast.success(labels.value.exportSuccess);
  }).catch(() => {
    // Fallback: 创建下载
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mcp-config.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('配置文件已下载');
  });
};

// 导入配置
const handleImport = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = mcpStore.importConfig(text);
      if (result.success) {
        toast.success(labels.value.importSuccess.replace('{count}', result.count));
      } else {
        toast.error(labels.value.importError.replace('{error}', result.message));
      }
    } catch (error) {
      toast.error(labels.value.importError.replace('{error}', '文件读取失败'));
    }
  };
  input.click();
};

// 使用模板
const useTemplate = (template) => {
  formData.value = {
    name: template.name,
    command: template.command,
    args: template.args,
    env: template.env,
    description: template.description,
  };
  showTemplates.value = false;
  showEditor.value = true;
};
</script>

<template>
  <div class="rounded-xl border border-slate-200 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-900/60 p-3">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <Server :size="14" class="text-amber-500" />
        <h4 class="text-xs font-bold text-slate-700 dark:text-gray-200 uppercase tracking-wide">
          {{ labels.title }}
        </h4>
        <span class="text-[10px] text-slate-400 dark:text-gray-500">
          {{ mcpStore.enabledCount }}/{{ mcpStore.serverCount }}
        </span>
      </div>
      <div class="flex items-center gap-1">
        <!-- 导入导出按钮 -->
        <button
          @click="handleImport"
          class="p-1 rounded text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          :title="labels.import"
        >
          <Upload :size="12" />
        </button>
        <button
          @click="handleExport"
          :disabled="mcpStore.serverCount === 0"
          class="p-1 rounded text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-40"
          :title="labels.export"
        >
          <Download :size="12" />
        </button>
        <!-- 模板按钮 -->
        <button
          @click="showTemplates = !showTemplates"
          :class="[
            'p-1 rounded transition-colors',
            showTemplates
              ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/20'
              : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
          ]"
          :title="labels.templates"
        >
          <Sparkles :size="12" />
        </button>
        <!-- 添加按钮 -->
        <button
          @click="openAddEditor"
          class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-amber-500 text-white hover:bg-amber-600 transition-colors"
        >
          <Plus :size="12" />
          {{ labels.add }}
        </button>
      </div>
    </div>

    <p class="text-[11px] text-slate-500 dark:text-gray-400 mb-2">{{ labels.subtitle }}</p>

    <!-- 模板选择面板 -->
    <div v-if="showTemplates" class="mb-2 p-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20">
      <p class="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-2">选择预设模板：</p>
      <div class="grid grid-cols-2 gap-1.5">
        <button
          v-for="template in mcpTemplates"
          :key="template.name"
          @click="useTemplate(template)"
          class="p-2 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-amber-400 dark:hover:border-amber-500 text-left transition-colors"
        >
          <p class="text-[11px] font-medium text-slate-700 dark:text-gray-200">{{ template.name }}</p>
          <p class="text-[9px] text-slate-500 dark:text-gray-400 truncate mt-0.5">{{ template.description }}</p>
        </button>
      </div>
    </div>

    <!-- 服务器列表 -->
    <div v-if="mcpStore.servers.length === 0" class="text-[11px] text-slate-400 dark:text-gray-500 py-2 text-center">
      {{ labels.empty }}
    </div>

    <ul v-else class="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-gray-700 scrollbar-track-transparent pr-1">
      <li
        v-for="server in mcpStore.servers"
        :key="server.id"
        class="rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <p class="text-xs font-medium text-slate-700 dark:text-gray-200 truncate">
                {{ server.name }}
              </p>
              <span
                :class="[
                  'px-1 py-0.5 rounded text-[9px]',
                  server.enabled
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-gray-300'
                ]"
              >
                {{ server.enabled ? labels.enabled : 'Off' }}
              </span>
            </div>
            <p class="text-[10px] text-slate-500 dark:text-gray-400 truncate mt-0.5">
              {{ server.command }} {{ server.args.join(' ') }}
            </p>
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              @click="mcpStore.toggleServer(server.id)"
              :class="[
                'p-1 rounded transition-colors',
                server.enabled
                  ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                  : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
              ]"
              :title="server.enabled ? '点击禁用' : '点击启用'"
            >
              <Check :size="12" />
            </button>
            <button
              @click="openEditEditor(server)"
              class="p-1 rounded text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              title="编辑"
            >
              <Pencil :size="12" />
            </button>
            <button
              @click="handleDuplicate(server.id)"
              class="p-1 rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              title="复制"
            >
              <Copy :size="12" />
            </button>
            <button
              @click="handleDelete(server.id)"
              class="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              title="删除"
            >
              <Trash2 :size="12" />
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- 编辑器弹窗 -->
    <div v-if="showEditor" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="closeEditor">
      <div class="w-[90%] max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-slate-200 dark:border-gray-700 p-4">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">
            {{ editingServer ? labels.editTitle : labels.addTitle }}
          </h3>
          <button @click="closeEditor" class="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-gray-200">
            <X :size="16" />
          </button>
        </div>

        <div class="space-y-3">
          <!-- 名称 -->
          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">名称 *</label>
            <input
              v-model="formData.name"
              :placeholder="labels.namePlaceholder"
              class="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          <!-- 命令 -->
          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">{{ labels.command }} *</label>
            <input
              v-model="formData.command"
              :placeholder="labels.commandPlaceholder"
              class="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          <!-- 参数 -->
          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">{{ labels.args }}</label>
            <input
              v-model="formData.args"
              :placeholder="labels.argsPlaceholder"
              class="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>

          <!-- 环境变量 -->
          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">{{ labels.env }}</label>
            <textarea
              v-model="formData.env"
              :placeholder="labels.envPlaceholder"
              rows="3"
              class="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-none font-mono"
            ></textarea>
          </div>

          <!-- 描述 -->
          <div>
            <label class="block text-[11px] font-medium text-slate-600 dark:text-gray-300 mb-1">描述</label>
            <input
              v-model="formData.description"
              :placeholder="labels.descPlaceholder"
              class="w-full h-9 px-3 text-xs rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </div>
        </div>

        <div class="flex justify-end gap-2 mt-4">
          <button
            @click="closeEditor"
            class="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-gray-800"
          >
            {{ labels.cancel }}
          </button>
          <button
            @click="saveServer"
            :disabled="!formData.name.trim() || !formData.command.trim()"
            class="px-3 py-1.5 rounded-lg text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ labels.save }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
