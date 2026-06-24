import type { ProcessorType } from './types'

/**
 * Maps a tool id to its real processor. Grows each build step.
 * Tools not yet in this map run the `passthrough` engine preview.
 */
export const toolProcessors: Partial<Record<string, ProcessorType>> = {}

export function getProcessor(toolId: string): ProcessorType {
  return toolProcessors[toolId] ?? 'passthrough'
}

export function isImplemented(toolId: string): boolean {
  return toolId in toolProcessors
}
