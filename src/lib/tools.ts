import type { LucideIcon } from "lucide-react";
import {
  FileStack,
  Scissors,
  LayoutGrid,
  RotateCw,
  Crop,
  Hash,
  Stamp,
  FileImage,
  Images,
  PenTool,
  Lock,
  LockOpen,
  FileCode2,
  FileArchive,
  Wrench,
  FileType2,
  FileSpreadsheet,
  Sheet,
  Type,
  ShieldCheck,
  Combine,
  Repeat,
  Globe,
  Laugh,
  ScanFace,
  Shrink,
  Scaling,
  Image as ImageIcon,
  Brush,
} from "lucide-react";

export type ToolCategory =
  | "image"
  | "organize"
  | "optimize"
  | "convert-to-pdf"
  | "convert-from-pdf"
  | "edit"
  | "security";

export type AccentColor =
  | "rose"
  | "amber"
  | "emerald"
  | "teal"
  | "fuchsia"
  | "violet"
  | "orange";

export interface Tool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: LucideIcon;
  accent: AccentColor;
  batch: boolean;
  /** Which build step delivers this tool. */
  step: number;
  /** Optional pill label (e.g. "WASM", "Beta"). */
  tag?: string;
  /**
   * DEV-ONLY: When true, this tool is considered "production-locked" — its
   * logic is complete, tested, and should NOT be modified unless explicitly
   * requested by the user. Prevents accidental regressions during future work.
   * This flag is backend-only metadata; it does not change runtime behavior.
   */
  locked?: boolean;
}

export interface CategoryMeta {
  id: ToolCategory;
  name: string;
  tagline: string;
  accent: AccentColor;
}

export const categories: CategoryMeta[] = [
  {
    id: "image",
    name: "Image",
    tagline: "Crop, resize and polish your images.",
    accent: "orange",
  },
  {
    id: "organize",
    name: "Organize",
    tagline: "Rearrange, split and tidy up your pages.",
    accent: "rose",
  },
  {
    id: "optimize",
    name: "Optimize",
    tagline: "Shrink file size and fix broken files.",
    accent: "amber",
  },
  {
    id: "convert-to-pdf",
    name: "Convert to PDF",
    tagline: "Turn anything into a polished PDF.",
    accent: "emerald",
  },
  {
    id: "convert-from-pdf",
    name: "Convert from PDF",
    tagline: "Extract content out of your PDFs.",
    accent: "teal",
  },
  {
    id: "edit",
    name: "Edit PDF",
    tagline: "Annotate, number, watermark and edit.",
    accent: "fuchsia",
  },
  {
    id: "security",
    name: "Security",
    tagline: "Lock down or unlock your documents.",
    accent: "violet",
  },
];

