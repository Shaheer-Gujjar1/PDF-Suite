/**
 * Fetches heavy library UMD bundles on the main thread (once, cached) so they
 * can be embedded directly into the worker's Blob source. This makes the worker
 * fully self-contained — no runtime importScripts, no cross-origin worker
 * script loading, and it works offline after the first fetch.
 *
 * Libraries are loaded from the jsDelivr CDN (sends `Access-Control-Allow-Origin: *`).
 */

const LIB_URLS: { id: string; url: string }[] = [
  {
    id: 'pdf-lib',
    url: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  },
  // mammoth, xlsx, docx are loaded lazily via importScripts inside the worker
  // (embedding large minified UMD bundles in the Blob can corrupt regex
  // parsing at the boundary between libraries).
]

/** URLs for libraries loaded via importScripts inside the worker (lazy). */
export const WORKER_IMPORT_URLS: Record<string, string> = {
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  docx: 'https://cdn.jsdelivr.net/npm/docx@9.0.3/build/index.umd.js',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
}

let cache: string | null = null
let inflight: Promise<string> | null = null

export async function getLibSources(): Promise<string> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const parts = await Promise.all(
      LIB_URLS.map(async ({ id, url }) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Failed to load ${id} (${res.status})`)
        const text = await res.text()
        return `/* ===== ${id} ===== */\n${text}\n`
      })
    )
    cache = parts.join('\n;\n')
    return cache
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export function isLibCached(): boolean {
  return cache !== null
}
