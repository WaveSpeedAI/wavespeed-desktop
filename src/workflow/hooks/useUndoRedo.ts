/**
 * Undo/Redo hook using command pattern.
 */
import { useState, useCallback } from "react";

export interface Command {
  type: string;
  execute: () => void;
  undo: () => void;
}

export function useUndoRedo() {
  const [undoStack, setUndoStack] = useState<Command[]>([]);
  const [redoStack, setRedoStack] = useState<Command[]>([]);

  const execute = useCallback((command: Command) => {
    command.execute();
    setUndoStack((prev) => [...prev, command]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const command = prev[prev.length - 1];
      command.undo();
      setRedoStack((r) => [...r, command]);
      return prev.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const command = prev[prev.length - 1];
      command.execute();
      setUndoStack((u) => [...u, command]);
      return prev.slice(0, -1);
    });
  }, []);

  return {
    execute,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
