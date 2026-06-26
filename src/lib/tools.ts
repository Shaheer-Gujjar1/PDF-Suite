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
  FileType,
  FileSpreadsheet,
  Sheet,
  Type,
  ShieldCheck,
  Combine,
} from "lucide-react";

export type ToolCategory =
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
  | "violet";

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
    id: "pdf-to-word",
    name: "PDF to Word",
    description: "Extract text and layout into an editable .docx file.",
    category: "convert-from-pdf",
    icon: FileType,
    accent: "teal",
    batch: true,
    step: 5,
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
    description: "Stamp text or image watermarks across your pages.",
    category: "edit",
    icon: Stamp,
    accent: "fuchsia",
    batch: true,
    step: 3,
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
};

// Keep an icon imported so tree-shaking doesn't drop it if unused later.
export const _icons = { FileStack, ShieldCheck };
