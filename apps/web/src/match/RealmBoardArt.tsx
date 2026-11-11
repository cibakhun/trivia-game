import type { RealmBuildingCode } from '@rdw/protocol';
import type { CSSProperties } from 'react';
import { symbolRef, type SymbolId } from '../art/ArtDefs.tsx';
import type { ArtRegion, MapArt } from '../art/map-art.ts';

/**
 * Partie mit Ausbau auf der Karte (MATCH_RULES §11, docs/ART_DIRECTION.md §4): Dorf und Stadt mit
 * Fahne in der Farbe des Reichs, Armeen als Banner mit Zahl, geplanter Bau blass mit goldenem Plus,
 * Züge als Pfeil mit Zahl, das gewählte Feld mit goldenem Rand. Alles liegt über den Regionen und
 * nimmt keine Tipps an; die Regionen selbst bleiben die Schaltflächen.
 */

export type RealmBuilt = Exclude<RealmBuildingCode, 'NONE'>;

export interface RealmRegionLayer {
  readonly building: RealmBuildingCode;
  readonly armies: number;
  /** Leben der Burg auf diesem Feld; 0 ohne Burg. */
  readonly castleLives: number;
}

export interface RealmMove {
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly seat: number;
}

/** Schild über einem Feld: was sich dort eben geändert hat. */
export interface RealmChange {
  readonly region: number;
  readonly text: string;
  readonly seat: number;
}

/** Was die Karte über die klassische Partie hinaus zeigt. */
export interface RealmLayer {
  readonly regions: readonly RealmRegionLayer[];
  /** Gewähltes Feld: in der Rüstzeit das eigene, beim Angriff das Ziel. */
  readonly selected?: number | null;
  /** Rüstzeit, Ziehen: Felder, auf die gezogen werden kann. */
  readonly targets?: readonly number[];
  /** Geplanter Ausbau je Feld: die Stufe, die dort entsteht. */
  readonly planned?: Readonly<Record<number, RealmBuilt>>;
  /** Geplante Käufe je Feld. */
  readonly recruits?: Readonly<Record<number, number>>;
  /** Geplante oder eben aufgedeckte Züge. */
  readonly moves?: readonly RealmMove[];
  readonly changes?: readonly RealmChange[];
  /** Rüstzeit: Felder anderer Reiche treten zurück. */
  readonly focusSeat?: number | null;
  /** Felder, deren Stand sich eben geändert hat (Aufdecken, Ausgang). */
  readonly fresh?: readonly number[];
}

const SYMBOL: Readonly<Record<RealmBuilt, SymbolId>> = {
  VILLAGE: 'village',
  TOWN: 'town',
  CASTLE: 'castle',
};

/** Steht auf dem Feld etwas, das die Landschaft in der Mitte verdrängt? */
export function hasBuilding(layer: RealmLayer, region: number): boolean {
  return (
    (layer.regions[region]?.building ?? 'NONE') !== 'NONE' || layer.planned?.[region] !== undefined
  );
}

/** Wo das Banner der Armeen steht: neben der Münze, bei einer Burg rechts neben dem Turm. */
function bannerAt(region: ArtRegion, castle: boolean, s: number): { x: number; y: number } {
  return castle
    ? { x: region.cx + 0.52 * s, y: region.cy + 0.1 * s }
    : { x: region.cx - 0.21 * s, y: region.cy + 0.3 * s };
}

/** Gebäude und Armeen eines Felds; ersetzt das Besitzerschild der Partie ohne Ausbau. */
export function RealmRegionArt({
  prefix,
  region,
  owner,
  castle,
  size: s,
  layer,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly owner: number | null;
  /** Hier steht eine Burg: Sie zeichnet die Karte selbst, mit ihren Leben. */
  readonly castle: boolean;
  readonly size: number;
  readonly layer: RealmLayer;
}) {
  const { cx, cy } = region;
  const state = layer.regions[region.id];
  if (!state) return null;
  const flag: CSSProperties = { ['--flag' as string]: `var(--seat-${owner ?? 0})` };
  const planned = layer.planned?.[region.id] ?? null;
  const building = planned ?? (state.building === 'NONE' ? null : state.building);
  const plus = layer.recruits?.[region.id] ?? 0;
  const banner = bannerAt(region, castle, s);
  const b = 0.56 * s;
  const fresh = layer.fresh?.includes(region.id) ?? false;
  // Eine stehende Burg zeichnet die Karte; hier nur Dorf, Stadt und jeder geplante Bau
  const drawn = building !== null && (planned !== null || !castle);
  return (
    <>
      {drawn ? (
        <g
          className={`building${planned ? ' ghost' : ''}${fresh ? ' fresh' : ''}`}
          style={flag}
          data-building={building}
        >
          <use
            href={symbolRef(prefix, SYMBOL[building])}
            x={cx - 0.3 * s}
            y={cy - 0.78 * s}
            width={0.6 * s}
            height={0.6 * s}
          />
          {planned ? (
            <g className="ghost-plus">
              <circle cx={cx + 0.27 * s} cy={cy - 0.62 * s} r={0.11 * s} />
              <path
                d={`M${cx + 0.21 * s} ${cy - 0.62 * s}h${0.12 * s}M${cx + 0.27 * s} ${cy - 0.68 * s}v${0.12 * s}`}
              />
            </g>
          ) : null}
        </g>
      ) : null}
      {owner !== null && (state.armies > 0 || plus > 0) ? (
        <g
          key={`army-${state.armies}`}
          className={`army seat-${owner}${fresh ? ' fresh' : ''}`}
          style={flag}
          data-armies={state.armies}
        >
          <use
            href={symbolRef(prefix, 'pennant')}
            x={banner.x - b / 2}
            y={banner.y - b / 2}
            width={b}
            height={b}
          />
          <text x={banner.x} y={banner.y - 0.045 * s} className="army-count">
            {state.armies}
          </text>
        </g>
      ) : null}
    </>
  );
}

