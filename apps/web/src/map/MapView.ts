import type { Axial } from '@rdw/game-core';
import {
  Application,
  Container,
  Graphics,
  Polygon,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
} from 'pixi.js';
import { axialToPixel, hexCorners, HEX_SIZE, type Bounds } from './layout.ts';
import { biomeColor } from './palette.ts';

/**
 * PixiJS-Szene der Karte (ARCHITECTURE §12): ein Sechseck je Region, Besitz über Farbe und
 * zusätzlich über Rahmen und Symbole; Verschieben per Ziehen, Zoom per Mausrad. Die Szene kennt
 * keine Spielregeln, sie zeigt nur, was der Server liefert.
 */

export interface MapRegion extends Axial {
  readonly id: string;
  readonly biome: number;
  readonly tier: number;
  readonly ownerColor: number | null;
  readonly own: boolean;
  readonly isCapital: boolean;
  readonly underSiege: boolean;
  readonly protected: boolean;
}

export interface MapHandlers {
  readonly onSelect: (regionId: string) => void;
  readonly onViewport: (bounds: Bounds) => void;
}

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 6;

interface Drawn {
  readonly graphics: Graphics;
  region: MapRegion;
}

export class MapView {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly drawn = new Map<string, Drawn>();
  private selected: string | null = null;
  private highlighted: string | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private destroyed = false;
  private ready = false;

  private constructor(
    private readonly host: HTMLElement,
    private readonly handlers: MapHandlers,
  ) {}

  static async create(host: HTMLElement, handlers: MapHandlers): Promise<MapView> {
    const view = new MapView(host, handlers);
    await view.init();
    return view;
  }

