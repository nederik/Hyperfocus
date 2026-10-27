/**
 * Word (.docx): an editable document. Word breaks the pages itself; the font (EB Garamond) is embedded in the document.
 * A5, justified, indented paragraphs; each chapter on a new page, no page number at the start of a chapter.
 * Page images float at the same place, anchored to the first paragraph of the page they are on in A5; text flows around them.
 */
import {
  AlignmentType,
  CharacterSet,
  Document,
  Footer,
  HeadingLevel,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  TableOfContents,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionRelativeFrom,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';
import JSZip from 'jszip';
import type { BookImage } from '@hyperfocus/shared';
import { A5, CONTENT_W, epigraphOf } from '../layout';
import { download, fileName, fontBytes, imageBytes, leatherCoverJpeg, loadBookForExport } from './common';

const FONT = 'EB Garamond';
const TW = 15; // 1 page pixel (96 dpi) = 15 twips
const EMU = 9525; // 1 pixel = 9525 EMU
const BODY = Math.round(A5.body * 0.75 * 2); // half-points (11 pt)
const TITLE = Math.round(A5.title * 0.75 * 2); // chapter titles (30 pt)
const BOOK_TITLE = Math.round(A5.bookTitle * 0.75 * 2); // the book's title (48 pt)
const LINE = A5.lineH * TW;

interface TipNode {
  type?: string;
  text?: string;
  marks?: { type: string }[];
  content?: TipNode[];
}

const page = {
  size: { width: Math.round(148 * 56.6929), height: Math.round(210 * 56.6929) },
  margin: {
    top: A5.top * TW,
    bottom: A5.bottom * TW,
    // Mirrored margins (switched on in the settings): left = binding side, right = outer edge
    left: A5.inner * TW,
    right: A5.outer * TW,
    header: 500,
    footer: 560,
    gutter: 0,
  },
};

const pageNumberFooter = () =>
  new Footer({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20, font: FONT })] })],
  });

