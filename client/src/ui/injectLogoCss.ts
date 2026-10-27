import { LOGO_CSS } from './logo/markup';

/** index.html inlines these styles, but they are added once more here to be safe. */
export function injectLogoCss() {
  if (document.getElementById('sk-logo-css')) return;
  const el = document.createElement('style');
  el.id = 'sk-logo-css';
  el.textContent = LOGO_CSS;
  document.head.appendChild(el);
}