  private async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.ready = true;
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerdown', (e: FederatedPointerEvent) => {
      this.drag = { x: e.global.x, y: e.global.y, moved: false };
    });
    this.app.stage.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (!this.drag || e.buttons === 0) return;
      const dx = e.global.x - this.drag.x;
      const dy = e.global.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      this.drag = { x: e.global.x, y: e.global.y, moved: true };
      this.world.position.set(this.world.x + dx, this.world.y + dy);
    });
    const endDrag = () => {
      if (this.drag?.moved) this.emitViewport();
      // Erst nach dem Tap-Ereignis zurücksetzen, damit Ziehen keine Region auswählt
      setTimeout(() => (this.drag = null), 0);
    };
    this.app.stage.on('pointerup', endDrag);
    this.app.stage.on('pointerupoutside', endDrag);
    this.app.stage.on('wheel', (e: FederatedWheelEvent) => {
      e.preventDefault();
      this.zoomAt(e.global.x, e.global.y, Math.exp(-e.deltaY * 0.0015));
    });
    this.app.renderer.on('resize', () => this.emitViewport());
  }

  destroy(): void {
    this.destroyed = true;
    if (this.ready) this.app.destroy(true, { children: true });
  }

  /** Zoom um die Mitte (Schaltflächen für Touch und Tastatur). */
  zoomBy(factor: number): void {
    if (!this.ready) return;
    this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, factor);
  }

  /** Sichtbarer Ausschnitt in Weltkoordinaten (für das Nachladen von Chunks). */
  viewport(): Bounds {
    const scale = this.world.scale.x;
    return {
      minX: -this.world.x / scale,
      minY: -this.world.y / scale,
      maxX: (this.app.screen.width - this.world.x) / scale,
      maxY: (this.app.screen.height - this.world.y) / scale,
    };
  }

  centreOn(cell: Axial): void {
    if (!this.ready) return;
    const p = axialToPixel(cell);
    const scale = this.world.scale.x;
    this.world.position.set(
      this.app.screen.width / 2 - p.x * scale,
      this.app.screen.height / 2 - p.y * scale,
    );
    this.emitViewport();
  }

  setRegions(regions: readonly MapRegion[]): void {
    if (!this.ready) return;
    for (const region of regions) {
      const existing = this.drawn.get(region.id);
      if (existing) {
        existing.region = region;
        this.paint(existing);
        continue;
      }
      const graphics = new Graphics();
      const corners = hexCorners(axialToPixel(region));
      graphics.hitArea = new Polygon(corners.flatMap((c) => [c.x, c.y]));
      graphics.eventMode = 'static';
      graphics.cursor = 'pointer';
      graphics.on('pointertap', () => {
        if (!this.drag?.moved) this.handlers.onSelect(region.id);
      });
      const entry: Drawn = { graphics, region };
      this.drawn.set(region.id, entry);
      this.world.addChild(graphics);
      this.paint(entry);
    }
    // Ausgewählte und hervorgehobene Regionen über die Nachbarn legen (Rahmen sichtbar)
    for (const id of [this.highlighted, this.selected]) {
      const entry = id ? this.drawn.get(id) : undefined;
      if (entry) this.world.setChildIndex(entry.graphics, this.world.children.length - 1);
    }
  }

  setSelected(id: string | null): void {
    this.swap('selected', id);
  }

  setHighlighted(id: string | null): void {
    this.swap('highlighted', id);
  }

  private swap(field: 'selected' | 'highlighted', id: string | null): void {
    const previous = this[field];
    this[field] = id;
    for (const key of [previous, id]) {
      const entry = key ? this.drawn.get(key) : undefined;
      if (!entry) continue;
      this.paint(entry);
      if (key === id) this.world.setChildIndex(entry.graphics, this.world.children.length - 1);
    }
  }

  private paint({ graphics, region }: Drawn): void {
    const centre = axialToPixel(region);
    const corners = hexCorners(centre, HEX_SIZE - 1);
    const fill = region.ownerColor ?? biomeColor(region.biome);
    const selected = region.id === this.selected;
    const highlighted = region.id === this.highlighted;
    graphics.clear();
    graphics.poly(corners.flatMap((c) => [c.x, c.y])).fill({
      color: fill,
      alpha: region.ownerColor === null ? 1 : 0.85,
    });
    // Rahmen: eigenes Gebiet weiß und breit, fremder Besitz dunkel, neutral dezent
    const stroke = selected
      ? { width: 4, color: 0x1d4ed8 }
      : highlighted
        ? { width: 4, color: 0xd97706 }
        : region.own
          ? { width: 3, color: 0xffffff }
          : region.ownerColor !== null
            ? { width: 2, color: 0x333333 }
            : { width: 1, color: 0x7a8a70 };
    graphics.poly(corners.flatMap((c) => [c.x, c.y])).stroke({ ...stroke, alignment: 1 });
    if (region.isCapital) {
      graphics.star(centre.x, centre.y, 5, 9, 4).fill({ color: 0xffffff }).stroke({
        width: 1.5,
        color: 0x222222,
      });
    } else if (region.own) {
      graphics.circle(centre.x, centre.y, 4).fill({ color: 0xffffff });
    }
    if (region.protected) {
      graphics.rect(centre.x - 4, centre.y + 9, 8, 8).fill({ color: 0x2563eb });
    }
    if (region.underSiege) {
      graphics
        .moveTo(centre.x - 8, centre.y - 8)
        .lineTo(centre.x + 8, centre.y + 8)
        .moveTo(centre.x + 8, centre.y - 8)
        .lineTo(centre.x - 8, centre.y + 8)
        .stroke({ width: 3, color: 0xb91c1c });
    }
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const before = this.world.scale.x;
    const after = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, before * factor));
    if (after === before) return;
    const worldX = (x - this.world.x) / before;
    const worldY = (y - this.world.y) / before;
    this.world.scale.set(after);
    this.world.position.set(x - worldX * after, y - worldY * after);
    this.emitViewport();
  }

  private emitViewport(): void {
    if (this.ready) this.handlers.onViewport(this.viewport());
  }
}
