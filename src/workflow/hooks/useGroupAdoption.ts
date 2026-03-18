/**
 * useGroupAdoption — Hook that manages the relationship between Group
 * containers and their child nodes.
 *
 * Key behaviors:
 * - External nodes CAN be dragged into an Iterator — they are adopted on drop
 * - Child nodes CAN be dragged out of their parent Iterator — released on drop outside
 * - Auto-adopts newly created nodes if their position falls inside an Iterator
 * - Releases children before deletion and updates bounding boxes
 */
import { useCallback, useRef } from "react";
import type { NodeChange } from "reactflow";
import { useWorkflowStore } from "../stores/workflow.store";
import { useUIStore } from "../stores/ui.store";

/* ── constants ─────────────────────────────────────────────────────── */

const RELEASE_THRESHOLD = 30; // px beyond the iterator edge to trigger release

/* ── hook ──────────────────────────────────────────────────────────── */

export function useGroupAdoption() {
  const draggingNodesRef = useRef<Set<string>>(new Set());

  /**
   * Call this from the onNodesChange wrapper to:
   * 1. When a child node is dropped near/outside the Iterator edge, release it
   * 2. When an external node is dropped inside an Iterator, adopt it
   */
  const handleNodesChangeForAdoption = useCallback((changes: NodeChange[]) => {
    const posChanges = changes.filter(
      (
        c,
      ): c is NodeChange & {
        type: "position";
        id: string;
        dragging?: boolean;
        position?: { x: number; y: number };
      } => c.type === "position",
    );
    if (posChanges.length === 0) return;

    // Track dragging state
    for (const change of posChanges) {
      if (change.dragging === true) {
        draggingNodesRef.current.add(change.id);
      }
      if (change.dragging === false) {
        draggingNodesRef.current.delete(change.id);
      }
    }

    // Skip adoption/release when in subgraph editing mode
    const editingGroupId = useUIStore.getState().editingGroupId;
    if (editingGroupId) {
      return;
    }

    // Drag-to-adopt/release is disabled — nodes should only be added to groups
    // via subgraph editing mode. Clear any stale drop hints.
    const anyStillDragging = draggingNodesRef.current.size > 0;
    if (!anyStillDragging) {
      useUIStore.getState().setIteratorDropTarget(null);
    }
  }, []);

  /**
   * Call after a new node is created.
   *
   * External nodes (dragged from palette or pasted) are NOT auto-adopted
   * into iterators. Adoption is handled directly by the NodePalette when
   * pendingIteratorParentId is set.
   */
  const handleNodeCreated = useCallback((_newNodeId: string) => {
    // No-op: adoption is handled by NodePalette.handleClick when
    // pendingIteratorParentId is set. External drag/paste should NOT
    // auto-adopt into iterators.
  }, []);

  /**
   * Call before nodes are deleted. For each deleted node that has a parentNode
   * (i.e., is a child of an Iterator), release it and update the bounding box.
   */
  const handleNodesDeleted = useCallback((deletedNodeIds: string[]) => {
    const { nodes, releaseNode, updateBoundingBox } =
      useWorkflowStore.getState();

    const affectedIteratorIds = new Set<string>();

    for (const nodeId of deletedNodeIds) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || !node.parentNode) continue;

      const parentId = node.parentNode;
      releaseNode(parentId, nodeId);
      affectedIteratorIds.add(parentId);
    }

    // Update bounding boxes for all affected iterators
    for (const itId of affectedIteratorIds) {
      updateBoundingBox(itId);
    }
  }, []);

  return {
    handleNodesChangeForAdoption,
    handleNodeCreated,
    handleNodesDeleted,
  };
}
