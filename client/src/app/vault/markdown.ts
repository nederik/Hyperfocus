import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import type { VaultItem } from './store';
import { baseName, isNotePath } from './store';

/**
 * Markdown → HTML for showing notes (Obsidian-style).
 * Obsidian syntax: ![[image.png|300]] embeds, [[Note]] / [[Note|other name]] links, ==highlight==,
 * and a --- properties --- block at the very top. A single line break counts as a line break (Obsidian's default).
 * The result goes through DOMPurify: whatever is in a note, no code can run on the page.
 */
const md = new Marked({ gfm: true, breaks: true, async: false });

const escText = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const escAttr = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Applied to the parts outside code blocks and inline code. */
function outsideCode(text: string, fn: (s: string) => string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts.map((p, i) => (i % 2 ? p : fn(p))).join('');
}

function obsidianSyntax(s: string): string {
  return (
    s
      // Embed: ![[file.png|300]] or ![[Note]]
      .replace(/!\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, (_m, target: string, opt?: string) => {
        const t = target.trim();
        const width = opt && /^\d+(x\d+)?$/.test(opt.trim()) ? opt.trim().split('x')[0] : null;
        return `<img data-vault="${escAttr(t)}" alt="${escAttr(baseName(t))}"${width ? ` width="${width}"` : ''}>`;
      })
      // Link: [[Note]], [[Note|name]], [[Note#heading]]
      .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, (_m, target: string, alias?: string) => {
        const t = target.trim();
        const label = (alias ?? t.replace(/#.*$/, '').split('/').pop() ?? t).trim() || t;
        return `<a href="#" data-note="${escAttr(t)}">${escText(label)}</a>`;
      })
      // ==vurgu==
      .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
  );
}

/** The properties (YAML) at the top of a note are shown as a small table. */
function frontmatter(text: string): { props: string; rest: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { props: '', rest: text };
  const rows = m[1]!
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const i = l.indexOf(':');
      return i > 0
        ? `<tr><th>${escText(l.slice(0, i).trim())}</th><td>${escText(l.slice(i + 1).trim())}</td></tr>`
        : `<tr><td colspan="2">${escText(l.trim())}</td></tr>`;
    })
    .join('');
  return { props: rows ? `<table class="vt-props">${rows}</table>` : '', rest: text.slice(m[0].length) };
}

export function renderMarkdown(src: string): string {
  const { props, rest } = frontmatter(src.replace(/^﻿/, ''));
  const html = md.parse(outsideCode(rest, obsidianSyntax)) as string;
  return DOMPurify.sanitize(props + html, {
    ADD_ATTR: ['data-vault', 'data-note'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
  });
}

/**
 * Resolves links like Obsidian: the full path, a path ending the same, or just the name (a note name without extension works too).
 * With more than one match, the shortest path wins.
 */
export function resolveLink(target: string, items: VaultItem[], wantNote: boolean): VaultItem | null {
  const t = target.replace(/[#^].*$/, '').trim().replace(/^\.?\//, '');
  if (!t) return null;
  const withMd = isNotePath(t) ? t : `${t}.md`;
  const candidates = items.filter((i) => !i.meta.deleted && (wantNote ? i.meta.kind === 'note' : true));
  const score = (p: string) => {
    if (p === t || p === withMd) return 0;
    if (p.endsWith(`/${t}`) || p.endsWith(`/${withMd}`)) return 1;
    const b = baseName(p);
    if (b === t || b === withMd) return 2;
    return -1;
  };
  let best: VaultItem | null = null;
  let bestScore = 9;
  for (const it of candidates) {
    const s = score(it.meta.path);
    if (s < 0) continue;
    if (s < bestScore || (s === bestScore && best && it.meta.path.length < best.meta.path.length)) {
      best = it;
      bestScore = s;
    }
  }
  return best;
}
