import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupGlobalErrorHandler } from '../utils/errorHandler.js';

describe('setupGlobalErrorHandler', () => {
  let mockApp;
  let mockToastStore;
  let consoleErrorSpy;

  beforeEach(() => {
    mockApp = {
      config: {
        errorHandler: null,
      },
    };

    mockToastStore = {
      error: vi.fn(),
    };

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    // Clean up event listeners
    window.removeEventListener('unhandledrejection', () => {});
    window.removeEventListener('error', () => {});
  });

  it('sets up Vue error handler', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    expect(mockApp.config.errorHandler).toBeDefined();
    expect(typeof mockApp.config.errorHandler).toBe('function');
  });

  it('calls toastStore.error on Vue component error', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    const error = new Error('Test error');
    const instance = { $options: { name: 'TestComponent' } };
    const info = 'render';

    mockApp.config.errorHandler(error, instance, info);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Vue Error]', error, 'render');
    expect(mockToastStore.error).toHaveBeenCalledWith('操作失败，请稍后重试');
  });

  it('handles missing toastStore gracefully', () => {
    setupGlobalErrorHandler(mockApp, null);

    const error = new Error('Test error');
    const instance = null;
    const info = 'render';

    // Should not throw
    expect(() => {
      mockApp.config.errorHandler(error, instance, info);
    }).not.toThrow();
  });

  it('handles unhandled promise rejections', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    const rejectionEvent = new Event('unhandledrejection');
    rejectionEvent.reason = new Error('Network error');
    rejectionEvent.preventDefault = vi.fn();

    window.dispatchEvent(rejectionEvent);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Unhandled Rejection]', rejectionEvent.reason);
    expect(mockToastStore.error).toHaveBeenCalledWith('网络连接失败，请确认后端服务已启动');
    expect(rejectionEvent.preventDefault).toHaveBeenCalled();
  });

  it('ignores AbortError in promise rejections', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    const rejectionEvent = new Event('unhandledrejection');
    rejectionEvent.reason = new Error('Aborted');
    rejectionEvent.reason.name = 'AbortError';
    rejectionEvent.preventDefault = vi.fn();

    window.dispatchEvent(rejectionEvent);

    expect(mockToastStore.error).not.toHaveBeenCalled();
    expect(rejectionEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores navigation errors in promise rejections', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    const rejectionEvent = new Event('unhandledrejection');
    rejectionEvent.reason = new Error('navigation aborted');
    rejectionEvent.preventDefault = vi.fn();

    window.dispatchEvent(rejectionEvent);

    expect(mockToastStore.error).not.toHaveBeenCalled();
    expect(rejectionEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('handles global JS errors', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    const errorEvent = new Event('error');
    errorEvent.error = new Error('Script error');
    errorEvent.message = 'Script error';

    window.dispatchEvent(errorEvent);

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Global Error]', errorEvent.error);
    expect(mockToastStore.error).toHaveBeenCalledWith('操作失败，请稍后重试');
  });

  it('ignores resource loading errors', () => {
    setupGlobalErrorHandler(mockApp, mockToastStore);

    // Create a custom event with target property
    const errorEvent = new CustomEvent('error', {
      detail: { message: 'Failed to load resource' },
    });

    // Mock the target property using Object.defineProperty
    Object.defineProperty(errorEvent, 'target', {
      value: { tagName: 'IMG' },
      writable: false,
    });

    window.dispatchEvent(errorEvent);

    expect(mockToastStore.error).not.toHaveBeenCalled();
  });
});
