import { useEffect, useState, type RefObject } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { backend } from '../services/backend';

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
    let unlisten: (() => void) | null = null;

    appWindow.isVisible()
      .then((visible) => {
        if (mounted) {
          setWindowVisible(visible);
        }
      })
      .catch(() => {
        if (mounted) {
          setWindowVisible(true);
        }
      });

    appWindow.onFocusChanged(({ payload: focused }) => {
      setWindowVisible(focused);
    })
      .then((stopListening) => {
        if (mounted) {
          unlisten = stopListening;
          return;
        }
        stopListening();
      })
      .catch(() => {
        if (mounted) {
          setWindowVisible(true);
        }
      });

    return () => {
      mounted = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return windowVisible;
}
