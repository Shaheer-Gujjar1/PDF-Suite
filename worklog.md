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
