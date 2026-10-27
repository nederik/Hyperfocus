/**
 * The logo: a hand holding a pen, drawn in charcoal.
 * Both the React components and the first loading screen in index.html use this markup
 * (the plugin in vite.config.ts puts it in place of <!--loader-->).
 */

/** Charcoal texture: makes the lines tremble slightly and gives them grain. */
const FILTERS = `
<defs>
  <filter id="sk-charcoal" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="rough"/>
    <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="3" result="grain"/>
    <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 1.25" result="grainAlpha"/>
    <feComposite in="rough" in2="grainAlpha" operator="in"/>
  </filter>
</defs>`;

/**
 * Hand and pen (viewBox 0 0 120 120). The pen tip is at (18, 104) and the pen reaches to the top right.
 * It is drawn in a local plane where the pen lies horizontally (tip = 0,0; pen along +x, wrist along +y)
 * and rotated as a whole, so the fingers sit anatomically right on the pen.
 * Layer order: back of the hand and curled fingers → pen → thumb → index finger.
 */
export const HAND_STROKES = `
<g transform="translate(18 104) rotate(-49.1) scale(0.84)">
<g class="sk-hand">
  <path class="sk-paper" d="M54 -5 L58 -19 C62.5 -19.5 65 -18.6 67 -17 C70.5 -14.8 73.5 -13 76 -10.4 C79 -7.6 81.5 -4.6 83.5 -1.6 C89.5 6.5 93.5 16 95 26 C95.8 32 94.6 38 91.8 43 L72 61.6 C69.5 51 66.5 43 63.5 36 L64.5 34.6 C61.5 36.8 58 38 53 38 C48 38 45 35 46 31 L39 31 C34 30.5 32 26 34 22 L27 21 C23 19.5 22 15 24 12.5 L30 10 Z"/>
  <path class="sk-line sk-thick" d="M58 -19 C62.5 -19.5 65 -18.6 67 -17 C70.5 -14.8 73.5 -13 76 -10.4 C79 -7.6 81.5 -4.6 83.5 -1.6 C89.5 6.5 93.5 16 95 26 C95.8 32 94.6 38 91.8 43"/>
  <path class="sk-line sk-detail" d="M63 -18.6 q2.6 -.8 4.4 1.2"/>
  <path class="sk-line sk-detail" d="M72.5 -13.2 q2.4 -.4 3.8 1.8"/>
  <g class="sk-sleeve">
    <path class="sk-paper" d="M93 42 L109 73 L86 94 L70 63 C78 56.5 86 49.5 93 42 Z"/>
    <path class="sk-line sk-thick" d="M93 42 C86.5 49.5 78.5 56.5 70 63"/>
    <path class="sk-line sk-thick" d="M93 42 L109 73 M70 63 L86 94"/>
    <path class="sk-line" d="M95.6 47 C89 54.5 81 61.5 72.6 68"/>
    <g class="sk-hatch sk-detail"><path d="M98 53 l-4 5"/><path d="M100.5 58 l-4.5 5.5"/><path d="M103 63 l-4.5 5.5"/></g>
  </g>
  <path class="sk-line sk-thick" d="M63.5 36 C66.5 43 69.5 51 72 61.6"/>
  <path class="sk-line" d="M34 22 C32 26 34 30.5 39 31 C45 31.5 52 30.5 58 29"/>
  <path class="sk-line" d="M46 31 C45 35 48 38 53 38 C58 38 61.5 36.8 64.5 34.6"/>
  <path class="sk-line" d="M24 12.5 C22 15 23 19.5 27 21 C33 22.6 41 22.6 48 21.6"/>
  <g class="sk-hatch sk-detail">
    <path d="M80 1 l-6 5"/><path d="M84.5 6 l-6.5 5.5"/><path d="M88.5 12 l-7 6"/><path d="M91.5 18.5 l-7 6"/><path d="M93.4 25 l-6.5 5.5"/><path d="M93.6 31.4 l-5 4.2"/>
    <path d="M40 25.4 l1.6 4.2"/><path d="M44.5 25.8 l1.6 4.2"/><path d="M49 25.6 l1.6 4.2"/>
    <path d="M52 33.6 l1.4 3.4"/><path d="M56 33.2 l1.4 3.4"/>
    <path d="M30 16.4 l1.4 3.8"/><path d="M34.5 16.8 l1.4 3.8"/><path d="M39 17 l1.4 3.8"/>
  </g>
</g>
<g class="sk-pencil">
  <path class="sk-paper" d="M15 -4 L119 -4 Q123.5 0 119 4 L15 4 L0 0 Z"/>
  <path class="sk-line sk-thick" d="M15 -4 L119 -4"/>
  <path class="sk-line sk-thick" d="M15 4 L119 4"/>
  <path class="sk-line sk-detail sk-faint" d="M15 1 L119 1"/>
  <path class="sk-line" d="M119 -4 Q123.5 0 119 4"/>
  <path class="sk-line sk-detail" d="M104 -4 L104 4"/>
  <path class="sk-line sk-detail" d="M107.2 -4 L107.2 4"/>
  <path class="sk-line" d="M15 -4 L0 0 L15 4"/>
  <path class="sk-line sk-detail" d="M15 -4 Q12.4 -1.8 13.6 0 Q12.4 1.8 15 4"/>
  <path class="sk-fill" d="M0 0 L5 -1.4 L5 1.4 Z"/>
</g>
<g class="sk-thumb">
  <path class="sk-paper" d="M54 -5 C46 -3 38 -2.5 30 -2 C26 -1.8 22 -1 19.6 1.4 C17 4.5 17.6 9.5 22 12 C25 13.6 30 13.8 34 14 C41 14.4 47 15.6 52 18 C58 21 62 26.5 64 32 L70 10 Z"/>
  <path class="sk-line sk-thick" d="M54 -5 C46 -3 38 -2.5 30 -2 C26 -1.8 22 -1 19.6 1.4 C17 4.5 17.6 9.5 22 12 C25 13.6 30 13.8 34 14 C41 14.4 47 15.6 52 18 C58 21 62 26.5 64 32"/>
  <path class="sk-line sk-detail" d="M20.8 1.6 C23 -0.4 28 -0.8 31 0.4 C30.6 3 27.6 4.8 24.6 4.6 C22.6 4.4 21.2 3.2 20.8 1.6 Z"/>
  <path class="sk-line sk-detail" d="M37 -1.8 q1.8 4 .9 8"/>
  <path class="sk-line sk-detail" d="M46 7 C52 9 57.5 13 61 18"/>
</g>
<g class="sk-index">
  <path class="sk-paper" d="M58 -19 C54 -21 50 -21.6 46 -21.2 C42 -20.8 38.5 -19.2 35 -17.6 C32 -16.4 29.5 -15.8 26.5 -15.2 C22.5 -14.4 18.5 -13.8 16.2 -12 C13.2 -9.8 13.4 -5.6 16.4 -4 L34 -4 C38 -4.2 41 -5.2 44 -5.6 C48 -6 51.5 -5.6 54 -5 Z"/>
  <path class="sk-line sk-thick" d="M58 -19 C54 -21 50 -21.6 46 -21.2 C42 -20.8 38.5 -19.2 35 -17.6 C32 -16.4 29.5 -15.8 26.5 -15.2 C22.5 -14.4 18.5 -13.8 16.2 -12 C13.2 -9.8 13.4 -5.6 16.4 -4"/>
  <path class="sk-line" d="M16.4 -4 L34 -4 C38 -4.2 41 -5.2 44 -5.6 C48 -6 51.5 -5.6 54 -5"/>
  <path class="sk-line sk-key" d="M58.6 -18.6 C57.4 -14 56 -9 54 -5"/>
  <path class="sk-line sk-detail" d="M17.4 -11.2 C19.8 -13.4 24.6 -14.4 28 -14 C27.6 -12 26 -10.6 23.8 -10.2"/>
  <path class="sk-line sk-detail" d="M31.6 -16.4 q1.2 3.6 .4 7.6"/>
  <path class="sk-line sk-detail" d="M45 -20.8 q1.6 4.4 .6 9.4"/>
  <path class="sk-line sk-detail" d="M48.2 -20.8 q1.4 4 .5 8.6"/>
  <g class="sk-hatch sk-detail"><path d="M40 -9.4 l2 3"/><path d="M44.5 -9.8 l2 3"/><path d="M49 -9.4 l1.8 2.8"/></g>
</g>
</g>`;

