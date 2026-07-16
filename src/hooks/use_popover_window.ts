import { useEffect, useState, type RefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { backend } from '../services/backend';

const VISIBILITY_READ_ERROR_MESSAGE = 'Failed to read popover window visibility';
const FOCUS_SUBSCRIPTION_ERROR_MESSAGE = 'Failed to subscribe to popover focus changes';

/**
 * Tracks popover window visibility (via focus events) and keeps the
 * window height in sync with the rendered content while visible.
 * Returns the current visibility.
 */
export function usePopoverWindow(
  containerRef: RefObject<HTMLDivElement | null>,
  resizeDeps: readonly unknown[],
): boolean {
  const [windowVisible, setWindowVisible] = useState(false);

  // Auto-resize window to content.
  useEffect(() => {
    if (!windowVisible) {
      return;
    }

    const updateHeight = async () => {
      if (containerRef.current) {
        const height = containerRef.current.scrollHeight + 24;
        try {
          await backend.resizeWindow(Math.min(Math.max(height, 300), 620));
        } catch (err) {
          console.error('Failed to resize window:', err);
        }
      }
    };

    const timer1 = setTimeout(updateHeight, 50);
    const timer2 = setTimeout(updateHeight, 300);

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowVisible, containerRef, ...resizeDeps]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      setWindowVisible(true);
      return;
    }

    const appWindow = getCurrentWindow();
    let mounted = true;
    let read_superseded = false;
    let unlisten: (() => void) | null = null;

    const handle_read_failure = () => {
      if (!mounted) return;
      console.error(VISIBILITY_READ_ERROR_MESSAGE);
      if (!read_superseded) {
        setWindowVisible(false);
      }
    };

    const handle_subscription_failure = () => {
      if (!mounted) return;
      read_superseded = true;
      console.error(FOCUS_SUBSCRIPTION_ERROR_MESSAGE);
      setWindowVisible(false);
    };

    try {
      appWindow.isVisible().then((visible) => {
        if (mounted && !read_superseded) {
          setWindowVisible(visible);
        }
      }, handle_read_failure);
    } catch {
      handle_read_failure();
    }

    try {
      appWindow.onFocusChanged(({ payload: focused }) => {
        if (!mounted) return;
        read_superseded = true;
        setWindowVisible(focused);
      }).then((stopListening) => {
        if (mounted) {
          unlisten = stopListening;
          return;
        }
        stopListening();
      }, handle_subscription_failure);
    } catch {
      handle_subscription_failure();
    }

    return () => {
      mounted = false;
      const stop_listening = unlisten;
      unlisten = null;
      if (stop_listening) {
        stop_listening();
      }
    };
  }, []);

  return windowVisible;
}
