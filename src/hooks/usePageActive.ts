/**
 * Hook that tells a persistent page whether it is currently the active (visible) page.
 *
 * Pages can use this to:
 * - Skip expensive effects (resize listeners, keyboard handlers, polling)
 * - Pause workers or animations
 * - Avoid unnecessary re-renders from store subscriptions
 *
 * Uses the location pathname from React Router so it stays in sync with
 * the Layout's show/hide logic without any extra context plumbing.
 */
import { useLocation } from "react-router-dom";

/**
 * Returns `true` when the current route matches `pagePath`.
 * Supports exact match and prefix match (when pagePath ends with no trailing slash
 * and the pathname starts with pagePath + "/").
 * Cheap — no context, no state, just a string comparison each render.
 */
export function usePageActive(pagePath: string): boolean {
  const { pathname } = useLocation();
  return pathname === pagePath || pathname.startsWith(pagePath + "/");
}

// ── Visibility-aware event listener helpers ──────────────────────────

/**
 * Registers a window event listener only while the page is active.
 * Automatically adds/removes the listener when visibility changes.
 */
import { useEffect } from "react";

export function useActiveEventListener<K extends keyof WindowEventMap>(
  isActive: boolean,
  event: K,
  handler: (ev: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
) {
  useEffect(() => {
    if (!isActive) return;
    window.addEventListener(event, handler, options);
    return () => window.removeEventListener(event, handler, options);
  }, [isActive, event, handler, options]);
}
