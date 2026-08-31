/**
 * Bundled meme fonts.
 *
 * The meme fonts used to be a list of OS system fonts (Impact, Comic Sans
 * MS, ...). On any device that does not ship them — Linux, Android, most
 * non-Windows browsers — the canvas silently falls back to the same generic
 * sans-serif, so "half the fonts look identical". Fix: ship real font files
 * with the app and register them through the FontFace API so every entry in
 * the picker genuinely renders, identically in the live preview (main
 * thread) and in the generated output (worker, via `self.fonts`).
 *
 * All files are OFL/Apache-licensed and live in `public/fonts/`.
 * `ensureMemeFonts()` is idempotent: it fetches + registers every face once
 * and caches the raw ArrayBuffers so the worker can register its own copies.
 */

export interface MemeFontDef {
  family: string
  files: { url: string; weight: string }[]
}

/** One loaded face ready to be handed to the worker. */
export interface MemeFontData {
  family: string
  weight: string
  data: ArrayBuffer
}

export const DEFAULT_MEME_FONT = 'Anton'

export const MEME_FONT_DEFS: MemeFontDef[] = [
  {
    family: 'Anton',
    files: [{ url: '/fonts/Anton-Regular.ttf', weight: '400' }],
  },
  {
    family: 'Bangers',
    files: [{ url: '/fonts/Bangers-Regular.ttf', weight: '400' }],
  },
  {
    family: 'Luckiest Guy',
    files: [{ url: '/fonts/LuckiestGuy-Regular.ttf', weight: '400' }],
  },
  {
    family: 'Archivo Black',
    files: [{ url: '/fonts/ArchivoBlack-Regular.ttf', weight: '400' }],
  },
  {
    family: 'Comic Neue',
    files: [
      { url: '/fonts/ComicNeue-Regular.ttf', weight: '400' },
      { url: '/fonts/ComicNeue-Bold.ttf', weight: '700' },
    ],
  },
  {
    family: 'DejaVu Sans',
    files: [
      { url: '/fonts/DejaVuSans.ttf', weight: '400' },
      { url: '/fonts/DejaVuSans-Bold.ttf', weight: '700' },
    ],
  },
  {
    family: 'Tinos',
    files: [
      { url: '/fonts/Tinos-Regular.ttf', weight: '400' },
      { url: '/fonts/Tinos-Bold.ttf', weight: '700' },
    ],
  },
  {
    family: 'Liberation Mono',
    files: [
      { url: '/fonts/LiberationMono-Regular.ttf', weight: '400' },
      { url: '/fonts/LiberationMono-Bold.ttf', weight: '700' },
    ],
  },
]

/** Picker order. */
export const MEME_FONT_FAMILIES = MEME_FONT_DEFS.map((d) => d.family)

/**
 * States saved before the bundled fonts existed may reference system font
 * names — map them to the closest bundled face so old memes keep rendering.
 * Keep this in sync with MEME_FONT_LEGACY in worker-source.ts.
 */
const LEGACY_FONT_MAP: Record<string, string> = {
  Impact: 'Anton',
  'Arial Black': 'Archivo Black',
  'Comic Sans MS': 'Comic Neue',
  Verdana: 'DejaVu Sans',
  'Trebuchet MS': 'DejaVu Sans',
  Georgia: 'Tinos',
  'Times New Roman': 'Tinos',
  'Courier New': 'Liberation Mono',
}

/** Resolve an element font to a family that is guaranteed to be bundled. */
export function resolveMemeFont(family?: string): string {
  const fam = family || DEFAULT_MEME_FONT
  return LEGACY_FONT_MAP[fam] ?? fam
}

let loadedData: MemeFontData[] | null = null
let pending: Promise<MemeFontData[]> | null = null

/**
 * Fetch + register every bundled font on the main thread (preview canvas and
 * CSS) and cache the ArrayBuffers for the worker. Resolves with whatever
 * loaded successfully; individual failures are swallowed so one bad font
 * never blocks the tool.
 */
export function ensureMemeFonts(): Promise<MemeFontData[]> {
  if (loadedData) return Promise.resolve(loadedData)
  if (!pending) pending = loadMemeFonts()
  return pending
}

async function loadMemeFonts(): Promise<MemeFontData[]> {
  const out: MemeFontData[] = []
  const jobs: Promise<void>[] = []
  for (const def of MEME_FONT_DEFS) {
    for (const file of def.files) {
      jobs.push(
        (async () => {
          try {
            const res = await fetch(file.url)
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.arrayBuffer()
            if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
              const face = new FontFace(def.family, data, {
                weight: file.weight,
                display: 'swap',
              })
              document.fonts.add(face)
              await face.load()
            }
            out.push({ family: def.family, weight: file.weight, data })
          } catch (e) {
            console.error(`[meme-fonts] failed to load ${file.url}:`, e)
          }
        })()
      )
    }
  }
  await Promise.all(jobs)
  loadedData = out
  return out
}
