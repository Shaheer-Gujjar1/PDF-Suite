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
  'word-to-pdf': 'word-to-pdf',
  'excel-to-pdf': 'excel-to-pdf',
  'pdf-to-excel': 'pdf-to-excel',
  'page-numbers': 'page-numbers',
  watermark: 'watermark',
  protect: 'protect',
  'pdf-to-images': 'pdf-to-images',
  'html-to-pdf': 'html-to-pdf',
  organize: 'organize',
  crop: 'crop',
  'sign-annotate': 'sign-annotate',
  'edit-text': 'edit-text',
  'crop-images': 'crop-images',
  'convert-images': 'convert-images',
  'favicon-generator': 'favicon-generator',
}

export function getProcessor(toolId: string): ProcessorType {
  return toolProcessors[toolId] ?? 'passthrough'
}

export function isImplemented(toolId: string): boolean {
  return toolId in toolProcessors
}
