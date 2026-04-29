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

  watch(skills, (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
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
    const sections = enabledSkills.value.slice(0, 4).map((skill, index) => {
      return `${index + 1}. ${skill.name}\n${skill.instructions}`;
    });

    return [
      '你是武理小精灵，请遵循以下已启用 Skills 进行回答：',
      ...sections,
      '当 Skills 与用户问题相关时优先采用其规则。',
    ].join('\n\n');
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