/** The "writing" line in the loading animation: a handwriting-like curl under the pen tip. */
const WRITING = `<path class="sk-writing" d="M-30 105 c3 -6 6 -6 6 0 s4 5 7 -1 s3 -7 5 -2 s2 6 5 2 s4 -6 6 -2 s3 4 6 0 s5 -5 6 -1"/>`;

/** A plain version for small sizes (favicon, menus): thick lines, no detail or texture. */
export function logoSvg(opts: { size?: number; className?: string; simple?: boolean } = {}) {
  const s = opts.size ?? 40;
  const simple = opts.simple ?? s < 48;
  return `<svg class="sk-logo sk-dark${simple ? ' sk-simple' : ''} ${opts.className ?? ''}" width="${s}" height="${s}" viewBox="13 17 94 94" role="img" aria-label="Hyperfocus logo">
${simple ? '' : FILTERS}<g${simple ? '' : ' filter="url(#sk-charcoal)"'}>${HAND_STROKES}</g></svg>`;
}

/** `label`: the text under the logo. */
export function loaderSvg(size = 140, label = 'Hyperfocus', ariaLabel = 'Loading') {
  return `<div class="sk-loader" role="status" aria-label="${ariaLabel}">
<svg class="sk-dark" width="${size}" height="${Math.round(size * 0.7)}" viewBox="-36 14 144 101" aria-hidden="true">
${FILTERS}
<g filter="url(#sk-charcoal)">
  ${WRITING}
  <g class="sk-mover">${HAND_STROKES}</g>
</g>
</svg>
<span class="sk-loader-text">${label}</span>
</div>`;
}

