import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { coverStyle, drawBack, drawEdges, drawFront, drawSpine, loadImage } from './bookTextures';
import { drawShelves, drawWalnut } from './sceneTextures';

/** Sizes in decimetres: A5 = 1.48 × 2.10. A paper leaf is 0.1 mm (two pages), the board cover 2.5 mm. */
const W = 1.48;
const H = 2.1;
const BOARD = 0.025;
const OVERHANG = 0.03;
const LEAF = 0.001;

export interface Book3DProps {
  /** When the book is ready to draw (only then does the loading screen go). */
  onReady?: () => void;
  title: string;
  author: string;
  synopsis: string;
  coverUrl: string | null;
  /** Back cover and spine images (optional). */
  backCoverUrl?: string | null;
  spineUrl?: string | null;
  /** The thickness comes from this page count (a book starts like a blank notebook of at least 500 pages). */
  pageCount: number;
  /** Number of written pages (in the caption below). */
  written?: number;
  /** Opens on a double-click (or double-tap) on the book. */
  onOpen: () => void;
}

/**
 * Closed book: drag to turn it any way, wheel / two fingers to zoom.
 * The thickness comes from the page count. When left alone it slowly turns by itself.
 * Scene: a dark walnut desk with blurred bookshelves far behind it; the light comes from a desk lamp on the left (not visible).
 */
