import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMessageText,
  normalizeRole,
  normalizeMessage,
  normalizeMessages,
  normalizeConversation,
  createWelcomeMessage,
  createLocalConversation,
  createMessageId,
} from '../utils/chatHelpers.js';

describe('getMessageText', () => {
  it('returns text from msg.text', () => {
    expect(getMessageText({ text: 'hello' })).toBe('hello');
  });

  it('falls back to msg.content', () => {
    expect(getMessageText({ content: 'world' })).toBe('world');
  });

  it('falls back to msg.message', () => {
    expect(getMessageText({ message: 'fallback' })).toBe('fallback');
  });

  it('returns empty string for null/undefined', () => {
    expect(getMessageText(null)).toBe('');
    expect(getMessageText(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(getMessageText({ text: '  hello  ' })).toBe('hello');
  });

  it('converts non-string to string', () => {
    expect(getMessageText({ text: 123 })).toBe('123');
  });
});

describe('normalizeRole', () => {
  it('converts assistant to model', () => {
    expect(normalizeRole('assistant')).toBe('model');
  });

  it('keeps user as user', () => {
    expect(normalizeRole('user')).toBe('user');
  });

  it('defaults to model for empty/undefined', () => {
    expect(normalizeRole('')).toBe('model');
    expect(normalizeRole(undefined)).toBe('model');
  });
});

describe('normalizeMessage', () => {
  it('generates id when missing', () => {
    const msg = normalizeMessage({ text: 'hi' });
    expect(msg.id).toBeTruthy();
    expect(msg.id).toMatch(/\d+-\w+/);
  });

  it('preserves existing id', () => {
    const msg = normalizeMessage({ id: 'custom-id', text: 'hi' });
    expect(msg.id).toBe('custom-id');
  });

  it('normalizes role', () => {
    const msg = normalizeMessage({ role: 'assistant', text: 'hi' });
    expect(msg.role).toBe('model');
  });

  it('generates timestamp when missing', () => {
    const before = new Date();
    const msg = normalizeMessage({ text: 'hi' });
    const after = new Date();
    expect(msg.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(msg.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('normalizeMessages', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeMessages(null)).toEqual([]);
    expect(normalizeMessages(undefined)).toEqual([]);
    expect(normalizeMessages('string')).toEqual([]);
  });

  it('normalizes each message in array', () => {
    const result = normalizeMessages([{ text: 'a' }, { text: 'b' }]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('a');
    expect(result[1].text).toBe('b');
  });
});

describe('normalizeConversation', () => {
  it('generates id when missing', () => {
    const conv = normalizeConversation({});
    expect(conv.id).toMatch(/^local_/);
  });

  it('uses default title when missing', () => {
    const conv = normalizeConversation({}, 2);
    expect(conv.title).toBe('新会话 3');
  });

  it('fills welcome message when messages empty', () => {
    const conv = normalizeConversation({ messages: [] });
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].id).toBe('welcome');
  });

  it('preserves existing messages', () => {
    const conv = normalizeConversation({
      id: 'c1',
      title: 'Test',
      messages: [{ text: 'hello', role: 'user' }],
    });
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].text).toBe('hello');
  });
});

describe('createWelcomeMessage', () => {
  it('has correct structure', () => {
    const msg = createWelcomeMessage();
    expect(msg.id).toBe('welcome');
    expect(msg.role).toBe('model');
    expect(msg.content).toContain('武理小精灵');
    expect(msg.timestamp).toBeInstanceOf(Date);
  });
});

describe('createLocalConversation', () => {
  it('creates conversation with title', () => {
    const conv = createLocalConversation('My Chat');
    expect(conv.title).toBe('My Chat');
    expect(conv.id).toMatch(/^local_/);
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].id).toBe('welcome');
  });

  it('uses default title with message count', () => {
    const conv = createLocalConversation(null, 5);
    expect(conv.title).toBe('新会话 6');
  });
});

describe('createMessageId', () => {
  it('generates unique ids', () => {
    const id1 = createMessageId();
    const id2 = createMessageId();
    expect(id1).not.toBe(id2);
  });

  it('contains timestamp and random part', () => {
    const id = createMessageId();
    expect(id).toMatch(/^\d+-[a-z0-9]{6}$/);
  });
});
