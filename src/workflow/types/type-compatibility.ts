/**
 * Type compatibility system for parameter connections.
 */

import type { PortDataType } from './node-defs'

export const TYPE_COMPATIBILITY: Record<PortDataType, PortDataType[]> = {
  'text': ['text', 'any'],
  'boolean': ['boolean', 'any'],
  'url': ['url', 'image', 'video', 'audio', 'any'],
  'image': ['image', 'url', 'any'],
  'video': ['video', 'url', 'any'],
  'audio': ['audio', 'url', 'any'],
  'any': ['text', 'boolean', 'url', 'image', 'video', 'audio', 'any']
}

export function isCompatible(sourceType: PortDataType, targetType: PortDataType): boolean {
  const compatibleTargets = TYPE_COMPATIBILITY[sourceType]
  return compatibleTargets ? compatibleTargets.includes(targetType) : false
}

export function getCompatibleTypes(sourceType: PortDataType): PortDataType[] {
  return TYPE_COMPATIBILITY[sourceType] || []
}