export default function Book3D({ title, author, synopsis, coverUrl, backCoverUrl = null, spineUrl = null, pageCount, written, onOpen, onReady }: Book3DProps) {
  const readyCb = useRef(onReady);
  readyCb.current = onReady;
  const hostRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [ready, setReady] = useState(false);
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    const disposables: { dispose: () => void }[] = [];
    const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'b3-canvas';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

    // Light: soft ambient + main light from the upper left (shadows) + rim light from behind + desk lamp
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x1c140c, 0.85));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(-2.5, 4, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 15;
    Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 });
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffe2b8, 0.9);
    rim.position.set(3, 1.5, -3);
    scene.add(rim);

    // Desk lamp: a warm pool of light from the left; the edges of the desk stay dark
    const lamp = new THREE.SpotLight(0xffd6a0, 42, 14, 0.75, 0.95, 2);
    lamp.position.set(-3.4, 3.1, 2.2);
    lamp.target.position.set(0.3, -H / 2, -0.2);
    scene.add(lamp, lamp.target);

    // Dark walnut desk (its top is under the book); the grain runs horizontally
    const walnut = new THREE.CanvasTexture(drawWalnut());
    track(walnut);
    walnut.colorSpace = THREE.SRGBColorSpace;
    walnut.wrapS = walnut.wrapT = THREE.MirroredRepeatWrapping; // mirrored repeat: the texture's seam does not show
    walnut.repeat.set(2, 1);
    walnut.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const deskTop = track(new THREE.MeshStandardMaterial({ map: walnut, roughness: 0.48, metalness: 0 }));
    const deskEdge = track(new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.6 }));
    const desk = new THREE.Mesh(track(new THREE.BoxGeometry(16, 0.12, 8.5)), [deskEdge, deskEdge, deskTop, deskEdge, deskEdge, deskEdge]);
    desk.position.set(0, -H / 2 - 0.06, 1.0);
    desk.receiveShadow = true;
    scene.add(desk);

    // Behind, far away, blurred bookshelves (not lit by the scene; their light is painted in the picture)
    const shelvesTex = new THREE.CanvasTexture(drawShelves());
    track(shelvesTex);
    shelvesTex.colorSpace = THREE.SRGBColorSpace;
    const shelves = new THREE.Mesh(track(new THREE.PlaneGeometry(36, 18)), track(new THREE.MeshBasicMaterial({ map: shelvesTex, toneMapped: false })));
    shelves.position.set(0, 2.6, -11);
    scene.add(shelves);
    scene.background = new THREE.Color(0x0c0805);

    const book = new THREE.Group();
    scene.add(book);
    const T = Math.max(0.03, Math.ceil(pageCount / 2) * LEAF); // paper block
    const D = T + 2 * BOARD; // total thickness

    const anisotropy = renderer.capabilities.getMaxAnisotropy();
    const tex = (c: HTMLCanvasElement) => {
      const t = track(new THREE.CanvasTexture(c));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = anisotropy;
      return t;
    };

    // Camera distance: the book fits the screen comfortably
    let distance = 6;
    let zoom = 1;
    const fit = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const vFov = (camera.fov * Math.PI) / 180;
      const needH = H * 1.45;
      const needW = Math.max(W, D) * 1.45;
      const byH = needH / 2 / Math.tan(vFov / 2);
      const byW = needW / 2 / Math.tan(vFov / 2) / camera.aspect;
      distance = Math.max(byH, byW);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    void (async () => {
      await document.fonts.ready;
      const [style, backImg, spineImg] = await Promise.all([
        coverStyle(coverUrl),
        backCoverUrl ? loadImage(backCoverUrl) : null,
        spineUrl ? loadImage(spineUrl) : null,
      ]);
      if (disposed) return;
      const coverColor = new THREE.Color(style.bg);
      const cloth = track(new THREE.MeshStandardMaterial({ color: coverColor, roughness: 0.78, metalness: 0 }));
      const paper = track(new THREE.MeshStandardMaterial({ color: 0xf3ead6, roughness: 0.95 }));
      const edgeV = track(new THREE.MeshStandardMaterial({ map: tex(drawEdges(true)), roughness: 0.95 }));
      const edgeH = track(new THREE.MeshStandardMaterial({ map: tex(drawEdges(false)), roughness: 0.95 }));
      const front = track(new THREE.MeshStandardMaterial({ map: tex(drawFront(style, title, author)), roughness: style.image ? 0.55 : 0.75 }));
      const back = track(new THREE.MeshStandardMaterial({ map: tex(drawBack(style, title, author, synopsis, backImg)), roughness: backImg ? 0.55 : 0.75 }));

      // Paper block: fore edge (+x) with vertical lines, top/bottom with horizontal lines
      const blockW = W - OVERHANG - 0.006;
      const block = new THREE.Mesh(track(new THREE.BoxGeometry(blockW, H - 2 * OVERHANG * 0.6, T)), [edgeV, paper, edgeH, edgeH, paper, paper]);
      block.position.x = -W / 2 + 0.006 + blockW / 2;
      // Covers (BoxGeometry faces: +x, -x, +y, -y, +z, -z)
      const frontBoard = new THREE.Mesh(track(new THREE.BoxGeometry(W, H, BOARD)), [cloth, cloth, cloth, cloth, front, cloth]);
      frontBoard.position.z = T / 2 + BOARD / 2;
      const backBoard = new THREE.Mesh(track(new THREE.BoxGeometry(W, H, BOARD)), [cloth, cloth, cloth, cloth, cloth, back]);
      backBoard.position.z = -(T / 2 + BOARD / 2);
      // Spine: a flattened half cylinder (bulging slightly outwards)
      const spineGeo = track(new THREE.CylinderGeometry(D / 2, D / 2, H, 48, 1, true, Math.PI, Math.PI));
      const bulge = Math.min(0.12, D * 0.32);
      const spineRatio = (Math.PI * D) / 2 / H;
      const spineMat = track(new THREE.MeshStandardMaterial({ map: tex(drawSpine(style, title, author, spineRatio, spineImg)), roughness: 0.75, side: THREE.DoubleSide }));
      const spine = new THREE.Mesh(spineGeo, spineMat);
      spine.scale.x = bulge / (D / 2);
      spine.position.x = -W / 2;

      for (const m of [block, frontBoard, backBoard, spine]) {
        m.castShadow = true;
        m.receiveShadow = true;
        book.add(m);
      }
      setReady(true);
      readyCb.current?.();
    })();

    // ---- Turning by hand ----
    // First view: front cover and spine together (three-quarter view)
    let rotY = 0.55;
    let rotX = 0;
    let velY = 0;
    let velX = 0;
    let idle = true;
    let lastTouch = performance.now() - 3500; // stays still for the first 2.5 s, then slowly turns
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch0 = 0;
    let zoom0 = 1;
    let moved = 0;
    let tapAt = 0;
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      idle = false;
      moved = 0;
      velX = velY = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        zoom0 = zoom;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const p = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        zoom = Math.max(0.55, Math.min(1.8, zoom0 * (pinch0 / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)))));
        return;
      }
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      velY = dx * 0.009;
      velX = dy * 0.006;
      rotY += velY;
      rotX = Math.max(-1.2, Math.min(1.2, rotX + velX));
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastTouch = performance.now();
      // On touch screens, a short tap (without dragging) twice: open
      if (e.pointerType !== 'mouse' && moved < 6) {
        const now = performance.now();
        if (now - tapAt < 350) openRef.current();
        tapAt = now;
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.max(0.55, Math.min(1.8, zoom * Math.exp(e.deltaY * 0.001)));
    };
    const onDbl = () => openRef.current();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDbl);

    // ---- Draw loop ----
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pointers.size) {
        // After letting go the spin slows to a stop; if left alone for a while it turns by itself
        rotY += velY;
        rotX = Math.max(-1.2, Math.min(1.2, rotX + velX));
        velY *= 0.93;
        velX *= 0.9;
        if (!idle && now - lastTouch > 6000) idle = true;
        if (idle && now - lastTouch > 6000) {
          rotY += dt * 0.22;
          rotX += (0 - rotX) * dt * 0.8;
        }
      }
      book.rotation.set(rotX, rotY, 0, 'YXZ');
      // The book must not sink into the desk: as it tilts it rises just enough for its lowest corner to stay on the desk
      book.position.y = (H / 2) * Math.abs(Math.cos(rotX)) + (D / 2) * Math.abs(Math.sin(rotX)) - H / 2;
      const d = distance * zoom;
      camera.position.set(0, d * 0.16, d);
      camera.lookAt(0, -0.05, 0);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDbl);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.remove();
    };
  }, [title, author, synopsis, coverUrl, backCoverUrl, spineUrl, pageCount]);

  return (
    <div className="b3">
      <div className="b3-host" ref={hostRef} />
      {!ready && <div className="b3-loading">Preparing the book…</div>}
      <div className="b3-caption">
        <span>
          {pageCount} pages{written !== undefined ? ` · ${written} written` : ''}
        </span>
        <span className="b3-hint">{touch ? 'Turn with your finger · double-tap to open' : 'Drag to turn · double-click to open'}</span>
      </div>
    </div>
  );
}
