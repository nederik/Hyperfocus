import { memo } from 'react';
import { A5, FONT_FAMILY, type Geometry, type LaidPage, type PageLine } from './layout';

/** Draws the parts of a line (bold/italic); the spaces between parts are kept. */
function Line({ line, onToc }: { line: PageLine; onToc?: (chapterId: number) => void }) {
  const style: React.CSSProperties = {
    left: line.x,
    top: line.y,
    width: line.w,
    height: line.lineH,
    lineHeight: `${line.lineH}px`,
    fontSize: line.size,
    textAlign: line.align === 'justify' ? 'justify' : line.align,
    textAlignLast: line.align === 'justify' ? 'justify' : undefined,
  };
  const text = line.frags.map((f, i) => (
    <span key={i} className={`${f.bold ? 'b' : ''}${f.italic ? ' i' : ''}`}>
      {f.gap && i > 0 ? ' ' : ''}
      {f.text}
    </span>
  ));
  if (line.tocPage !== undefined) {
    return (
      <a
        href="#"
        className="bk-line bk-toc"
        style={style}
        data-chapter={line.tocChapter}
        onClick={(e) => {
          e.preventDefault();
          if (line.tocChapter !== undefined) onToc?.(line.tocChapter);
        }}
      >
        <span className="bk-toc-title">{text}</span>
        <span className="bk-toc-dots" aria-hidden />
        <span className="bk-toc-num">{line.tocPage}</span>
      </a>
    );
  }
  return (
    <div className="bk-line" style={style}>
      {text}
    </div>
  );
}

/** A5 page: drawn at real size and scaled from outside (scale). */
export const PageView = memo(function PageView({
  page,
  title,
  author,
  coverUrl,
  backCoverUrl = null,
  onToc,
  geo = A5,
  synopsis = '',
}: {
  page: LaidPage;
  geo?: Geometry;
  title: string;
  author: string;
  coverUrl: string | null;
  /** Back cover image (without one, the title, back cover text and author are typeset). */
  backCoverUrl?: string | null;
  /** Back cover text. */
  synopsis?: string;
  onToc?: (chapterId: number) => void;
}) {
  return (
    <div className={`bk-page bk-${page.kind}${page.recto ? ' recto' : ' verso'}`} style={{ width: geo.w, height: geo.h, fontFamily: FONT_FAMILY }}>
      {page.kind === 'back' && backCoverUrl && <img className="bk-cover-img" src={backCoverUrl} alt="" draggable={false} />}
      {page.kind === 'back' && !backCoverUrl && (
        <div className="bk-back-inner">
          <div className="bk-back-title">{title || 'Untitled'}</div>
          <div className="bk-cover-rule" />
          {synopsis && <p className="bk-back-synopsis">{synopsis}</p>}
          <div className="bk-back-author">{author}</div>
        </div>
      )}
      {page.kind === 'cover' &&
        (coverUrl ? (
          <img className="bk-cover-img" src={coverUrl} alt="" draggable={false} />
        ) : (
          <div className="bk-cover-type">
            <div className="bk-cover-title">{title || 'Untitled'}</div>
            <div className="bk-cover-rule" />
            <div className="bk-cover-author">{author}</div>
          </div>
        ))}
      {page.images?.map((im) => (
        <img
          key={im.id}
          className={`bk-img${im.full ? ' full' : ''}`}
          src={im.url}
          alt=""
          draggable={false}
          style={im.full ? { left: 0, top: 0, width: geo.w, height: geo.h } : { left: im.x, top: im.y, width: im.w, height: im.h }}
        />
      ))}
      {page.scenes?.map((s, i) => (
        <div key={`s${i}`} className="bk-scene" style={{ left: s.cx, top: s.cy, transform: `translate(-50%, -50%) scale(${s.scale})` }} aria-hidden>
          <span />
          <i />
          <span />
        </div>
      ))}
      {page.lines.map((l, i) => (
        <Line key={i} line={l} onToc={onToc} />
      ))}
      {page.showNumber && (
        <div className="bk-number" style={{ top: geo.numberY }}>
          {page.n}
        </div>
      )}
    </div>
  );
});
