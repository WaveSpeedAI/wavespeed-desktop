/**
 * Keeps the last non-null value alive during a dialog's close animation.
 *
 * Problem: Radix Dialog has a ~200ms exit animation. If we set the data to
 * `null` immediately on close, the dialog content disappears while the
 * backdrop is still fading out → visible flash of an empty dialog.
 *
 * Solution: This hook returns the "stale" value during the animation period
 * so the dialog content stays rendered until it's fully hidden.
 *
 * Usage:
 *   const [item, setItem] = useState<T | null>(null);
 *   const deferredItem = useDeferredClose(item);
 *   // Use `!!item` for open state, `deferredItem` for content rendering
 */
import { useRef } from "react";

export function useDeferredClose<T>(value: T | null): T | null {
  const ref = useRef<T | null>(value);
  if (value !== null) {
    ref.current = value;
  }
  return value !== null ? value : ref.current;
}
