/**
 * DAG validation — cycle detection using DFS.
 */
interface SimpleEdge { sourceNodeId: string; targetNodeId: string }

export function hasCycle(nodeIds: string[], edges: SimpleEdge[]): boolean {
  const adj = new Map<string, string[]>()
  for (const id of nodeIds) adj.set(id, [])
  for (const e of edges) adj.get(e.sourceNodeId)?.push(e.targetNodeId)
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const id of nodeIds) color.set(id, WHITE)
  function dfs(node: string): boolean {
    color.set(node, GRAY)
    for (const neighbor of adj.get(node) ?? []) {
      const c = color.get(neighbor)
      if (c === GRAY) return true
      if (c === WHITE && dfs(neighbor)) return true
    }
    color.set(node, BLACK)
    return false
  }
  for (const id of nodeIds) { if (color.get(id) === WHITE && dfs(id)) return true }
  return false
}

export function wouldCreateCycle(nodeIds: string[], edges: SimpleEdge[], newEdge: SimpleEdge): boolean {
  return hasCycle(nodeIds, [...edges, newEdge])
}
