/**
 * Barrel re-export — the actual implementation lives in ./custom-node/CustomNode.tsx
 *
 * Keeps backward compatibility: external files can still import { CustomNode } from './CustomNode'
 */
export { CustomNode } from './custom-node/CustomNode'
export type { CustomNodeData } from './custom-node/CustomNode'
