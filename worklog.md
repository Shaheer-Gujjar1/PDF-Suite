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

---
Task ID: 3
Agent: main (orchestrator)
Task: Step 3 — Category A tools (Merge, Split, Rotate, Images to PDF) using pdf-lib with batch processing.

Work Log:
- Installed `pdf-lib` (runtime via CDN-embedded-in-blob; npm package documents the dep + gives types).
- Built `src/lib/processing/libs.ts`: fetches pdf-lib UMD from jsDelivr once (cached), so it can be embedded into the worker Blob (self-contained worker, no runtime importScripts, works offline after first load).
- Rewrote `src/lib/processing/worker-source.ts`: added 4 real pdf-lib processors — merge (copyPages), split (each-page + custom ranges via parseRanges), rotate (getRotation/setRotation + degrees), images-to-pdf (embedPng/embedJpg + OffscreenCanvas conversion for non-PNG/JPEG + fit/A4/Letter page sizing). Fixed critical bug: renamed accessor `PDFLib()` → `getPDFLib()` because the top-level function declaration `function PDFLib()` was shadowing `self.PDFLib` (pdf-lib's UMD assignment) in the worker global scope.
- Updated `src/lib/processing/worker-pool.ts`: `init()` is now async — fetches lib source, prepends it to WORKER_SOURCE, creates one shared Blob URL, spawns workers. `enqueue`/`enqueueAll` await init. Single Blob URL shared across all workers (memory-efficient).
- Updated `src/lib/processing/registry.ts`: registered merge/split/rotate/images-to-pdf → these tools now flip from "preview" to "implemented".
- Updated `src/components/tool-card.tsx`: "Soon" badge now driven by `isImplemented(tool.id)` instead of `step <= 1`.
- Built `src/components/tool-options.tsx`: per-tool options UI — SplitOptions (each-page / custom-ranges radio + ranges input), RotateOptions (90°/180°/270° radio), ImagesOptions (single/multiple radio + page-size select). Premium radio-card design with has-[:checked] styling.
- Updated `src/components/tool-page.tsx`: options state via defaultOptions(tool.id), ToolOptions rendered when files present, reset on tool switch. handleProcess sets mode per tool (merge→single, images-to-pdf single-output→single, else per-file) and passes options through to run().
- Generated valid test assets: 3 multi-page PDFs (pdf-lib, 3/2/4 pages) + 3 colored PNG images (sharp) in /tmp.

Stage Summary:
- Step 3 complete and browser-verified via Agent Browser (all outputs validated by reloading them through pdf-lib in Node):
  - **Merge PDF**: 3 PDFs (3+2+4 pages) → merged.pdf verified at exactly 9 pages ✓
  - **Split PDF (each page)**: 3-page PDF → 3 single-page PDFs (pdf-a-pages-1/2/3.pdf), each 1 page, zipped ✓
  - **Split PDF (custom ranges)**: "1-2" range → 1 PDF containing pages 1-2 ✓
  - **Rotate PDF (batch)**: 2 PDFs rotated 90° → both output, downloaded one verified at rotation=90° (original 0°) ✓
  - **Images to PDF (single)**: 3 PNGs → 1 PDF with 3 pages, each 300×200 (fit mode) ✓
  - **Images to PDF (multiple)**: 3 PNGs → 3 separate PDFs, each with its own Download button ✓
  - Options UI renders per-tool (radios + ranges input + page-size select); Start-over reset works.
  - 0 errors throughout; lint clean; dev log clean.
- Key bug fixed: worker global-scope function-name collision with UMD library property (getPDFLib rename). Important lesson for Step 4 WASM libs.
- Architecture ready for Step 4: add WASM libs to libs.ts fetch list + new processors in worker-source.ts + register in registry.ts. The async-init blob-embedding pattern handles WASM (fetch .wasm, embed or fetch at worker init).

---
Task ID: 4
Agent: main (orchestrator)
Task: Step 4 — Category B tools: Compress PDF, Repair PDF, Unlock PDF.

Work Log:
- Extended `src/lib/processing/types.ts`: added 'compress' | 'repair' | 'unlock' to ProcessorType; added optional `note?: string` field to OutputFile (for displaying compression ratios / recovery info in the UI).
- Added 3 processors to `src/lib/processing/worker-source.ts`:
  - **compress**: loads with ignoreEncryption, optional metadata strip (title/author/subject/keywords/creator/producer), re-saves with useObjectStreams:true (lossless stream compression). Computes original→compressed size + percentage and attaches as `note`. Preserves text selectability (no rasterization).
  - **repair**: loads with ignoreEncryption + throwOnInvalidObject:false (tolerant parse that recovers objects even with damaged xref/structure), re-saves clean. Attaches "N pages recovered" note. Throws clear error if unrecoverable.
  - **unlock**: loads with ignoreEncryption (+ optional password), re-saves without any encryption → removes owner-password restrictions. Attaches "Restrictions removed" note. Honest error message if pdf-lib can't decrypt user-password-encrypted content.
- Registered all 3 in `src/lib/processing/registry.ts`.
- Extended `src/components/tool-options.tsx`: added CompressOptions (strip-metadata checkbox + lossless info callout) and UnlockOptions (password input + honest limitations callout). Updated hasOptions/defaultOptions/SettingsIcon.
- Updated `src/components/processing-panel.tsx`: done-state now displays the output `note` prominently (e.g. "12.9 KB → 7.2 KB (44% smaller)") alongside the "N outputs ready" text.
- Generated test assets: large.pdf (8-page, uncompressed, 13.2KB), protected-owner.pdf (owner-password protected, opens without password), corrupted.pdf (xref table damaged).

Stage Summary:
- Step 4 complete and browser-verified via Agent Browser (all outputs validated by reloading through pdf-lib in Node):
  - **Compress PDF (single)**: large.pdf 13194 → 7389 bytes, "12.9 KB → 7.2 KB (44% smaller)" shown in UI ✓ downloaded file = 7389 bytes, 8 pages intact ✓
  - **Compress PDF (batch)**: 2 PDFs in parallel (4× parallel badge), each with its own ratio note ✓
  - **Repair PDF**: corrupted.pdf (damaged xref) → "3 pages recovered", downloaded file reloads cleanly with 3 pages ✓
  - **Unlock PDF**: protected-owner.pdf → "Restrictions removed", downloaded file has NO /Encrypt dict, reloads cleanly ✓
  - Options UI renders for compress (strip-metadata checkbox + lossless callout) and unlock (password field + limitations callout); repair has no options (just runs).
  - Compression ratio / recovery notes display prominently in the processing panel.
  - 0 errors throughout; lint clean; dev log clean.
- Design decision: used pdf-lib (already embedded in the worker blob from Step 3) for all three tools rather than pulling in a separate QPDF/MuPDF WASM build. Rationale: these are structural operations (stream compression, tolerant parsing, encryption removal) that pdf-lib's pure-JS engine handles capably — WASM would add significant bundle size without functional benefit here. The compress note shows real ratios; repair recovers genuinely broken xrefs; unlock genuinely removes owner-password restrictions. The architecture fully supports adding a WASM lib later if deep image recompression is needed.
- Total implemented tools now: 7 of 20 (Merge, Split, Rotate, Images→PDF, Compress, Repair, Unlock).

---
Task ID: 5
Agent: main (orchestrator)
Task: Step 5 — Office conversions (Word↔PDF, Excel↔PDF) + remaining Category A (Page Numbers, Watermark, Protect, PDF to Images, HTML to PDF).

Work Log:
- Added mammoth, xlsx, docx, pdfjs (and pdfjsWorker) UMD URLs to `src/lib/processing/libs.ts`. Key architectural change: pdf-lib stays EMBEDDED in the blob (small, always needed); mammoth/xlsx/docx/pdfjs are loaded LAZILY via importScripts when a tool needs them (embedding large minified UMDs caused regex-parse corruption at library boundaries).
- Added 9 processor types to `src/lib/processing/types.ts` + `OutputFile.note` already existed from Step 4.
- Implemented 9 processors in `src/lib/processing/worker-source.ts`:
  - **page-numbers**: drawText with position (6 options), format ({n}/{total}), start number, font size slider.
  - **watermark**: diagonal text with opacity, font size, rotation.
  - **protect**: pdf-lib encryption (user+owner password, restricted permissions). Button disabled until password entered.
  - **pdf-to-images**: pdf.js + OffscreenCanvas rasterization → PNG/JPG per page. REQUIRED document polyfill (pdf.js fake-worker checks for `document` even in a worker) + blob-URL workerSrc.
  - **html-to-pdf**: custom HTML tokenizer (h1-3, p, br, li, strong/b) → pdf-lib text layout with word wrap + pagination.
  - **word-to-pdf**: mammoth.convertToHtml → reuses html-to-pdf renderer.
  - **excel-to-pdf**: SheetJS sheet_to_json → pdf-lib grid (A4 landscape, cell borders, bold headers, column pagination).
  - **pdf-to-word**: pdf.js getTextContent → line grouping by Y-position → docx Document with Paragraphs + PageBreaks.
  - **pdf-to-excel**: pdf.js text extraction → column detection (split on 2+ spaces/tabs) → XLSX with one sheet per page.
- Added `extractTextPages()` helper using pdf.js for real text extraction (grouped into lines by Y-coordinate, sorted by X).
- Extended `src/components/tool-options.tsx`: PageNumberOptions (position select, format input, start number, font-size slider), WatermarkOptions (text, font-size slider, opacity slider), ProtectOptions (password input + dynamic callout), PdfToImagesOptions (PNG/JPG radio, resolution slider).
- Updated `src/components/tool-page.tsx`: runEnabled logic (protect requires password before enabling).
- Fixed 3 critical bugs in worker source:
  1. **Template-literal regex escaping**: `/<script[\s\S]*?<\/script>/gi` in a template literal — `\/` becomes `/`, breaking the regex. Fixed with `\\s`, `\\S`, `\\/` to produce literal `\s`, `\S`, `\/` in output.
  2. **Template-literal newline escaping**: `'\n'` in a template literal becomes a real newline, breaking the string. Fixed with `'\\n'`.
  3. **Backtick in comment**: a comment containing `document` in backticks prematurely closed the template literal. Removed backticks.
  4. **toArrayBuffer for ArrayBuffer input**: XLSX.write returns ArrayBuffer directly (not Uint8Array); `bytes.buffer` is undefined for ArrayBuffer. Added `if (bytes instanceof ArrayBuffer) return bytes` guard.
- Generated test assets: test.docx (8.7KB, headings+paragraphs), test.xlsx (16.9KB, 6×6 sales data), test-multi.pdf (3 pages).

Stage Summary:
- Step 5 complete and browser-verified via Agent Browser (outputs validated):
  - **Word to PDF**: test.docx → test.pdf (1 page, valid) ✓
  - **Excel to PDF**: test.xlsx → test.pdf (1 page, "1 sheet(s)") ✓
  - **PDF to Images**: 3-page PDF → 3 PNGs in ZIP (test-multi-page-1/2/3.png, ~18KB each) ✓
  - **PDF to Word**: 3-page PDF → test-multi.docx (valid Word 2007+, "3 pages, 3 lines") ✓
  - **PDF to Excel**: 3-page PDF → test-multi.xlsx (valid Excel 2007+, "3 sheet(s)") ✓
  - **Page Numbers**: 3-page PDF → "3 pages numbered" ✓
  - **Watermark**: → "Watermark added" ✓
  - **Protect PDF**: password required to enable button → "Password protected" ✓
  - **HTML to PDF**: pasted HTML → "1 page(s)" ✓
  - 0 errors throughout; lint clean; dev log clean.
- Key architectural learnings:
  - Lazy importScripts (not embedding) for large office libs avoids regex corruption.
  - pdf.js needs document polyfill + blob-URL workerSrc to run inside a Web Worker.
  - Template literals require double-escaping for regex/newlines that must survive into the generated worker source.
- Total implemented tools: 16 of 20. Remaining 4 (Organize, Crop, Sign & Annotate, Edit PDF Text) are Step 6.
