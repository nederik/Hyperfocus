import { useRef, useState } from 'react';
import { FloatingPanel } from '../ui/FloatingPanel';
import { toast } from '../lib/toast';

type Format = 'pdf' | 'docx';

/**
 * Download the book: PDF (A5, print-ready, the same as the pages in the editor) or Word (.docx, editable).
 * The export libraries load only when clicked.
 */
export function DownloadMenu({ bookId, className = 'btn btn-sm', label = 'Download', beforeExport }: { bookId: number; className?: string; label?: string; beforeExport?: () => Promise<unknown> }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (format: Format) => {
    setOpen(false);
    setBusy('Preparing…');
    try {
      await beforeExport?.();
      if (format === 'pdf') {
        const { exportPdf } = await import('./export/pdf');
        const r = await exportPdf(bookId, setBusy);
        toast(`PDF downloaded (${r.pages} pages).`);
      } else {
        const { exportDocx } = await import('./export/docx');
        await exportDocx(bookId, setBusy);
        toast('Word document downloaded. If Word asks to update the fields when it opens, choose “Yes” to fill in the contents.');
      }
    } catch (e) {
      console.error(e);
      toast(`Download failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        disabled={!!busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Download the book as PDF or Word"
      >
        {busy ?? label}
      </button>
      {open && (
        <FloatingPanel anchor={button} onClose={() => setOpen(false)} className="st-dl-menu" width={260} role="menu" ariaLabel="Download format">
          <button type="button" role="menuitem" className="st-dl-item" onClick={() => void run('pdf')}>
            <strong>PDF</strong>
            <span>A5, print-ready. Pages, images and cover exactly as you see them here.</span>
          </button>
          <button type="button" role="menuitem" className="st-dl-item" onClick={() => void run('docx')}>
            <strong>Word (.docx)</strong>
            <span>Editable document. Word paginates it itself.</span>
          </button>
        </FloatingPanel>
      )}
    </>
  );
}
