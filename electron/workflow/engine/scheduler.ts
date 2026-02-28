/**
 * Topological sort and parallel scheduling.
 */
interface SimpleEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export function topologicalLevels(
  nodeIds: string[],
  edges: SimpleEdge[],
): string[][] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of edges) {
    adj.get(e.sourceNodeId)?.push(e.targetNodeId);
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
  }
  const levels: string[][] = [];
  let queue = nodeIds.filter((id) => inDegree.get(id) === 0);
  while (queue.length > 0) {
    levels.push([...queue]);
    const nextQueue: string[] = [];
    for (const node of queue) {
      for (const neighbor of adj.get(node) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }
  return levels;
}

export function downstreamNodes(
  startNodeId: string,
  nodeIds: string[],
  edges: SimpleEdge[],
): string[] {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) adj.get(e.sourceNodeId)?.push(e.targetNodeId);
  const visited = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return Array.from(visited);
}
