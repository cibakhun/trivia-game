import type { RealmBuildingCode } from '@rdw/protocol';
import type { CSSProperties, ReactNode } from 'react';
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
  /** Gehaltene Verteidigungen: Jede macht das Feld mehr wert als üblich (MATCH_RULES §11.7). */
  readonly held: number;
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
  /** Farbe des Rands; `null` = ohne Sieger (ein freies Feld bleibt frei). */
  readonly seat: number | null;
}

/**
 * Was sich auf einem Feld eben getan hat (ADR-067). Die Karte zeigt immer schon den neuen Stand;
 * hieraus spielt sie einmal ab, wie es dazu kam.
 */
export interface RealmFieldMotion {
  /** Aufdecken: Hier wurde gebaut, das Gebäude wächst aus dem Boden. */
  readonly built?: boolean;
  /** Ausgang: Gebäude, das hier eben eine Stufe fiel oder einstürzte (was vorher stand). */
  readonly fell?: RealmBuilt;
  /** Ausgang: Sitz, dem die eingestürzte Burg gehörte; das Feld gehört schon dem Sieger. */
  readonly fellOf?: number;
  /** Aufdecken: neue Armeen, sie treten aus der Burg. */
  readonly recruited?: number;
  /** Aufdecken: Armeen, die hierher zogen. */
  readonly arrived?: number;
  /** Aufdecken: Armeen, die von hier fortzogen. */
  readonly left?: number;
  /** Ausgang: Sitz, der hier eben eine Armee verlor. */
  readonly lost?: number;
}

export interface RealmMotion {
  readonly kind: 'orders' | 'outcome';
  readonly fields: Readonly<Record<number, RealmFieldMotion>>;
}

/** Armeen auf einem Feld, bevor sich dort etwas bewegte. */
export function armiesBefore(armies: number, motion: RealmFieldMotion | null): number {
  if (!motion) return armies;
  return (
    armies -
    (motion.recruited ?? 0) -
    (motion.arrived ?? 0) +
    (motion.left ?? 0) +
    (motion.lost === undefined ? 0 : 1)
  );
}

/**
 * Wann die Zahl auf der Fahne wechselt: wenn die neue Armee aus der Burg tritt, wenn ein Zug
 * ankommt, wenn er aufbricht oder wenn der Schlag sitzt. Die Zeiten dazu stehen in `map-art.css`.
 */
export type ArmySwitch = 'recruit' | 'in' | 'out' | 'loss';

export function armySwitch(motion: RealmFieldMotion): ArmySwitch {
  if (motion.lost !== undefined) return 'loss';
  if ((motion.recruited ?? 0) > 0) return 'recruit';
  return (motion.arrived ?? 0) > 0 ? 'in' : 'out';
}

