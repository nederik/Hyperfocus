import { z } from 'zod';

/** The "blank notebook" page count of a new book; raised when it fills up. */
export const DEFAULT_PAGE_CAPACITY = 500;

export interface BookSummary {
  id: number;
  /** Place on the shelf (0 = first). */
  position: number;
  title: string;
  author: string;
  synopsis: string;
  coverUrl: string | null;
  /** Back cover and spine images (optional; without them the title and author are typeset). */
  backCoverUrl: string | null;
  spineUrl: string | null;
  mapUrl: string | null;
  pageCapacity: number;
  chapterCount: number;
  updatedAt: string;
  /** Space the book takes: text + the files it uses (cover, map, images, music). Sent with the shelf. */
  sizeBytes?: number;
  /** The encrypted book details (title, author, back cover text, images). When set, the plain fields are empty. */
  enc?: string | null;
}

/**
 * An image placed on a page by hand. It sits on page `page` of the chapter (0 = the chapter's first page);
 * position and size in page pixels (A5 = 559 × 794). Text flows outside the image:
 * `shape` = around the non-transparent shape of a PNG, `box` = around its rectangle.
 * `full`: the image covers the whole page; there is no text on that page.
 */
export interface BookImage {
  id: string;
  url: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  wrap: 'shape' | 'box';
  full?: boolean;
}

/** Chapter content: Tiptap/ProseMirror JSON (paragraphs, bold/italic, page breaks). */
export interface BookChapter {
  id: number;
  ord: number;
  title: string;
  content: unknown;
  musicUrl: string | null;
  /**
   * The page range the music plays on, relative to the chapter's first page (0 = the chapter's first page; A5 pages).
   * Empty means from the start / to the end of the chapter.
   */
  musicFrom: number | null;
  musicTo: number | null;
  /** Epigraph (quotation) at the start of the chapter and its author; none if empty. */
  epigraph: string | null;
  epigraphBy: string | null;
  /** Put quotation marks (“ ”) around the epigraph? */
  epigraphQuotes: boolean;
  images: BookImage[];
  updatedAt: string;
  /** The encrypted chapter (title, text, images, music, epigraph). When set, the plain fields are empty. */
  enc?: string | null;
}

/** Ink colours of the notes. */
export const NOTE_COLORS = ['black', 'orange', 'red', 'blue', 'green'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
/**
 * A writing note: a text box placed freely on the note board (like Excalidraw).
 * `color` is the ink; x, y its place on the board; size the font size (pixels). Older notes without a place are stacked by the board.
 */
export interface BookNote {
  id: string;
  text: string;
  color: NoteColor;
  createdAt: string;
  x?: number;
  y?: number;
  size?: number;
  /** The tab the note is on (the first tab if none). */
  tab?: string;
  /**
   * Drawing note: an SVG path (inside its own box, 0,0 at the top left). If set, the note is a drawing and `text` is empty.
   * w, h: the drawing's original box; size: scale percentage (100 = original); stroke: line width.
   */
  path?: string;
  w?: number;
  h?: number;
  stroke?: number;
}

/** A note tab: each tab is a separate note board. */
export interface NoteTab {
  id: string;
  name: string;
}

export interface BookFull extends BookSummary {
  chapters: BookChapter[];
}

/** The notebook on the shelf (notes not tied to a book). */
export interface NotebookSummary {
  count: number;
  updatedAt: string | null;
  sizeBytes: number;
}

export interface ShelfResponse {
  /** Every book, in shelf order. */
  books: BookSummary[];
  notebook: NotebookSummary;
  /** Are the notes encrypted. */
  notebookEncrypted?: boolean;
}

/** Storage used (bytes). media = images and audio (KV on Cloudflare, disk locally), db = the database. */
export interface StorageUsage {
  /** limit is null when there is no fixed quota (local or Docker install: only the disk). */
  media: { used: number; limit: number | null };
  db: { used: number; limit: number | null };
}

/** Before the first sign-in: does the owner account still need to be created, and is a setup code required? */
export interface SetupStatus {
  needsSetup: boolean;
  tokenRequired: boolean;
}

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(60),
  password: z.string().min(1).max(200),
});

export const setupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
  password: z.string().min(8, 'The password must be at least 8 characters').max(200),
  displayName: z.string().trim().max(80).optional(),
  token: z.string().max(200).optional(),
});

export const passwordChangeSchema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8, 'The new password must be at least 8 characters').max(200),
});

export const accountUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export const bookNoteSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().max(8000),
  color: z.enum(NOTE_COLORS),
  createdAt: z.string().max(40),
  x: z.number().finite().min(-1e6).max(1e6).optional(),
  y: z.number().finite().min(-1e6).max(1e6).optional(),
  size: z.number().finite().min(6).max(400).optional(),
  tab: z.string().min(1).max(40).optional(),
  path: z.string().max(120000).optional(),
  w: z.number().finite().min(0).max(1e5).optional(),
  h: z.number().finite().min(0).max(1e5).optional(),
  stroke: z.number().finite().min(0.5).max(80).optional(),
});

export const noteTabSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
});

/** Personal dictionary: words the spell check counts as correct (on top of the English dictionary). */
export const dictionaryUpdateSchema = z.object({
  words: z.array(z.string().trim().min(1).max(80)).max(20000).optional(),
  enc: z.string().min(16).max(1_900_000).optional(),
  keepPlain: z.boolean().optional(),
});

export const notebookUpdateSchema = z.object({
  enc: z.string().min(16).max(1_900_000).optional(),
  keepPlain: z.boolean().optional(),
  notes: z.array(bookNoteSchema).max(400).optional(),
  tabs: z.array(noteTabSchema).max(40).optional(),
});

/** End-to-end encryption: encrypted content (opened only in the browser) and the ids of the encrypted files it uses. */
const encSchema = {
  enc: z.string().min(16).max(1_900_000).optional(),
  assets: z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).max(500).optional(),
  /** While moving to encryption: the plain text stays until it has been checked (then /seal clears it). */
  keepPlain: z.boolean().optional(),
};

export const bookUpdateSchema = z.object({
  ...encSchema,
  title: z.string().trim().max(200).optional(),
  author: z.string().trim().max(120).optional(),
  synopsis: z.string().max(3000).optional(),
  coverUrl: z.string().max(1000).nullable().optional(),
  backCoverUrl: z.string().max(1000).nullable().optional(),
  spineUrl: z.string().max(1000).nullable().optional(),
  mapUrl: z.string().max(1000).nullable().optional(),
});

const coord = z.number().finite().min(-2000).max(4000);
export const bookImageSchema = z.object({
  id: z.string().min(1).max(40),
  url: z.string().min(1).max(1000),
  page: z.number().int().min(0).max(2000),
  x: coord,
  y: coord,
  w: z.number().finite().min(8).max(4000),
  h: z.number().finite().min(8).max(4000),
  wrap: z.enum(['shape', 'box']),
  full: z.boolean().optional(),
});

export const chapterUpdateSchema = z.object({
  ...encSchema,
  title: z.string().trim().max(200).optional(),
  content: z.unknown().optional(),
  musicUrl: z.string().max(1000).nullable().optional(),
  musicFrom: z.number().int().min(-2000).max(5000).nullable().optional(),
  musicTo: z.number().int().min(-2000).max(5000).nullable().optional(),
  epigraph: z.string().max(2000).nullable().optional(),
  epigraphBy: z.string().max(300).nullable().optional(),
  epigraphQuotes: z.boolean().optional(),
  images: z.array(bookImageSchema).max(200).optional(),
});