/** Logo and loader styles. Also inlined in index.html (so they show before the JS loads). */
export const LOGO_CSS = `
.sk-logo, .sk-loader svg { overflow: hidden; }
.sk-line { fill: none; stroke: var(--sk-ink, #2e2924); stroke-width: 1.55; stroke-linecap: round; stroke-linejoin: round; }
.sk-thick { stroke-width: 2.25; }
.sk-faint { stroke-width: .7; opacity: .45; }
.sk-cuff { stroke-width: 1.8; }
.sk-fill { fill: var(--sk-ink, #2e2924); }
.sk-paper { fill: var(--sk-paper, #f4ecdc); stroke: none; }
/* Dark hand: dark fill, inner lines (nail, joints, finger gaps) in a light colour. */
.sk-dark .sk-hand > .sk-paper, .sk-dark .sk-thumb > .sk-paper, .sk-dark .sk-index > .sk-paper { fill: var(--sk-hand, #2e2924); }
.sk-dark .sk-hand > .sk-line, .sk-dark .sk-thumb > .sk-line, .sk-dark .sk-index > .sk-line { stroke: var(--sk-hand-line, #f4ecdc); }
.sk-dark .sk-hand > .sk-hatch path, .sk-dark .sk-index > .sk-hatch path { stroke: var(--sk-hand-line, #f4ecdc); opacity: .35; }
.sk-dark.sk-dark-sleeve .sk-sleeve > .sk-paper { fill: var(--sk-hand, #2e2924); }
.sk-dark.sk-dark-sleeve .sk-sleeve > .sk-line, .sk-dark.sk-dark-sleeve .sk-sleeve .sk-hatch path { stroke: var(--sk-hand-line, #f4ecdc); }
.sk-hatch path { fill: none; stroke: var(--sk-ink, #2e2924); stroke-width: .85; stroke-linecap: round; opacity: .5; }
.sk-simple .sk-detail { display: none; }
.sk-simple .sk-line { stroke-width: 5; }
.sk-simple .sk-thick { stroke-width: 6; }
.sk-simple .sk-pencil .sk-line { stroke-width: 3.6; }
.sk-dark.sk-simple .sk-hand > .sk-line, .sk-dark.sk-simple .sk-thumb > .sk-line, .sk-dark.sk-simple .sk-index > .sk-line { stroke-width: 2.8; }
.sk-dark.sk-simple .sk-index > .sk-key { stroke-width: 3.4; }
.sk-writing { fill: none; stroke: var(--sk-ink, #2e2924); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.sk-loader { display: flex; flex-direction: column; align-items: center; gap: 4px; color: #5b4f43; }
.sk-loader-text { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 15px; letter-spacing: .32em; text-transform: uppercase; opacity: .7; }
.sk-loader .sk-line, .sk-loader .sk-hatch path { stroke-dasharray: 140; stroke-dashoffset: 140; animation: sk-draw 1.1s ease-out forwards; }
.sk-loader .sk-hand .sk-line { animation-delay: .25s; }
.sk-loader .sk-hatch path { animation-delay: .7s; }
.sk-loader .sk-fill, .sk-loader .sk-paper { opacity: 0; animation: sk-fade .4s .5s forwards; }
.sk-loader .sk-mover { animation: sk-write 2.4s 1.1s ease-in-out infinite; transform-origin: 18px 104px; }
.sk-loader .sk-writing { stroke-dasharray: 90; stroke-dashoffset: 90; animation: sk-ink 2.4s 1.1s ease-in-out infinite; }
@keyframes sk-draw { to { stroke-dashoffset: 0; } }
@keyframes sk-fade { to { opacity: 1; } }
@keyframes sk-write {
  0%   { transform: translate(-48px, 0) rotate(0deg); }
  10%  { transform: translate(-43px, -4px) rotate(-2deg); }
  20%  { transform: translate(-38px, 1px) rotate(1deg); }
  30%  { transform: translate(-33px, -5px) rotate(-2deg); }
  40%  { transform: translate(-27px, 0) rotate(1deg); }
  50%  { transform: translate(-22px, -4px) rotate(-1deg); }
  60%  { transform: translate(-16px, 1px) rotate(1deg); }
  70%  { transform: translate(-10px, -3px) rotate(-1deg); }
  80%  { transform: translate(-5px, 0) rotate(0deg); }
  88%  { transform: translate(0, -6px) rotate(-3deg); }
  100% { transform: translate(-48px, -2px) rotate(0deg); }
}
@keyframes sk-ink { 0% { stroke-dashoffset: 90; opacity: 1; } 80% { stroke-dashoffset: 0; opacity: 1; } 95% { opacity: 0; } 100% { stroke-dashoffset: 0; opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .sk-loader .sk-line, .sk-loader .sk-hatch path, .sk-loader .sk-writing { animation: none; stroke-dashoffset: 0; }
  .sk-loader .sk-fill, .sk-loader .sk-paper { animation: none; opacity: 1; }
  .sk-loader .sk-mover { animation: none; }
}`;
