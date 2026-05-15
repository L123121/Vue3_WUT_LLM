import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'mcp_servers';

// 数据规范化函数
const normalizeMcpServer = (server) => ({
  id: String(server.id || `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  name: String(server.name || '未命名 MCP 服务器').trim(),
  command: String(server.command || '').trim(),
  args: Array.isArray(server.args) ? server.args.map(String) : [],
  env: server.env && typeof server.env === 'object' ? { ...server.env } : {},
  enabled: server.enabled !== false,
  description: String(server.description || '').trim(),
  createdAt: new Date(server.createdAt || Date.now()),
  updatedAt: new Date(server.updatedAt || Date.now()),
});

// 从 localStorage 加载
const loadMcpServers = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeMcpServer);
  } catch {
    return [];
  }
};

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref(loadMcpServers());

  // 计算属性
  const enabledServers = computed(() => servers.value.filter((server) => server.enabled));

  const serverCount = computed(() => servers.value.length);
  const enabledCount = computed(() => enabledServers.value.length);

  // 持久化（防抖）
  let saveTimer = null;
  watch(
    servers,
    () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(servers.value));
        saveTimer = null;
      }, 300);
    },
    { deep: true }
  );

  // 添加服务器
  const addServer = (data) => {
    const server = normalizeMcpServer({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    servers.value.unshift(server);
    return server;
  };

  // 更新服务器
  const updateServer = (id, data) => {
    const index = servers.value.findIndex((s) => s.id === id);
    if (index !== -1) {
      servers.value[index] = normalizeMcpServer({
        ...servers.value[index],
        ...data,
        updatedAt: new Date(),
      });
    }
  };

  // 删除服务器
  const removeServer = (id) => {
    const index = servers.value.findIndex((s) => s.id === id);
    if (index !== -1) {
      servers.value.splice(index, 1);
    }
  };

  // 切换启用状态
  const toggleServer = (id) => {
    const server = servers.value.find((s) => s.id === id);
    if (server) {
      server.enabled = !server.enabled;
      server.updatedAt = new Date();
    }
  };

  // 复制服务器
  const duplicateServer = (id) => {
    const original = servers.value.find((s) => s.id === id);
    if (original) {
      const copy = normalizeMcpServer({
        ...original,
        name: `${original.name} (副本)`,
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      servers.value.unshift(copy);
      return copy;
    }
    return null;
  };

  // 导出配置
  const exportConfig = () => {
    const config = {};
    enabledServers.value.forEach((server) => {
      config[server.name] = {
        command: server.command,
        args: server.args,
        ...(Object.keys(server.env).length > 0 && { env: server.env }),
      };
    });
    return config;
  };

  // 生成 Claude Desktop 配置格式
  const toClaudeDesktopConfig = () => {
    return {
      mcpServers: exportConfig(),
    };
  };

  // 导入配置（支持 Claude Desktop 格式）
  const importConfig = (configJson) => {
    try {
      const config = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
      const mcpServers = config.mcpServers || config;

      if (typeof mcpServers !== 'object' || mcpServers === null) {
        return { success: false, message: '配置格式无效' };
      }

      let importCount = 0;
      Object.entries(mcpServers).forEach(([name, serverConfig]) => {
        if (serverConfig.command) {
          addServer({
            name,
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env || {},
            description: serverConfig.description || '',
            enabled: true,
          });
          importCount++;
        }
      });

      return { success: true, message: `成功导入 ${importCount} 个服务器配置`, count: importCount };
    } catch (error) {
      return { success: false, message: '配置解析失败，请检查 JSON 格式' };
    }
  };

  // 清空所有服务器
  const clearAllServers = () => {
    servers.value = [];
  };

  return {
    servers,
    enabledServers,
    serverCount,
    enabledCount,
    addServer,
    updateServer,
    removeServer,
    toggleServer,
    duplicateServer,
    exportConfig,
    toClaudeDesktopConfig,
    importConfig,
    clearAllServers,
  };
});
