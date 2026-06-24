# PDF Suite — Worklog

This file is the shared worklog for the "All-in-One PDF Suite" build.
Each step appends a new section below (do NOT overwrite previous content).

---
Task ID: 1
Agent: main (orchestrator)
Task: Step 1 — Scaffold UI: theme system, routing, premium homepage layout, dark/light mode, tool grid.

Work Log:
- Installed nothing new (framer-motion, next-themes, lucide-react, sonner, shadcn/ui already present).
- Refined `src/app/globals.css` with a premium rose-accent palette (light/dark), plus utilities: `bg-grid`, `bg-dots`, `text-gradient`, `glass`, `shadow-glow`, custom scrollbar.
- Added `src/components/theme-provider.tsx` (next-themes wrapper) and wired it + Sonner Toaster into `src/app/layout.tsx` with new metadata.
- Built `src/lib/tools.ts`: registry of all 22 tools across 6 categories (Organize, Optimize, Convert to PDF, Convert from PDF, Edit, Security) with per-tool accent color, batch flag, `step` (build step that delivers it), optional `tag` (WASM/Beta). Includes static `accentClasses` map for Tailwind color safety.
- Built `src/lib/use-hash-route.ts`: hash-based router (`#/tool-id`) keeping the app on the single `/` route per project constraints.
- Built site chrome: `logo.tsx`, `site-header.tsx` (sticky glass header, logo, desktop nav, theme toggle, mobile Sheet menu), `site-footer.tsx` (sticky `mt-auto`, privacy/WASM/batch badges), `theme-toggle.tsx` (Light/Dark/System dropdown), `privacy-badge.tsx`.
- Built `tool-card.tsx` (animated, accent icon badge, Batch/WASM/Soon badges, hover lift).
- Built `home-view.tsx`: hero (gradient + grid bg, privacy badge, stats), trust bar, searchable categorized tool grid (live filter), features section, 3-step "how it works", gradient CTA band.
- Built `dropzone.tsx` (drag & drop, hidden file input, animated file list with size + remove/clear) and `tool-page.tsx` (breadcrumb, accent header, privacy badge, dropzone or HTML textarea, action bar with disabled "Available in Step X" + honest notice, related tools).
- Wired `src/app/page.tsx` with AnimatePresence route transitions + sticky-footer layout (`min-h-screen flex flex-col`, `flex-1 main`, `mt-auto footer`) + 404 tool fallback.

Stage Summary:
- Step 1 complete and browser-verified via Agent Browser:
  - Homepage renders all 22 tools / 6 categories with correct badges.
  - Hash routing works (`/#/merge` → tool page with dropzone, disabled Step-3 button, related tools).
  - Dropzone accepts files and lists them; process button enables and fires a Sonner toast.
  - Dark/Light/System theme toggle works (html class flips, bg color changes).
  - Live search filter works ("compress" → only Compress PDF).
  - No console errors / hydration mismatches; `bun run lint` clean; dev log clean.
- Architecture decisions for later steps:
  - Tool registry drives everything; each tool has a `step` so Step 2-6 work can flip `ready` and implement processing.
  - Dropzone is reusable and already Web-Worker-ready (pure File objects, no processing yet).
  - Single `/` route + hash routing is intentional (project constraint). Tool pages are components, not Next routes.
- Full-page screenshot saved at /tmp/pdf-suite-home.png.

---
Task ID: 2
Agent: main (orchestrator)
Task: Step 2 — Core Upload System: Web Worker pool, batch queue, progress reporting, ZIP download.

