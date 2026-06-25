import type { ProcessorType } from './types'

/**
 * Maps a tool id to its real processor. Grows each build step.
 * Tools not yet in this map run the `passthrough` engine preview.
 *
 * Step 3: merge, split, rotate, images-to-pdf.
 */
export const toolProcessors: Partial<Record<string, ProcessorType>> = {
  merge: 'merge',
  split: 'split',
  rotate: 'rotate',
  'images-to-pdf': 'images-to-pdf',
  compress: 'compress',
  repair: 'repair',
  unlock: 'unlock',
}

export function getProcessor(toolId: string): ProcessorType {
  return toolProcessors[toolId] ?? 'passthrough'
}

export function isImplemented(toolId: string): boolean {
  return toolId in toolProcessors
}
