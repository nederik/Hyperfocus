// page-flip 2.0.7 ships no type definitions; these are the parts Hyperfocus uses.
declare module 'page-flip/dist/js/page-flip.module.js' {
  export interface FlipSetting {
    startPage?: number;
    size?: 'fixed' | 'stretch';
    width: number;
    height: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    swipeDistance?: number;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
  }
  export interface FlipEvent<T> {
    data: T;
  }
  export class PageFlip {
    constructor(element: HTMLElement, setting: FlipSetting);
    loadFromHTML(items: HTMLElement[]): void;
    on(event: 'flip', cb: (e: FlipEvent<number>) => void): this;
    on(event: 'changeOrientation', cb: (e: FlipEvent<'portrait' | 'landscape'>) => void): this;
    on(event: 'changeState', cb: (e: FlipEvent<string>) => void): this;
    on(event: 'init' | 'update', cb: (e: FlipEvent<{ page: number; mode: 'portrait' | 'landscape' }>) => void): this;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    flip(page: number, corner?: 'top' | 'bottom'): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): 'portrait' | 'landscape';
    destroy(): void;
  }
}
