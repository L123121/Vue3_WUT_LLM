import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import messages from '../i18n/messages.js';

const STORAGE_KEY = 'app_language';
const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'];

const languageConfig = {
  'zh-CN': {
    code: 'zh-CN',
    label: '简体中文',
    nativeLabel: '简体中文',
    englishLabel: 'Chinese (Simplified)',
    speechLocale: 'zh-CN',
  },
  'en-US': {
    code: 'en-US',
    label: 'English',
    nativeLabel: 'English',
    englishLabel: 'English (US)',
    speechLocale: 'en-US',
  },
};

const isSupportedLanguage = (value) => SUPPORTED_LANGUAGES.includes(value);

const resolvePath = (source, path) => {
  return path.split('.').reduce((current, key) => current?.[key], source);
};

const interpolate = (value, params = {}) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
};

export const useLanguageStore = defineStore('language', () => {
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  const initialLanguage = localStorage.getItem(STORAGE_KEY);
  const locale = ref(
    isSupportedLanguage(initialLanguage)
      ? initialLanguage
      : browserLanguage.startsWith('en')
        ? 'en-US'
        : 'zh-CN'
  );

  const currentLanguage = computed(() => languageConfig[locale.value]);
  const languageOptions = computed(() => Object.values(languageConfig));
  const isChinese = computed(() => locale.value === 'zh-CN');
  const dictionary = computed(() => messages[locale.value] || messages['zh-CN']);

  watch(
    locale,
    (value) => {
      document.documentElement.lang = value;
      localStorage.setItem(STORAGE_KEY, value);
    },
    { immediate: true }
  );

  const setLocale = (value) => {
    if (isSupportedLanguage(value)) {
      locale.value = value;
    }
  };

  const t = (path, params) => {
    const result = resolvePath(dictionary.value, path);
    return interpolate(result ?? path, params);
  };

  const tm = (path, fallback = {}) => {
    return resolvePath(dictionary.value, path) ?? fallback;
  };

  const formatDate = (value, options) => {
    return new Intl.DateTimeFormat(locale.value, options).format(new Date(value));
  };

  const formatTime = (value, options) => {
    return new Intl.DateTimeFormat(locale.value, {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(new Date(value));
  };

  return {
    locale,
    currentLanguage,
    languageOptions,
    isChinese,
    dictionary,
    setLocale,
    t,
    tm,
    formatDate,
    formatTime,
  };
});
