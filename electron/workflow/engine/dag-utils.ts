/**
 * DAG validation — cycle detection using DFS.
 */
export interface SimpleEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export function hasCycle(nodeIds: string[], edges: SimpleEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) adj.get(e.sourceNodeId)?.push(e.targetNodeId);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);
  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const neighbor of adj.get(node) ?? []) {
      const c = color.get(neighbor);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(neighbor)) return true;
    }
    color.set(node, BLACK);
    return false;
  }
  for (const id of nodeIds) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

export function wouldCreateCycle(
  nodeIds: string[],
  edges: SimpleEdge[],
  newEdge: SimpleEdge,
): boolean {
  return hasCycle(nodeIds, [...edges, newEdge]);
}

/**
 * Check whether adding `newEdge` would create a cycle within a sub-workflow
 * defined by `subNodeIds` and `internalEdges`. Only the sub-node scope is
 * considered — edges outside the sub-workflow are ignored.
 */
export function wouldCreateCycleInSubWorkflow(
  subNodeIds: string[],
  internalEdges: SimpleEdge[],
  newEdge: SimpleEdge,
): boolean {
  return hasCycle(subNodeIds, [...internalEdges, newEdge]);
}

/**
 * Return edges that cross the iterator boundary (one endpoint inside, one
 * outside), remapped so the inside endpoint is replaced with `iteratorNodeId`.
 * This lets the outer DAG treat the iterator as a single node.
 */
export function getExternalEdges(
  allEdges: SimpleEdge[],
  iteratorNodeId: string,
  childNodeIds: string[],
): SimpleEdge[] {
  const childSet = new Set(childNodeIds);
  const result: SimpleEdge[] = [];

  for (const edge of allEdges) {
    const srcInside = childSet.has(edge.sourceNodeId);
    const tgtInside = childSet.has(edge.targetNodeId);

    if (srcInside && !tgtInside) {
      // Edge going from inside the iterator to outside — remap source
      result.push({
        sourceNodeId: iteratorNodeId,
        targetNodeId: edge.targetNodeId,
      });
    } else if (!srcInside && tgtInside) {
      // Edge going from outside into the iterator — remap target
      result.push({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: iteratorNodeId,
      });
    }
    // Both inside → internal edge, skip
    // Both outside → not related to this iterator, skip
  }

  return result;
}

/**
 * Build the node list and edge list for outer-DAG validation. Iterator child
 * nodes are removed and their boundary-crossing edges are remapped onto the
 * iterator node ID. Fully internal edges are dropped.
 *
 * `iterators` is an array of `{ iteratorNodeId, childNodeIds }` — one entry
 * per iterator node in the workflow.
 */
export function buildOuterDAGView(
  allNodeIds: string[],
  allEdges: SimpleEdge[],
  iterators: { iteratorNodeId: string; childNodeIds: string[] }[],
): { nodeIds: string[]; edges: SimpleEdge[] } {
  // Collect all child node IDs across every iterator
  const allChildIds = new Set<string>();
  for (const it of iterators) {
    for (const cid of it.childNodeIds) allChildIds.add(cid);
  }

  // Outer node list: exclude child nodes (iterators themselves stay)
  const nodeIds = allNodeIds.filter((id) => !allChildIds.has(id));

  // Start with edges that don't touch any child node at all
  const edges: SimpleEdge[] = allEdges.filter(
    (e) => !allChildIds.has(e.sourceNodeId) && !allChildIds.has(e.targetNodeId),
  );

  // Add remapped external edges for each iterator
  for (const it of iterators) {
    const ext = getExternalEdges(allEdges, it.iteratorNodeId, it.childNodeIds);
    edges.push(...ext);
  }

  return { nodeIds, edges };
}