/** Makes the book a Word file; with `save` false it does not download but returns the file (for the full backup). */
export async function exportDocx(bookId: number, onProgress?: (msg: string) => void, save = true) {
  onProgress?.('Preparing the book…');
  const { book, laid } = await loadBookForExport(bookId);
  const regular = await fontBytes('Regular');

  // Images
  onProgress?.('Preparing images…');
  const imgCache = new Map<string, Awaited<ReturnType<typeof imageBytes>>>();
  const img = async (url: string, maxSide: number, opaque = false) => {
    if (!imgCache.has(url)) imgCache.set(url, await imageBytes(url, maxSide, opaque));
    return imgCache.get(url) ?? null;
  };

  /** Prepares an image at its place in A5, as an image floating relative to the page. */
  const floating = async (im: BookImage): Promise<ImageRun | null> => {
    const data = await img(im.url, 2480);
    if (!data) return null;
    const box = im.full ? { x: 0, y: 0, w: A5.w, h: A5.h } : im;
    const k = Math.min(box.w / data.w, box.h / data.h);
    const w = Math.round(data.w * k);
    const h = Math.round(data.h * k);
    return new ImageRun({
      type: data.type,
      data: data.bytes,
      transformation: { width: w, height: h },
      floating: {
        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round((box.x + (box.w - w) / 2) * EMU) },
        verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round((box.y + (box.h - h) / 2) * EMU) },
        wrap: im.full
          ? { type: TextWrappingType.TOP_AND_BOTTOM }
          : { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES, margins: { distL: 10 * EMU, distR: 10 * EMU, distT: 10 * EMU, distB: 10 * EMU } },
        allowOverlap: true,
      },
    });
  };

  // ---- Front matter: cover, title page, contents (unnumbered) ----
  const front: Paragraph[] = [];
  const sections: ISectionOptions[] = [];
  // Without a cover image: a white title and author on dark charcoal leather like on screen (as an image, borderless)
  const cover = (book.coverUrl ? await coverJpeg(book.coverUrl) : null) ?? (await leatherCoverJpeg(book.title, book.author));
  if (cover) {
    // Cover: on its own page without margins, the image cropped to A5 (a full page in every viewer)
    sections.push({
      properties: { page: { size: page.size, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0, gutter: 0 } } },
      children: [
        new Paragraph({
          spacing: { line: 240, lineRule: LineRuleType.AUTO },
          children: [new ImageRun({ type: 'jpg', data: cover, transformation: { width: A5.w, height: A5.h - 1 } })],
        }),
      ],
    });
  } else {
    front.push(
      new Paragraph({ spacing: { before: 3600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: book.title || 'Untitled', size: BOOK_TITLE, font: FONT })] }),
      new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: book.author, italics: true, size: 30, font: FONT })] }),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }
  // Title page
  front.push(
    new Paragraph({ spacing: { before: 3600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: book.title || 'Untitled', size: BOOK_TITLE, font: FONT })] }),
    new Paragraph({ spacing: { before: 390 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: book.author, italics: true, size: 26, font: FONT })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: 'Chapters', size: TITLE, font: FONT })] }),
    new TableOfContents('Chapters', { hyperlink: true, headingStyleRange: '1-1' }) as unknown as Paragraph,
  );
  sections.push({ properties: { page, type: SectionType.NEXT_PAGE }, children: front });

  // ---- Chapters ----
  onProgress?.('Writing chapters…');
  for (const ch of book.chapters) {
    const nodes = ((ch.content as TipNode)?.content ?? []) as TipNode[];
    // Anchor images to the first paragraph of the page they are on in A5
    const start = laid.chapterStarts.get(ch.id) ?? 0;
    const anchors = new Map<number, BookImage[]>();
    for (const im of ch.images) {
      const target = start + im.page;
      let anchor = nodes.findIndex((_, bi) => laid.blockPages.get(`${ch.id}:${bi}`) === target);
      if (anchor < 0) nodes.forEach((_, bi) => ((laid.blockPages.get(`${ch.id}:${bi}`) ?? Infinity) < target ? (anchor = bi) : null));
      anchor = Math.max(0, anchor);
      anchors.set(anchor, [...(anchors.get(anchor) ?? []), im]);
    }

    const epi = epigraphOf(ch);
    const children: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: A5.sink * TW, after: Math.round((epi ? A5.titleGap * 0.45 : A5.titleGap) * TW) },
        children: [new TextRun({ text: ch.title || 'Untitled chapter', size: TITLE, font: FONT, color: '231A12' })],
      }),
    ];
    // Epigraph: under the title, narrow and centred, in italics; "— author" under it (the same as the page layout)
    if (epi) {
      const side = Math.round(CONTENT_W * 0.14 * TW);
      const size = Math.round(BODY * 0.95);
      const line = Math.round(A5.lineH * 0.95 * TW);
      const lines = epi.text.split('\n');
      lines.forEach((t, i) =>
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            indent: { left: side, right: side },
            keepNext: true,
            spacing: { line, lineRule: LineRuleType.EXACT, after: !epi.by && i === lines.length - 1 ? Math.round(A5.titleGap * 0.6 * TW) : 0 },
            children: [new TextRun({ text: t.trim(), italics: true, size, font: FONT })],
          }),
        ),
      );
      if (epi.by)
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            indent: { left: side, right: side },
            keepNext: true,
            spacing: { before: Math.round(line * 0.35), after: Math.round(A5.titleGap * 0.6 * TW), line, lineRule: LineRuleType.EXACT },
            children: [new TextRun({ text: '— ' + epi.by, size, font: FONT })],
          }),
        );
    }
    let indent = true; // the first paragraph of a chapter is indented too
    let started = false; // a page break before any text in the chapter is ignored (the text starts on the title page)
    for (let bi = 0; bi < nodes.length; bi++) {
      const node = nodes[bi]!;
      const pics: ParagraphChild[] = [];
      for (const im of anchors.get(bi) ?? []) {
        const run = await floating(im);
        if (run) pics.push(run);
      }
      if (node.type === 'sceneBreak') {
        // Scene break: a centred ── ◆ ── (two lines of space); the next paragraph is not indented
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: Math.round((A5.lineH * TW) / 2), after: Math.round((A5.lineH * TW) / 2), line: Math.round(A5.lineH * TW), lineRule: LineRuleType.EXACT },
            keepNext: true,
            children: [...pics, new ImageRun({ type: 'png', data: await sceneBreakPng(), transformation: { width: 117, height: 12 } })],
          }),
        );
        indent = false;
        continue;
      }
      if (node.type === 'pageBreak' && !started) {
        if (pics.length) children.push(new Paragraph({ children: pics }));
        continue;
      }
      if (node.type === 'pageBreak') {
        children.push(new Paragraph({ children: [...pics, new PageBreak()] }));
        indent = false;
        continue;
      }
      if (node.type !== 'paragraph') continue;
      const runs: ParagraphChild[] = [...pics];
      for (const c of node.content ?? []) {
        if (c.type === 'hardBreak') runs.push(new TextRun({ break: 1 }));
        else if (c.type === 'text' && c.text) {
          const marks = c.marks?.map((m) => m.type) ?? [];
          runs.push(new TextRun({ text: c.text, bold: marks.includes('bold'), italics: marks.includes('italic') }));
        }
      }
      const empty = !(node.content ?? []).some((c) => c.type === 'text' && c.text?.trim());
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          indent: { firstLine: !empty && indent ? A5.indent * TW : 0 },
          children: runs,
        }),
      );
      indent = !empty; // a paragraph after an empty line (scene break) is not indented
      if (!empty) started = true;
    }
    sections.push({
      properties: { page, type: SectionType.NEXT_PAGE },
      footers: { default: pageNumberFooter() }, // a number on the chapter's first page too
      children,
    });
  }

  // ---- Back cover: its own image on a page without margins, or the title, blurb and author ----
  const backImage = book.backCoverUrl ? await coverJpeg(book.backCoverUrl) : null;
  if (backImage)
    sections.push({
      properties: { page: { size: page.size, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0, gutter: 0 } }, type: SectionType.NEXT_PAGE },
      children: [
        new Paragraph({
          spacing: { line: 240, lineRule: LineRuleType.AUTO },
          children: [new ImageRun({ type: 'jpg', data: backImage, transformation: { width: A5.w, height: A5.h - 1 } })],
        }),
      ],
    });
  else sections.push({
    properties: { page, type: SectionType.NEXT_PAGE },
    children: [
      new Paragraph({ spacing: { before: 2600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: book.title || 'Untitled', size: 42, font: FONT })] }),
      ...book.synopsis
        .split(/\n+/)
        .filter(Boolean)
        .map(
          (t, i) =>
            new Paragraph({
              spacing: { before: i === 0 ? 480 : 120, line: Math.round(17 * 1.6 * TW), lineRule: LineRuleType.EXACT },
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: t, italics: true, size: 26, font: FONT, color: '3A2E22' })],
            }),
        ),
      new Paragraph({ spacing: { before: 480 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: book.author.toUpperCase(), size: 22, font: FONT, color: '6B5A45', characterSpacing: 30 })] }),
    ],
  });

  onProgress?.('Saving the Word document…');
  const doc = new Document({
    title: book.title || 'Untitled',
    creator: book.author,
    description: book.synopsis.slice(0, 500),
    features: { updateFields: true },
    fonts: [{ name: FONT, data: regular as unknown as Buffer, characterSet: CharacterSet.ANSI }],
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY, color: '231A12' },
          paragraph: { spacing: { line: LINE, lineRule: LineRuleType.EXACT, before: 0, after: 0 } },
        },
        heading1: {
          run: { font: FONT, size: TITLE, color: '231A12', bold: false },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { line: A5.titleLineH * TW, lineRule: LineRuleType.EXACT } },
        },
      },
    },
    sections,
  });
  const blob = await withBookSettings(await Packer.toBlob(doc), !!cover);
  const name = fileName(book.title, 'docx');
  if (save) download(blob, name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return { blob, name };
}

