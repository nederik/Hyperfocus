import { useMemo } from 'react';
import { loaderSvg, logoSvg } from './markup';

export function Logo({ size = 40, simple }: { size?: number; simple?: boolean }) {
  const html = useMemo(() => logoSvg({ size, simple }), [size, simple]);
  return <span style={{ display: 'inline-flex', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Loader({ size = 140, full = false, label }: { size?: number; full?: boolean; label?: string }) {
  const html = useMemo(() => (label ? loaderSvg(size, label, 'Loading') : loaderSvg(size)), [size, label]);
  return <div className={full ? 'page-loader' : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}
