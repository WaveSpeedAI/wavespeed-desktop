/**
 * Unified persistent storage that works in both Electron and browser.
 *
 * Electron  → file-based via IPC (survives origin/port changes between dev restarts)
 * Browser   → localStorage fallback
 */

function hasElectronState(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.getState;
}

export const persistentStorage = {
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      if (hasElectronState()) {
        const v = await window.electronAPI.getState(key);
        return (v ?? null) as T | null;
      }
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: unknown): Promise<void> {
    try {
      if (hasElectronState()) {
        await window.electronAPI.setState(key, value);
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },

  async remove(key: string): Promise<void> {
    try {
      if (hasElectronState()) {
        await window.electronAPI.removeState(key);
      }
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },

  /** Synchronous read from localStorage only (for initial render before async hydrate). */
  getSync<T = unknown>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
};