Work Log:
- Installed `jszip` (only new dependency for Step 2). pdf-lib/jspdf/pdfjs deferred to Step 3 per plan.
- Built `src/lib/processing/types.ts`: generic engine contract — Task (1+ inputs → 1+ outputs), ProcessorType union (passthrough + reserved names for Steps 3-6), WorkerMessage protocol (progress/log/result/error), PoolCallbacks, ProcessingItem, RunParams (mode: 'per-file' | 'single').
- Built `src/lib/processing/registry.ts`: toolId → processor map (empty in Step 2 → all tools fall back to passthrough preview). `isImplemented()` drives the UI label.
- Built `src/lib/processing/worker-source.ts`: the worker code as a self-contained classic-worker string (Blob-URL compatible). Implements passthrough processor with staged simulated work + streamed progress. NOTE: switched from `new Worker(new URL(...),{type:'module'})` to a Blob-URL classic worker because module workers enforce strict same-origin and failed to load in the cross-origin preview environment. Heavy libs in Step 3+ will load via `importScripts()` at the top of this string.
- Built `src/lib/processing/worker-pool.ts`: WorkerPool class — lazy worker creation from a shared Blob, FIFO queue, drains when workers go idle, transfers ArrayBuffer inputs/outputs zero-copy, routes progress/result/error/log via callbacks, terminate() revokes blob URLs + rejects pending tasks.
- Built `src/lib/zip.ts`: formatBytes, downloadBlob, downloadOutput, createZip (with name de-duplication), downloadZip. Uses jszip DEFLATE level 6.
- Built `src/hooks/use-processing.ts`: React state machine wrapping the pool. run() reads files→ArrayBuffer, builds tasks (per-file or single), enqueues all, tracks per-item status/progress/outputs via pool callbacks. Exposes overallProgress, concurrency, isWorking, hasResults, cancel, reset, downloadOne, downloadAll. Fixed react-hooks/refs lint by tracking concurrency in state (not ref-during-render).
- Built `src/components/processing-panel.tsx`: premium panel — header with pulsing icon + parallelism badge + overall status, overall progress bar, scrollable per-file list (max-h-96) with spinners/progress/checkmarks/error states + per-file Download, footer with Cancel/Start-over + Download All (.ZIP). AnimatePresence + motion for smooth item transitions.
- Rewrote `src/components/tool-page.tsx`: integrated useProcessing. Process button runs the engine (passthrough preview for unimplemented tools). Reads File→ArrayBuffer, selects mode (merge→single, html→single from text, else per-file). Shows ProcessingPanel below the dropzone with AnimatePresence. Honest "Engine preview" notice. Replaced old toast-only behavior.
- Deleted unused `src/workers/pdf-worker.ts` (replaced by blob worker).

Stage Summary:
- Step 2 complete and browser-verified via Agent Browser:
  - Dropped 5 PDFs on Rotate → "4× parallel" badge, 5 live progress bars, all completed (100%, 0 errors), "5 files ready to download", 5 per-file Download buttons + Download All (.ZIP).
  - Single-file download produced `batch-1-processed.pdf` blob ✓.
  - ZIP download produced `pdf-suite-output.zip` blob + "Downloaded 5 files as ZIP" toast ✓.
  - Merge (single-mode path): 4 inputs → 1 "Merged document" item with 4 outputs, "4 files ready to download", single Download zips the item's outputs ✓.
  - Start-over reset clears the panel cleanly; no console errors; lint clean.
- Key architectural decisions:
  - **Blob-URL classic worker** (not module worker) for cross-origin reliability. Step 3+ libs load via `importScripts()`.
  - **Generic Task model** (inputs[]→outputs[]) powers ALL tool shapes: per-file batch (parallel), single multi-file (merge), single→many (split). The hook just picks `mode`.
  - **Transferable ArrayBuffers** end-to-end (zero-copy main↔worker).
  - **Concurrency cap = min(hardwareConcurrency, 6)**.
  - Engine runs in **preview mode** for not-yet-built tools (passthrough) so the whole pipeline is demonstrable now; `registry.ts` flips tools to real processors in Steps 3-6.
- Ready for Step 3: implement real processors (merge/split/rotate/images-to-pdf) in the worker via pdf-lib/jsPDF; just add processor functions + register in `toolProcessors` map.