export const tools: Tool[] = [
  // ---------- Image ----------
  {
    id: "crop-images",
    name: "Crop Images",
    description:
      "Visually crop JPG, PNG and WebP images one by one — batch them and download each or all as ZIP.",
    category: "image",
    icon: Crop,
    accent: "orange",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "convert-images",
    name: "Convert Images",
    description:
      "Convert any image — JPG, PNG, WEBP, GIF, BMP and more — to PNG, JPG or WEBP. Pick a format per file, download each or all as ZIP.",
    category: "image",
    icon: Repeat,
    accent: "orange",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "favicon-generator",
    name: "Favicon Generator",
    description:
      "Turn any image — JPG, PNG, WEBP, GIF, BMP and more — into a crisp multi-size .ico favicon (16–256 px). Batch ready; download each or all as ZIP.",
    category: "image",
    icon: Globe,
    accent: "orange",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "watermark-images",
    name: "Watermark Image",
    description:
      "Stamp text or your logo on any image — font, size, color, opacity, rotation, tiling and 9-position placement. Stack multiple watermarks; batch ready.",
    category: "image",
    icon: Stamp,
    accent: "rose",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  {
    id: "rotate-images",
    name: "Rotate Image",
    description:
      "Rotate any image — JPG, PNG, WEBP, GIF, BMP and more — in exact lossless 90° steps, plus horizontal/vertical flips. Batch ready; download each or all as ZIP.",
    category: "image",
    icon: RotateCw,
    accent: "orange",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  {
    id: "meme-maker",
    name: "Meme Maker",
    description:
      "Caption any image with draggable Impact-style text — classic white fill with black outline, top/bottom white bars, bold/italic/caps and more. Batch ready.",
    category: "image",
    icon: Laugh,
    accent: "violet",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  {
    id: "blur-faces",
    name: "Blur Face",
    description:
      "Hide faces, plates and private info in any image — drag round or rectangular blur areas anywhere, stack as many as you need and dial the blur strength. Batch ready.",
    category: "image",
    icon: ScanFace,
    accent: "teal",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  {
    id: "compress-images",
    name: "Compress Image",
    description:
      "Shrink JPG, PNG and WEBP images automatically — no settings, same dimensions, and results are never larger than the originals. Batch ready; download each or all as ZIP.",
    category: "image",
    icon: Shrink,
    accent: "orange",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  {
    id: "resize-images",
    name: "Resize Image",
    description:
      "Resize JPG, PNG and WEBP images by exact pixels or percentage — keep the aspect ratio, never upscale small photos by accident. Batch ready; download each or all as ZIP.",
    category: "image",
    icon: Scaling,
    accent: "orange",
    batch: true,
    step: 7,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  {
    id: "html-to-image",
    name: "HTML to Image",
    description:
      "Render pasted HTML code or an uploaded .html file into a crisp PNG, JPG or WebP screenshot — pick the render width, scale, quality and background. Everything runs in your browser.",
    category: "image",
    icon: ImageIcon,
    accent: "orange",
    batch: false,
    step: 8,
  },

  {
    id: "photo-editor",
    name: "Photo Editor",
    description:
      "Just a basic photo editor — crop, resize, rotate and flip, tune filters and light, draw, add text, shapes and frames. Simple edits, 100% in your browser.",
    category: "image",
    icon: Brush,
    accent: "orange",
    batch: false,
    step: 8,
  },

  // ---------- Organize ----------
  {
    id: "merge",
    name: "Merge PDF",
    description: "Combine multiple PDFs into a single document, in any order.",
    category: "organize",
    icon: Combine,
    accent: "rose",
    batch: true,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "split",
    name: "Split PDF",
    description: "Extract page ranges or split into individual pages.",
    category: "organize",
    icon: Scissors,
    accent: "rose",
    batch: true,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "organize",
    name: "Organize PDF",
    description: "Drag-and-drop to reorder, rotate or delete pages.",
    category: "organize",
    icon: LayoutGrid,
    accent: "rose",
    batch: false,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    description: "Rotate individual pages or whole documents.",
    category: "organize",
    icon: RotateCw,
    accent: "rose",
    batch: true,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "crop",
    name: "Crop PDF",
    description: "Visually select and crop PDF page margins.",
    category: "organize",
    icon: Crop,
    accent: "rose",
    batch: false,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  // ---------- Optimize ----------
  {
    id: "compress",
    name: "Compress PDF",
    description: "Deep compression without losing text selectability.",
    category: "optimize",
    icon: FileArchive,
    accent: "amber",
    batch: true,
    step: 4,
    tag: "WASM",
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "repair",
    name: "Repair PDF",
    description: "Fix corrupted PDF structures and recover content.",
    category: "optimize",
    icon: Wrench,
    accent: "amber",
    batch: true,
    step: 4,
    tag: "WASM",
  },

  // ---------- Convert to PDF ----------
  {
    id: "images-to-pdf",
    name: "Images to PDF",
    description: "Convert JPG, PNG and more into a single or multiple PDFs.",
    category: "convert-to-pdf",
    icon: Images,
    accent: "emerald",
    batch: true,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    description: "Turn .docx files into clean, selectable PDFs.",
    category: "convert-to-pdf",
    icon: FileType2,
    accent: "emerald",
    batch: true,
    step: 5,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "excel-to-pdf",
    name: "Excel to PDF",
    description: "Convert .xlsx spreadsheets into formatted PDFs.",
    category: "convert-to-pdf",
    icon: FileSpreadsheet,
    accent: "emerald",
    batch: true,
    step: 5,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "html-to-pdf",
    name: "HTML to PDF",
    description: "Render pasted HTML markup into a pixel-perfect PDF.",
    category: "convert-to-pdf",
    icon: FileCode2,
    accent: "emerald",
    batch: false,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },

  // ---------- Convert from PDF ----------
  {
    id: "pdf-to-images",
    name: "PDF to Images",
    description: "Export every page as a JPG or PNG, zipped for download.",
    category: "convert-from-pdf",
    icon: FileImage,
    accent: "teal",
    batch: true,
    step: 3,
  },
  {
    id: "pdf-to-excel",
    name: "PDF to Excel",
    description: "Pull tabular data from PDFs into .xlsx spreadsheets.",
    category: "convert-from-pdf",
    icon: Sheet,
    accent: "teal",
    batch: true,
    step: 5,
  },

  // ---------- Edit ----------
  {
    id: "page-numbers",
    name: "Page Numbers",
    description: "Add custom page numbers — position, size and format.",
    category: "edit",
    icon: Hash,
    accent: "fuchsia",
    batch: true,
    step: 3,
  },
  {
    id: "watermark",
    name: "Watermark PDF",
    description:
      "Stamp text or your logo on every page — font, size, color, opacity, rotation, tiling and 9-position placement with a live page preview. Stack multiple layers.",
    category: "edit",
    icon: Stamp,
    accent: "fuchsia",
    batch: true,
    step: 3,
    locked: true, // DEV-ONLY: production-locked — do not modify unless explicitly asked
  },
  {
    id: "sign-annotate",
    name: "Sign & Annotate",
    description: "Draw signatures, add text boxes and shapes on a canvas.",
    category: "edit",
    icon: PenTool,
    accent: "fuchsia",
    batch: false,
    step: 6,
  },
  {
    id: "edit-text",
    name: "Edit PDF Text",
    description: "Basic in-place text editing powered by WASM overlays.",
    category: "edit",
    icon: Type,
    accent: "fuchsia",
    batch: false,
    step: 5,
    tag: "WASM",
  },

  // ---------- Security ----------
  {
    id: "protect",
    name: "Protect PDF",
    description: "Add password encryption to keep your document safe.",
    category: "security",
    icon: Lock,
    accent: "violet",
    batch: true,
    step: 3,
  },
  {
    id: "unlock",
    name: "Unlock PDF",
    description: "Remove a known password or attempt a structural unlock.",
    category: "security",
    icon: LockOpen,
    accent: "violet",
    batch: true,
    step: 4,
  },
];

export function getTool(id: string): Tool | undefined {
  return tools.find((t) => t.id === id);
}

export function toolsByCategory(category: ToolCategory): Tool[] {
  return tools.filter((t) => t.category === category);
}

export function categoryMeta(id: ToolCategory): CategoryMeta | undefined {
  return categories.find((c) => c.id === id);
}

/** Static class maps so Tailwind can detect every color at build time. */
export const accentClasses: Record<
  AccentColor,
  {
    badge: string;
    dot: string;
    ring: string;
    glow: string;
    gradient: string;
    text: string;
    soft: string;
  }
> = {
  rose: {
    badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
    ring: "ring-rose-500/20",
    glow: "group-hover:shadow-rose-500/25",
    gradient: "from-rose-500 to-pink-600",
    text: "text-rose-600 dark:text-rose-400",
    soft: "bg-rose-500/5",
  },
  amber: {
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    ring: "ring-amber-500/20",
    glow: "group-hover:shadow-amber-500/25",
    gradient: "from-amber-500 to-orange-600",
    text: "text-amber-600 dark:text-amber-400",
    soft: "bg-amber-500/5",
  },
  emerald: {
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/20",
    glow: "group-hover:shadow-emerald-500/25",
    gradient: "from-emerald-500 to-green-600",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/5",
  },
  teal: {
    badge: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    dot: "bg-teal-500",
    ring: "ring-teal-500/20",
    glow: "group-hover:shadow-teal-500/25",
    gradient: "from-teal-500 to-cyan-600",
    text: "text-teal-600 dark:text-teal-400",
    soft: "bg-teal-500/5",
  },
  fuchsia: {
    badge: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
    dot: "bg-fuchsia-500",
    ring: "ring-fuchsia-500/20",
    glow: "group-hover:shadow-fuchsia-500/25",
    gradient: "from-fuchsia-500 to-pink-600",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    soft: "bg-fuchsia-500/5",
  },
  violet: {
    badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
    ring: "ring-violet-500/20",
    glow: "group-hover:shadow-violet-500/25",
    gradient: "from-violet-500 to-purple-600",
    text: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-500/5",
  },
  orange: {
    badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    dot: "bg-orange-500",
    ring: "ring-orange-500/20",
    glow: "group-hover:shadow-orange-500/25",
    gradient: "from-orange-500 to-red-600",
    text: "text-orange-600 dark:text-orange-400",
    soft: "bg-orange-500/5",
  },
};

// Keep an icon imported so tree-shaking doesn't drop it if unused later.
export const _icons = { FileStack, ShieldCheck };