let scenePng: Promise<Uint8Array> | null = null;
/** A sharp PNG of the scene-break divider (── ◆ ──, black); drawn once. */
function sceneBreakPng(): Promise<Uint8Array> {
  scenePng ??= (async () => {
    const k = 6; // 6x resolution
    const c = document.createElement('canvas');
    c.width = 117 * k;
    c.height = 12 * k;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    const cy = 6 * k;
    g.fillRect(0, cy - k / 2, 44 * k, k);
    g.fillRect(73 * k, cy - k / 2, 44 * k, k);
    g.beginPath();
    g.moveTo(58.5 * k, cy - 4.24 * k);
    g.lineTo(58.5 * k + 4.24 * k, cy);
    g.lineTo(58.5 * k, cy + 4.24 * k);
    g.lineTo(58.5 * k - 4.24 * k, cy);
    g.closePath();
    g.fill();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob!.arrayBuffer());
  })();
  return scenePng;
}

/** Crops the cover image to A5 proportions from the centre and makes it a JPEG (so it fills the page). */
async function coverJpeg(url: string): Promise<Uint8Array | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = url;
  });
  if (!img) return null;
  const W = 1748; // A5, 300 dpi
  const H = Math.round((W * A5.h) / A5.w);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  c.getContext('2d')!.drawImage(img, (W - img.naturalWidth * k) / 2, (H - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.93));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/**
 * Word settings: use the embedded font and mirror the margins (binding on the left on odd pages, on the right on even pages).
 * The docx library does not write these two; they are added to settings.xml in the schema's order.
 */
async function withBookSettings(blob: Blob, coverPage: boolean) {
  const zip = await JSZip.loadAsync(blob);
  if (coverPage) {
    // The section break of the cover page sits in a separate empty paragraph; since the image fills the page, that paragraph
    // spills onto a second page and an empty page follows the cover. Move the section break into the image's paragraph.
    const docFile = zip.file('word/document.xml');
    if (docFile) {
      let xml = await docFile.async('string');
      const m = /<w:p><w:pPr>(<w:sectPr\b[\s\S]*?<\/w:sectPr>)<\/w:pPr><\/w:p>/.exec(xml);
      if (m) {
        const before = xml.slice(0, m.index);
        const end = before.lastIndexOf('</w:pPr>');
        if (end > 0 && before.indexOf('<w:drawing>', end) > 0) {
          xml = before.slice(0, end) + m[1] + before.slice(end) + xml.slice(m.index + m[0].length);
          zip.file('word/document.xml', xml);
        }
      }
    }
  }
  const file = zip.file('word/settings.xml');
  if (!file) return blob;
  let xml = await file.async('string');
  if (!xml.includes('w:embedTrueTypeFonts')) {
    const add = '<w:embedTrueTypeFonts/><w:mirrorMargins/>';
    xml = xml.includes('<w:displayBackgroundShape/>')
      ? xml.replace('<w:displayBackgroundShape/>', '<w:displayBackgroundShape/>' + add)
      : xml.replace(/(<w:settings[^>]*>)/, '$1' + add);
    zip.file('word/settings.xml', xml);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