/** Pfeilspitze am Ende einer Kurve, in Richtung ihrer letzten Tangente. */
function tip(fromX: number, fromY: number, x: number, y: number, size: number): string {
  const dx = x - fromX;
  const dy = y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x - ux * size * 0.2;
  const by = y - uy * size * 0.2;
  const px = -uy * size * 0.62;
  const py = ux * size * 0.62;
  return `M${x + ux * size * 0.8} ${y + uy * size * 0.8}L${bx + px} ${by + py}L${bx - px} ${by - py}Z`;
}

const round = (n: number) => Math.round(n * 10) / 10;

/** Ebene der Pläne: Auswahl und mögliche Ziele unter, Pfeile und Schilder über der Beschriftung. */
export function RealmPlanArt({
  art,
  layer,
  owners,
  size: s,
  level,
}: {
  readonly art: MapArt;
  readonly layer: RealmLayer;
  /** Besitzer je Feld, für das Zurücktreten fremder Felder. */
  readonly owners: readonly (number | null)[];
  readonly size: number;
  /** `under`: Flächen und Ränder unter den Beschriftungen; `over`: Pfeile und Schilder darüber. */
  readonly level: 'under' | 'over';
}) {
  const at = (id: number) => art.regions[id];
  if (level === 'under') {
    const selected =
      layer.selected === undefined || layer.selected === null ? undefined : at(layer.selected);
    return (
      <g className="realm-plan" aria-hidden="true">
        {layer.focusSeat !== undefined && layer.focusSeat !== null
          ? art.regions
              .filter((r) => owners[r.id] !== layer.focusSeat)
              .map((r) => <path key={r.id} d={r.d} className="plan-dim" />)
          : null}
        {(layer.targets ?? []).map((id) => {
          const r = at(id);
          return r ? <path key={id} d={r.d} className="plan-target" /> : null;
        })}
        {selected ? <path d={selected.d} className="plan-selected" /> : null}
      </g>
    );
  }
  return (
    <g className="realm-plan" aria-hidden="true">
      {Object.entries(layer.recruits ?? {}).map(([key, plus]) => {
        const r = at(Number(key));
        if (!r || plus <= 0) return null;
        const castle = (layer.regions[r.id]?.building ?? 'NONE') === 'CASTLE';
        const banner = bannerAt(r, castle, s);
        return (
          <g key={key} className="army-plus">
            <circle cx={banner.x + 0.04 * s} cy={banner.y + 0.4 * s} r={0.17 * s} />
            <text x={banner.x + 0.04 * s} y={banner.y + 0.405 * s}>
              +{plus}
            </text>
          </g>
        );
      })}
      {(layer.moves ?? []).map((move) => {
        const a = at(move.from);
        const b = at(move.to);
        if (!a || !b) return null;
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        // Der Pfeil beginnt und endet vor den Beschriftungen und biegt sich leicht
        const x1 = a.cx + ux * 0.46 * s;
        const y1 = a.cy + uy * 0.46 * s;
        const x2 = b.cx - ux * 0.56 * s;
        const y2 = b.cy - uy * 0.56 * s;
        const mx = (x1 + x2) / 2 - uy * 0.16 * s;
        const my = (y1 + y2) / 2 + ux * 0.16 * s;
        const curve = `M${round(x1)} ${round(y1)}Q${round(mx)} ${round(my)} ${round(x2)} ${round(y2)}`;
        const midX = (x1 + 2 * mx + x2) / 4;
        const midY = (y1 + 2 * my + y2) / 4;
        return (
          <g
            key={`${move.seat}:${move.from}:${move.to}`}
            className="plan-move"
            style={{ ['--flag' as string]: `var(--seat-${move.seat})` }}
          >
            <path d={curve} className="move-halo" />
            <path d={curve} className="move-line" />
            <path d={tip(mx, my, x2, y2, 0.26 * s)} className="move-tip" />
            <circle cx={midX} cy={midY} r={0.19 * s} className="move-disc" />
            <text x={midX} y={midY} className="move-count">
              {move.count}
            </text>
          </g>
        );
      })}
      {(layer.changes ?? []).map((change) => {
        const r = at(change.region);
        if (!r) return null;
        const w = (change.text.length * 0.165 + 0.36) * s;
        return (
          <g
            key={`${change.region}:${change.text}`}
            className="plan-change"
            style={{ ['--flag' as string]: `var(--seat-${change.seat})` }}
          >
            <rect x={r.cx - w / 2} y={r.cy - 0.72 * s} width={w} height={0.44 * s} rx={0.22 * s} />
            <text x={r.cx} y={r.cy - 0.5 * s}>
              {change.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
