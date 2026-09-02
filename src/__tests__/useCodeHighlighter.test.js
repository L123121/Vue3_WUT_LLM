import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCodeHighlighter } from '../composables/useCodeHighlighter.js';

// Mock highlight.js
vi.mock('highlight.js/lib/core', () => ({
  default: {
    getLanguage: vi.fn((lang) => {
      const supportedLanguages = ['javascript', 'python', 'typescript', 'json'];
      return supportedLanguages.includes(lang);
    }),
    highlight: vi.fn((code, options) => ({
      value: `<span class="hljs-keyword">${code}</span>`,
    })),
    highlightAuto: vi.fn((code) => ({
      value: `<span class="hljs-auto">${code}</span>`,
      language: 'javascript',
    })),
    registerLanguage: vi.fn(),
  },
}));

describe('useCodeHighlighter', () => {
  let highlighter;

  beforeEach(() => {
    highlighter = useCodeHighlighter();
    vi.clearAllMocks();
  });

  describe('escapeHtml', () => {
    it('escapes HTML entities', () => {
      expect(highlighter.escapeHtml('<div>test</div>')).toBe('&lt;div&gt;test&lt;/div&gt;');
    });

    it('escapes ampersands', () => {
      expect(highlighter.escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes quotes', () => {
      expect(highlighter.escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('escapes single quotes', () => {
      expect(highlighter.escapeHtml("'hello'")).toBe('&#39;hello&#39;');
    });

    it('handles empty string', () => {
      expect(highlighter.escapeHtml('')).toBe('');
    });
  });

  describe('getLanguageLabel', () => {
    it('returns correct label for known languages', () => {
      expect(highlighter.getLanguageLabel('javascript')).toBe('javascript');
      expect(highlighter.getLanguageLabel('js')).toBe('javascript');
      expect(highlighter.getLanguageLabel('python')).toBe('python');
      expect(highlighter.getLanguageLabel('py')).toBe('python');
    });

    it('returns lowercase label', () => {
      expect(highlighter.getLanguageLabel('JavaScript')).toBe('javascript');
      expect(highlighter.getLanguageLabel('PYTHON')).toBe('python');
    });

    it('returns text for unknown languages', () => {
      expect(highlighter.getLanguageLabel('unknown')).toBe('unknown');
      expect(highlighter.getLanguageLabel('')).toBe('text');
      expect(highlighter.getLanguageLabel(null)).toBe('text');
    });
  });

  describe('isExecutableLanguage', () => {
    it('returns true for JavaScript', () => {
      expect(highlighter.isExecutableLanguage('javascript')).toBe(true);
      expect(highlighter.isExecutableLanguage('js')).toBe(true);
    });

    it('returns true for TypeScript', () => {
      expect(highlighter.isExecutableLanguage('typescript')).toBe(true);
      expect(highlighter.isExecutableLanguage('ts')).toBe(true);
    });

    it('returns false for non-executable languages', () => {
      expect(highlighter.isExecutableLanguage('python')).toBe(false);
      expect(highlighter.isExecutableLanguage('html')).toBe(false);
      expect(highlighter.isExecutableLanguage('css')).toBe(false);
    });

    it('handles case insensitivity', () => {
      expect(highlighter.isExecutableLanguage('JavaScript')).toBe(true);
      expect(highlighter.isExecutableLanguage('JAVASCRIPT')).toBe(true);
    });
  });

  describe('highlightCode', () => {
    it('highlights known languages', () => {
      const result = highlighter.highlightCode('const x = 1;', 'javascript');
      expect(result).toContain('hljs-keyword');
    });

    it('uses auto detection for unknown languages', () => {
      const result = highlighter.highlightCode('some code', 'unknown');
      expect(result).toContain('hljs-auto');
    });

    it('falls back to escaped HTML on error', async () => {
      // Import the mocked module
      const hljsModule = await import('highlight.js/lib/core');
      const hljs = hljsModule.default;

      // Store original implementations
      const originalHighlight = hljs.highlight;
      const originalHighlightAuto = hljs.highlightAuto;

      // Mock both to throw error
      hljs.highlight = vi.fn(() => {
        throw new Error('Highlight error');
      });
      hljs.highlightAuto = vi.fn(() => {
        throw new Error('HighlightAuto error');
      });

      const result = highlighter.highlightCode('const x = 1;', 'javascript');
      expect(result).toBe('const x = 1;');

      // Restore original implementations
      hljs.highlight = originalHighlight;
      hljs.highlightAuto = originalHighlightAuto;
    });
  });

  describe('highlightVersion', () => {
    it('is shared across composable instances (module-level state)', () => {
      const another = useCodeHighlighter();
      expect(another.highlightVersion).toBe(highlighter.highlightVersion);
    });
  });

  describe('loadedLanguages', () => {
    it('is shared across composable instances (module-level state)', () => {
      const another = useCodeHighlighter();
      expect(another.loadedLanguages).toBe(highlighter.loadedLanguages);
    });
  });
});
