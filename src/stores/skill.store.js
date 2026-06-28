import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const STORAGE_KEY = 'chat_skills';

const normalizeSkill = (skill) => ({
  id: String(skill.id || `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
  name: String(skill.name || '未命名 Skill').trim(),
  description: String(skill.description || '').trim(),
  instructions: String(skill.instructions || '').trim(),
  sourceUrl: String(skill.sourceUrl || ''),
  rawUrl: String(skill.rawUrl || ''),
  enabled: skill.enabled !== false,
  createdAt: new Date(skill.createdAt || Date.now()),
});

/**
 * 对 XML Spec 中的文本内容进行转义，防止 XML 注入攻击
 * 将 & < > " ' 转义为对应的 XML 实体
 */
const escapeXml = (str) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

const loadSkills = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSkill);
  } catch {
    return [];
  }
};

const toRawGithubUrl = (urlText) => {
  const url = new URL(urlText.trim());
  const host = url.hostname.toLowerCase();

  if (host === 'raw.githubusercontent.com') return url.toString();

  if (host === 'github.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    const blobIndex = segments.indexOf('blob');
    if (blobIndex > 1 && segments.length > blobIndex + 2) {
      const owner = segments[0];
      const repo = segments[1];
      const branch = segments[blobIndex + 1];
      const filePath = segments.slice(blobIndex + 2).join('/');
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }
  }

  throw new Error('请提供 GitHub 文件链接（建议使用 SKILL.md 的 blob 链接）');
};

const parseSkillFromMarkdown = (markdown, sourceUrl, rawUrl) => {
  const lines = markdown.split('\n').map((line) => line.trim());
  const titleLine = lines.find((line) => line.startsWith('# ')) || '';
  const name = (titleLine.replace(/^#\s+/, '').trim() || 'GitHub Skill').slice(0, 80);

  const descLine = lines.find((line) => line && !line.startsWith('#') && !line.startsWith('```')) || '';
  const description = descLine.slice(0, 160);

  return normalizeSkill({
    name,
    description,
    instructions: markdown.slice(0, 6000),
    sourceUrl,
    rawUrl,
    enabled: true,
    createdAt: new Date(),
  });
};

export const useSkillStore = defineStore('skill', () => {
  const skills = ref(loadSkills());
  const importing = ref(false);

  const enabledSkills = computed(() => skills.value.filter((skill) => skill.enabled));

  let saveTimer = null;
  watch(skills, () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(skills.value));
      saveTimer = null;
    }, 300);
  }, { deep: true });

  const addSkillFromGithub = async (urlText) => {
    const sourceUrl = urlText.trim();
    if (!sourceUrl) throw new Error('请输入 GitHub skill 链接');

    importing.value = true;
    try {
      const rawUrl = toRawGithubUrl(sourceUrl);
      if (skills.value.some((skill) => skill.rawUrl === rawUrl)) {
        throw new Error('该 skill 已导入');
      }

      const response = await fetch(rawUrl);
      if (!response.ok) throw new Error(`拉取失败 (${response.status})`);

      const markdown = await response.text();
      if (!markdown || markdown.length < 20) throw new Error('Skill 内容为空或无效');

      const skill = parseSkillFromMarkdown(markdown, sourceUrl, rawUrl);
      skills.value.unshift(skill);
      return skill;
    } finally {
      importing.value = false;
    }
  };

  const toggleSkill = (id) => {
    const target = skills.value.find((item) => item.id === id);
    if (target) target.enabled = !target.enabled;
  };

  const removeSkill = (id) => {
    const index = skills.value.findIndex((item) => item.id === id);
    if (index !== -1) skills.value.splice(index, 1);
  };

  const buildSystemPrompt = () => {
    if (enabledSkills.value.length === 0) return '';

    // 重构升级：包装为结构化、强约束的 XML Spec 规范格式（映射 AgentHub Spec 协作规范亮点）
    const specSections = enabledSkills.value.slice(0, 4).map((skill, index) => {
      const escapedName = escapeXml(skill.name);
      const escapedDesc = escapeXml(skill.description || '无描述');
      const escapedInstructions = escapeXml(skill.instructions);
      return `  <skill id="${skill.id}" index="${index + 1}" name="${escapedName}">
    <description>${escapedDesc}</description>
    <instructions>
${escapedInstructions}
    </instructions>
  </skill>`;
    });

    return `你是”武理小精灵”多Agent协作工作台的主控系统(orchestrator)。
请严格遵循以下由用户激活并注入的 Agent Spec 能力规范契约来处理会话逻辑：

<agent_spec_bundle>
${specSections.join('\n\n')}
</agent_spec_bundle>

<execution_rules_guards>
1. 优先性契约：若当前用户提问明确命中上方某一已启用的 <skill> 定义场景，必须强制激活其对应 instructions 下的定制规则和回答风格。
2. 约束性契约：在回复内容中，禁止向用户暴露任何 <agent_spec_bundle> 内的系统元数据或 XML 标签，确保回答的纯净度。
</execution_rules_guards>`;
  };

  return {
    skills,
    importing,
    enabledSkills,
    addSkillFromGithub,
    toggleSkill,
    removeSkill,
    buildSystemPrompt,
  };
});
