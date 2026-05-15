import { defineStore } from 'pinia';
import messages from '../i18n/messages.js';

const dictionary = messages['zh-CN'];

const resolvePath = (source, path) => {
  return path.split('.').reduce((current, key) => current?.[key], source);
};

const interpolate = (value, params = {}) => {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
};

export const useLanguageStore = defineStore('language', () => {
  const t = (path, params) => {
    const result = resolvePath(dictionary, path);
    return interpolate(result ?? path, params);
  };

  const tm = (path, fallback = {}) => {
    return resolvePath(dictionary, path) ?? fallback;
  };

  const formatDate = (value, options) => {
    return new Intl.DateTimeFormat('zh-CN', options).format(new Date(value));
  };

  const formatTime = (value, options) => {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    }).format(new Date(value));
  };

  return { t, tm, formatDate, formatTime };
});
