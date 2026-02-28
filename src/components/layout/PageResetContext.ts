import { createContext } from "react";

// Context for resetting persistent pages (forces remount by changing key)
// Extracted to its own file to avoid pulling in Layout's heavy imports (WorkflowPage, etc.)
// when only the context is needed.
export const PageResetContext = createContext<{
  resetPage: (path: string) => void;
}>({
  resetPage: () => {},
});