/** Was die Karte über die klassische Partie hinaus zeigt. */
export interface RealmLayer {
  readonly regions: readonly RealmRegionLayer[];
  /** Gewähltes Feld: in der Rüstzeit das eigene, beim Angriff das Ziel. */
  readonly selected?: number | null;
  /** Rüstzeit, Ziehen: Felder, auf die gezogen werden kann. */
  readonly targets?: readonly number[];
  /** Rüstzeit, noch kein Feld gewählt: die eigenen Felder leuchten zweimal kurz auf. */
  readonly hint?: readonly number[];
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
  /**
   * Der Wechsel zu diesem Stand wurde miterlebt: Die Karte spielt ihn einmal ab. Ohne das steht
   * sofort das Endbild (Seite mitten im Aufdecken geladen).
   */
  readonly motion?: RealmMotion | null;
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

/**
 * Maße der Burg mit Ausbau in Sechseckgrößen, um die Mitte des Felds: neben einem Bannerträger
 * nach links gerückt, darunter die Lebensschilde.
 */
export const REALM_CASTLE = {
  beside: -0.28,
  y: -0.02,
  size: 0.8,
  livesY: 0.54,
  livesGap: 0.24,
  life: 0.22,
} as const;

/** Größe des Bannerträgers in Sechseckgrößen: neben einer Burg etwas größer. */
export const BEARER = { castle: 0.76, field: 0.7 } as const;

/** Wo der Bannerträger steht: unter dem Namen, bei einer Burg rechts neben dem Turm. */
function bannerAt(region: ArtRegion, castle: boolean, s: number): { x: number; y: number } {
  return castle
    ? { x: region.cx + 0.47 * s, y: region.cy + 0.02 * s }
    : { x: region.cx - 0.04 * s, y: region.cy + 0.47 * s };
}

/** Tor einer Burg, neben der ein Bannerträger steht: Von hier treten neue Armeen heraus. */
function gateAt(region: ArtRegion, s: number): { x: number; y: number } {
  return { x: region.cx - 0.28 * s, y: region.cy + 0.16 * s };
}

/** Bannerträger mit der Zahl auf der Fahne, um den Punkt (x, y). */
function Bearer({
  prefix,
  x,
  y,
  size: b,
  children,
}: {
  readonly prefix: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly children?: ReactNode;
}) {
  return (
    <>
      <use href={symbolRef(prefix, 'bearer')} x={x - b / 2} y={y - b / 2} width={b} height={b} />
      {children}
    </>
  );
}

/** Gebäude und Armeen eines Felds; ersetzt das Besitzerschild der Partie ohne Ausbau. */
export function RealmRegionArt({
  prefix,
  region,
  owner,
  castle,
  size: s,
  layer,
  armiesSeen,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly owner: number | null;
  /** Hier steht eine Burg: Sie zeichnet die Karte selbst, mit ihren Leben. */
  readonly castle: boolean;
  readonly size: number;
  readonly layer: RealmLayer;
  /** Armeen hier vor dem Ausgang, soweit die Karte sie gesehen hat (ein genommenes Feld verliert alle). */
  readonly armiesSeen?: number | undefined;
}) {
  const { cx, cy } = region;
  const state = layer.regions[region.id];
  if (!state) return null;
  const flag: CSSProperties = { ['--flag' as string]: `var(--seat-${owner ?? 0})` };
  const planned = layer.planned?.[region.id] ?? null;
  const building = planned ?? (state.building === 'NONE' ? null : state.building);
  const plus = layer.recruits?.[region.id] ?? 0;
  const motion = layer.motion?.fields[region.id] ?? null;
  const banner = bannerAt(region, castle, s);
  const b = (castle ? BEARER.castle : BEARER.field) * s;
  const fresh = layer.fresh?.includes(region.id) ?? false;
  // Eine stehende Burg zeichnet die Karte; hier nur Dorf, Stadt und jeder geplante Bau
  const drawn = building !== null && (planned !== null || !castle);
  // Eine eingestürzte Burg zeichnet `RealmRuinArt`, mit ihrem Bannerträger
  const ruin = motion?.fell === 'CASTLE';
  const fell = motion?.fell === undefined || ruin ? null : motion.fell;
  const rising = motion?.built === true && planned === null;
  // Wer ein Feld verliert, verliert alle Armeen darauf, das Ereignis nennt nur eine
  const was =
    motion?.lost !== undefined && state.armies === 0
      ? Math.max(1, armiesSeen ?? 1)
      : armiesBefore(state.armies, motion);
  const standing = owner !== null && (state.armies > 0 || plus > 0);
  const moved = motion !== null && was !== state.armies;
  // Ist bekannt, was sich bewegt hat, trägt nur das den Schein; sonst alles auf dem Feld
  const known = layer.motion !== undefined && layer.motion !== null;
  const glowBuilding = fresh && (known ? rising || fell !== null : drawn);
  const glowArmy = fresh && (!known || moved);
  const count = (x: number, y: number, size: number, value: number, extra = '') => (
    <text x={x + 0.22 * size} y={y - 0.25 * size} className={`army-count${extra}`}>
      {value}
    </text>
  );
  const house = (kind: RealmBuilt) => (
    <use
      href={symbolRef(prefix, SYMBOL[kind])}
      x={cx - 0.37 * s}
      y={cy - 0.85 * s}
      width={0.74 * s}
      height={0.74 * s}
    />
  );
  return (
    <>
      {glowBuilding ? (
        <circle
          key="glow"
          cx={cx}
          cy={cy - 0.46 * s}
          r={0.5 * s}
          className="fresh-glow"
          fill={`url(#${prefix}-glow)`}
        />
      ) : null}
      {fell !== null ? (
        // Was hier stand, bricht zusammen; im Endbild ist es fort
        <g key="fall" className="building falling" style={flag} data-fell={fell}>
          <g className="ruin">{house(fell)}</g>
          <g className="dust">
            <circle cx={cx - 0.2 * s} cy={cy - 0.2 * s} r={0.09 * s} />
            <circle cx={cx + 0.02 * s} cy={cy - 0.17 * s} r={0.11 * s} />
            <circle cx={cx + 0.22 * s} cy={cy - 0.2 * s} r={0.08 * s} />
          </g>
        </g>
      ) : null}
      {drawn ? (
        <g
          key="building"
          className={`building${planned ? ' ghost' : ''}${fresh ? ' fresh' : ''}${rising ? ' rising' : ''}${fell !== null ? ' settling' : ''}`}
          style={flag}
          data-building={building}
        >
          {house(building)}
          {planned ? (
            <g className="ghost-plus">
              <circle cx={cx + 0.36 * s} cy={cy - 0.66 * s} r={0.12 * s} />
              <path
                d={`M${cx + 0.3 * s} ${cy - 0.66 * s}h${0.12 * s}M${cx + 0.36 * s} ${cy - 0.72 * s}v${0.12 * s}`}
              />
            </g>
          ) : null}
        </g>
      ) : null}
      {standing ? (
        <g
          key={`army-${state.armies}`}
          className={`army seat-${owner}${fresh ? ' fresh' : ''}${moved ? (was > 0 ? ' counting' : ' arriving') : ''}`}
          style={flag}
          data-armies={state.armies}
          data-switch={moved && motion ? armySwitch(motion) : undefined}
        >
          {glowArmy ? (
            <circle
              cx={banner.x}
              cy={banner.y}
              r={0.42 * s}
              className="fresh-glow"
              fill={`url(#${prefix}-glow)`}
            />
          ) : null}
          <g className="army-body">
            <Bearer prefix={prefix} x={banner.x} y={banner.y} size={b}>
              {moved && was > 0 ? count(banner.x, banner.y, b, was, ' was') : null}
              {count(banner.x, banner.y, b, state.armies, moved && was > 0 ? ' now' : '')}
            </Bearer>
          </g>
        </g>
      ) : moved && motion && was > 0 && !ruin ? (
        // Hier steht keine Armee mehr: Sie bricht auf oder fällt, im Endbild ist sie fort
        <g
          key="army-gone"
          className={`army gone seat-${motion.lost ?? owner ?? 0}`}
          style={{ ['--flag' as string]: `var(--seat-${motion.lost ?? owner ?? 0})` }}
          data-switch={armySwitch(motion)}
        >
          <g className="army-body">
            <Bearer prefix={prefix} x={banner.x} y={banner.y} size={b}>
              {count(banner.x, banner.y, b, was)}
            </Bearer>
          </g>
        </g>
      ) : null}
    </>
  );
}

/**
 * Eine eben genommene Burg stürzt ein, wo sie stand, mit ihren Lebensschilden und dem
 * Bannerträger daneben. Sie liegt außerhalb der Beschriftung des Felds: Die wartet, bis das
 * Wappen des Siegers geht, die Burg fällt unter ihm.
 */
export function RealmRuinArt({
  prefix,
  region,
  size: s,
  motion,
  lives,
  armiesSeen,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly size: number;
  readonly motion: RealmFieldMotion;
  /** Lebensschilde einer Burg nach den Regeln; hier sind alle gebrochen. */
  readonly lives: number;
  readonly armiesSeen?: number | undefined;
}) {
  const { cx, cy } = region;
  const seat = motion.fellOf ?? motion.lost ?? 0;
  const flag: CSSProperties = { ['--flag' as string]: `var(--seat-${seat})` };
  // Neben einem Bannerträger stand die Burg nach links gerückt
  const guarded = motion.lost !== undefined;
  const x = cx + (guarded ? REALM_CASTLE.beside : 0) * s;
  const tower = REALM_CASTLE.size * s;
  const shield = REALM_CASTLE.life * s;
  const banner = bannerAt(region, true, s);
  const b = BEARER.castle * s;
  return (
    <>
      <g className="castle falling" style={flag}>
        <g className="ruin">
          <use
            href={symbolRef(prefix, 'castle')}
            x={x - tower / 2}
            y={cy + REALM_CASTLE.y * s - tower / 2}
            width={tower}
            height={tower}
          />
          {Array.from({ length: lives }, (_, i) => (
            <g key={i} className="life life-off">
              <use
                href={symbolRef(prefix, 'shield')}
                x={x + (i - (lives - 1) / 2) * REALM_CASTLE.livesGap * s - shield / 2}
                y={cy + REALM_CASTLE.livesY * s - shield / 2}
                width={shield}
                height={shield}
              />
            </g>
          ))}
        </g>
        <g className="dust">
          <circle cx={x - 0.24 * s} cy={cy + 0.24 * s} r={0.1 * s} />
          <circle cx={x + 0.02 * s} cy={cy + 0.28 * s} r={0.12 * s} />
          <circle cx={x + 0.26 * s} cy={cy + 0.24 * s} r={0.09 * s} />
        </g>
      </g>
      {guarded ? (
        <g className={`army gone seat-${seat}`} style={flag} data-switch="ruin">
          <g className="army-body">
            <Bearer prefix={prefix} x={banner.x} y={banner.y} size={b}>
              <text x={banner.x + 0.22 * b} y={banner.y - 0.25 * b} className="army-count">
                {Math.max(1, armiesSeen ?? 1)}
              </text>
            </Bearer>
          </g>
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
  prefix,
  art,
  layer,
  owners,
  size: s,
  level,
}: {
  readonly prefix: string;
  readonly art: MapArt;
  readonly layer: RealmLayer;
  /** Besitzer je Feld, für das Zurücktreten fremder Felder. */
  readonly owners: readonly (number | null)[];
  readonly size: number;
  /**
   * `under`: Flächen und Ränder unter den Beschriftungen; `over`: Pfeile darüber; `top`: Schilder
   * über allem, auch über dem Schleier eines Duells.
   */
  readonly level: 'under' | 'over' | 'top';
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
        {(layer.hint ?? []).map((id) => {
          const r = at(id);
          return r ? <path key={id} d={r.d} className="plan-hint" /> : null;
        })}
        {(layer.targets ?? []).map((id) => {
          const r = at(id);
          return r ? <path key={id} d={r.d} className="plan-target" /> : null;
        })}
        {selected ? <path d={selected.d} className="plan-selected" /> : null}
      </g>
    );
  }
  if (level === 'top') {
    return (
      <g className="realm-plan" aria-hidden="true">
        {(layer.changes ?? []).map((change) => {
          const r = at(change.region);
          if (!r) return null;
          const w = (change.text.length * 0.165 + 0.36) * s;
          // Mit Bewegung kommt das Schild erst, wenn der Schlag sitzt; fällt ein Gebäude, danach
          const late = layer.motion?.kind === 'outcome';
          const fell = layer.motion?.fields[change.region]?.fell !== undefined;
          return (
            <g
              key={`${change.region}:${change.text}`}
              className={`plan-change${late ? ' late' : ''}${fell ? ' after-fall' : ''}`}
              style={{
                ['--flag' as string]:
                  change.seat === null ? 'var(--map-stone)' : `var(--seat-${change.seat})`,
              }}
            >
              <rect
                x={r.cx - w / 2}
                y={r.cy - 0.72 * s}
                width={w}
                height={0.44 * s}
                rx={0.22 * s}
              />
              <text x={r.cx} y={r.cy - 0.5 * s}>
                {change.text}
              </text>
            </g>
          );
        })}
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
        // Unter dem Tuch, neben dem Träger: Dort bleibt das Plättchen im eigenen Feld
        const b = (castle ? BEARER.castle : BEARER.field) * s;
        const px = banner.x + 0.24 * b;
        const py = banner.y + 0.3 * b;
        return (
          <g key={key} className="army-plus">
            <circle cx={px} cy={py} r={0.16 * s} />
            <text x={px} y={py + 0.005 * s}>
              +{plus}
            </text>
          </g>
        );
      })}
      {(layer.moves ?? []).map((move) => {
        const a = at(move.from);
        const b = at(move.to);
        if (!a || !b) return null;
        const live = layer.motion?.kind === 'orders';
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
            className={`plan-move${live ? ' drawn' : ''}`}
            style={{ ['--flag' as string]: `var(--seat-${move.seat})` }}
          >
            <path d={curve} className="move-halo" pathLength={live ? 1 : undefined} />
            <path d={curve} className="move-line" pathLength={live ? 1 : undefined} />
            <path d={tip(mx, my, x2, y2, 0.26 * s)} className="move-tip" />
            <g className="move-badge">
              <circle cx={midX} cy={midY} r={0.19 * s} className="move-disc" />
              <text x={midX} y={midY} className="move-count">
                {move.count}
              </text>
            </g>
          </g>
        );
      })}
      {layer.motion?.kind === 'orders'
        ? (layer.moves ?? []).map((move) => {
            const a = at(move.from);
            const b = at(move.to);
            if (!a || !b) return null;
            // Der Zug marschiert von Fahne zu Fahne, mit dem Bogen des Pfeils
            const from = bannerAt(a, (layer.regions[a.id]?.building ?? 'NONE') === 'CASTLE', s);
            const to = bannerAt(b, (layer.regions[b.id]?.building ?? 'NONE') === 'CASTLE', s);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.hypot(dx, dy) || 1;
            const size = BEARER.field * s;
            return (
              <g
                key={`march:${move.seat}:${move.from}:${move.to}`}
                className={`marcher seat-${move.seat}`}
                style={{
                  ['--flag' as string]: `var(--seat-${move.seat})`,
                  ['--dx' as string]: `${round(dx)}px`,
                  ['--dy' as string]: `${round(dy)}px`,
                  ['--mx' as string]: `${round(dx / 2 - (dy / len) * 0.16 * s)}px`,
                  ['--my' as string]: `${round(dy / 2 + (dx / len) * 0.16 * s)}px`,
                }}
              >
                <g className="marcher-hop">
                  <Bearer prefix={prefix} x={from.x} y={from.y} size={size}>
                    <text x={from.x + 0.22 * size} y={from.y - 0.25 * size} className="army-count">
                      {move.count}
                    </text>
                  </Bearer>
                </g>
              </g>
            );
          })
        : null}
      {layer.motion?.kind === 'orders'
        ? Object.entries(layer.motion.fields).map(([key, field]) => {
            const r = at(Number(key));
            const recruited = field.recruited ?? 0;
            if (!r || recruited <= 0) return null;
            // Neue Armeen treten aus dem Tor und stellen sich zur Fahne
            const gate = gateAt(r, s);
            const size = BEARER.castle * s;
            // Sie bleiben links neben dem Träger stehen: So liegt ihre Zahl nicht auf seiner
            const flagAt = bannerAt(r, true, s);
            const to = { x: flagAt.x - 0.3 * size, y: flagAt.y };
            const seat = owners[r.id] ?? 0;
            return (
              <g
                key={`recruit:${key}`}
                className={`marcher recruit seat-${seat}`}
                style={{
                  ['--flag' as string]: `var(--seat-${seat})`,
                  ['--dx' as string]: `${round(to.x - gate.x)}px`,
                  ['--dy' as string]: `${round(to.y - gate.y)}px`,
                }}
              >
                <g className="marcher-hop">
                  <Bearer prefix={prefix} x={gate.x} y={gate.y} size={size}>
                    <text x={gate.x + 0.22 * size} y={gate.y - 0.25 * size} className="army-count">
                      +{recruited}
                    </text>
                  </Bearer>
                </g>
              </g>
            );
          })
        : null}
    </g>
  );
}
