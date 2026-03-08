import { memo, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface PersistentPageProps {
  /** Whether this page has been visited (controls mounting) */
  visited: boolean;
  /** Whether this page is currently active/visible */
  active: boolean;
  /** Unique key for forcing remount on reset */
  pageKey: number;
  /** The lazy-loaded page component */
  children: ReactNode;
}

const LoadingFallback = (
  <div className="flex h-full items-center justify-center">
    <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
  </div>
);

/**
 * Wrapper for persistent pages that:
 * 1. Only mounts children after first visit
 * 2. Uses CSS to hide inactive pages (display:none)
 * 3. Is memoized to prevent re-renders when other pages change
 * 4. Wraps children in Suspense for lazy loading
 */
export const PersistentPage = memo(function PersistentPage({
  visited,
  active,
  children,
}: PersistentPageProps) {
  if (!visited) return null;

  return (
    <div
      className={active ? "h-full overflow-auto" : "hidden"}
      // content-visibility helps the browser skip layout/paint for hidden subtrees
      style={active ? undefined : { contentVisibility: "hidden" }}
    >
      <Suspense fallback={active ? LoadingFallback : null}>{children}</Suspense>
    </div>
  );
});
