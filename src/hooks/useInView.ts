import { useEffect, useRef, useState } from "react";

export function useInView<T extends Element>(
  options?: IntersectionObserverInit,
) {
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);
  const root = options?.root ?? null;
  const rootMargin = options?.rootMargin ?? "200px";
  const threshold = options?.threshold ?? 0;

  useEffect(() => {
    if (isInView) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { root, rootMargin, threshold },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isInView, root, rootMargin, threshold]);

  return { ref, isInView };
}
