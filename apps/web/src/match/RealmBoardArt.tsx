import type { RealmBuildingCode } from '@rdw/protocol';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { crackRef, symbolRef, type CrackId, type SymbolId } from '../art/ArtDefs.tsx';
import type { ArtRegion, MapArt } from '../art/map-art.ts';
import type { DuelStage } from './match-model.ts';

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
  /** Wahl am Anfang: eben gesetzt. Die Lebensschilde einer Burg folgen erst, wenn sie steht. */
  readonly placed?: boolean;
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
  /** Ausgang: Die Burg hier wurde getroffen und verlor ein Leben (sie steht noch). */
  readonly hit?: boolean;
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
  /**
   * Rüstzeit: Was hier an Bau, Kauf und Zug steht, ist geplant und noch nicht ausgeführt. Die Zahl
   * eines geplanten Zugs steht auf Gold; neue Pläne setzen sich kurz in Szene (`Fresh`).
   */
  readonly planning?: boolean;
  /**
   * Zuletzt angetipptes Feld, das gerade kein Ziel ist (offenes „Ziehen“, Angriff): Es trägt einen
   * gepunkteten Tintenrand, solange das Blatt sagt, warum nicht.
   */
  readonly refused?: number | null;
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

/**
 * Steht auf dem Feld etwas, das die Landschaft in der Mitte verdrängt? Auch ein Gebäude, das
 * eben einstürzt: Die Landschaft kehrt erst zurück, wenn es fort ist, nicht schon darunter.
 */
export function hasBuilding(layer: RealmLayer, region: number): boolean {
  return (
    (layer.regions[region]?.building ?? 'NONE') !== 'NONE' ||
    layer.planned?.[region] !== undefined ||
    layer.motion?.fields[region]?.fell !== undefined
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
export function bannerAt(region: ArtRegion, castle: boolean, s: number): { x: number; y: number } {
  return castle
    ? { x: region.cx + 0.47 * s, y: region.cy + 0.02 * s }
    : { x: region.cx - 0.04 * s, y: region.cy + 0.47 * s };
}

/** Tor einer Burg, neben der ein Bannerträger steht: Von hier treten neue Armeen heraus. */
export function gateAt(region: ArtRegion, s: number): { x: number; y: number } {
  return { x: region.cx - 0.28 * s, y: region.cy + 0.16 * s };
}

/**
 * Kasten eines Motivs (Dorf, Stadt, Burg): links oben und Kantenlänge. Jedes Motiv steht in seinem
 * Kasten auf einer Linie bei 90 % der Höhe (`footOf`).
 */
export interface MotifBox {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Dorf und Stadt stehen über dem Namen. */
export function houseBox(region: ArtRegion, s: number): MotifBox {
  return { x: region.cx - 0.37 * s, y: region.cy - 0.85 * s, size: 0.74 * s };
}

/** Burg mit Ausbau, neben einem Bannerträger (`guarded`) nach links gerückt. */
export function castleBox(region: ArtRegion, s: number, guarded: boolean): MotifBox {
  const size = REALM_CASTLE.size * s;
  return {
    x: region.cx + (guarded ? REALM_CASTLE.beside : 0) * s - size / 2,
    y: region.cy + REALM_CASTLE.y * s - size / 2,
    size,
  };
}

/** Fußpunkt eines Motivs: Mitte unten, wo es auf dem Boden steht. */
export function footOf(box: MotifBox): { x: number; y: number } {
  return { x: box.x + box.size / 2, y: box.y + 0.9 * box.size };
}

/** Fußpunkt eines Bannerträgers der Größe `b`: unter seinem Rock. */
export function bearerFoot(at: { x: number; y: number }, b: number): { x: number; y: number } {
  return { x: at.x - 0.2 * b, y: at.y + 0.44 * b };
}

/**
 * Ein Feld verlor im Ausgang alle Armeen an den Sieger, der es nahm: Der Bannerträger des
 * Verlierers fällt, wenn der Schlag sitzt, und steht dazu außerhalb der Beschriftung, die bis
 * zum Abzug des Siegerwappens wartet. Eine genommene Burg nimmt ihn selbst mit (`RealmRuinArt`).
 */
export function routed(motion: RealmFieldMotion | null | undefined, owner: number | null): boolean {
  return (
    motion?.lost !== undefined &&
    motion.fell !== 'CASTLE' &&
    owner !== null &&
    owner !== motion.lost
  );
}

/**
 * Der Ausgang mit Ausbau beginnt mit der Szene `outcome` des Duells, wann immer sie kommt: Bis
 * dahin zeigt die Karte das Endbild, danach bleibt die Bewegung für dieses Duell stehen, auch wenn
 * das Blatt mit den Antworten folgt. Merken während des Renderns, wie `useDuelGround`; das ist kein
 * Stand der Partie, nur der Takt der Darstellung.
 */
export function useOutcomeMotion(
  realm: RealmLayer | null,
  duel: DuelStage | null,
): RealmLayer | null {
  const [seen, setSeen] = useState<string | null>(null);
  const outcome = realm?.motion?.kind === 'outcome';
  const key = outcome && duel ? `${duel.attacker}:${duel.region}` : null;
  if (!outcome) {
    if (seen !== null) setSeen(null);
    return realm;
  }
  if (key === null) return realm;
  if (duel?.scene === 'outcome') {
    if (seen !== key) setSeen(key);
    return realm;
  }
  return seen === key ? realm : { ...realm, motion: null };
}

/**
 * Gruppe (oder mit `path` ein Pfad), die ihre Bewegung `motion` nur trägt, wenn sie nach dem ersten
 * Aufbau der Karte erschienen ist; das steht beim Erscheinen fest (wie `Born` in `MatchBoard`).
 * So antwortet die Karte auf einen Tipp der Rüstzeit, läuft aber nichts an, wenn die Seite mitten
 * darin geladen wird. Ein neuer Stand braucht einen neuen Schlüssel (`key`).
 */
function Fresh({
  className,
  motion,
  live,
  style,
  path,
  children,
  ...data
}: {
  readonly className: string;
  readonly motion: string;
  readonly live: boolean;
  readonly style?: CSSProperties | undefined;
  readonly path?: string;
  readonly children?: ReactNode;
  readonly [data: `data-${string}`]: string | number | undefined;
}) {
  const [born] = useState(live);
  const classes = born && motion ? `${className} ${motion}` : className;
  return path === undefined ? (
    <g className={classes} style={style} {...data}>
      {children}
    </g>
  ) : (
    <path d={path} className={classes} style={style} {...data} />
  );
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

/**
 * Ein Motiv, das in Stücke bricht (ADR-067): Bis zum Bruch steht es ganz da (`whole`), dann
 * übernehmen drei Stücke, jedes entlang einer festen Bruchlinie beschnitten, die versetzt
 * einsacken und kippen. Was unter den Boden sinkt, schneidet `ground` ab. Ohne Bewegung ist
 * alles unsichtbar: Im Endbild ist das Motiv fort.
 */
function Shatter({
  prefix,
  symbol,
  box,
  cracks,
  ground,
}: {
  readonly prefix: string;
  readonly symbol: SymbolId;
  readonly box: MotifBox;
  readonly cracks: readonly [CrackId, CrackId, CrackId];
  /** Eindeutige ID für den Boden, unter dem die Stücke verschwinden. */
  readonly ground: string;
}) {
  const motif = (
    <use href={symbolRef(prefix, symbol)} x={box.x} y={box.y} width={box.size} height={box.size} />
  );
  const foot = footOf(box);
  const wide = 2 * box.size;
  return (
    <>
      <clipPath id={ground}>
        <rect
          x={foot.x - wide}
          y={foot.y - wide}
          width={2 * wide}
          height={wide + 0.035 * box.size}
        />
      </clipPath>
      <g clipPath={`url(#${ground})`}>
        <g className="whole">{motif}</g>
        {cracks.map((crack, i) => (
          <g key={crack} className={`piece piece-${i}`}>
            <g clipPath={crackRef(prefix, crack)}>{motif}</g>
          </g>
        ))}
      </g>
    </>
  );
}

/**
 * Ein Lebensschild zerbricht: Bis zum Bruch steht es ganz da, dann fallen zwei Hälften entlang
 * einer gezackten Linie auseinander. Darunter liegt schon das leere Schild des Endbilds.
 */
export function ShieldShatter({
  prefix,
  x,
  y,
  size,
}: {
  readonly prefix: string;
  /** Mitte des Schilds. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
}) {
  const shield = (
    <use
      href={symbolRef(prefix, 'shield')}
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
    />
  );
  return (
    <g className="life life-shatter">
      <g className="whole">{shield}</g>
      {(['half-0', 'half-1'] as const).map((half, i) => (
        <g key={half} className={`half half-${i}`}>
          <g clipPath={crackRef(prefix, half)}>{shield}</g>
        </g>
      ))}
    </g>
  );
}

/** Staubwölkchen am Fuß eines Bannerträgers, der getroffen wird oder fällt. */
function ArmyDust({
  prefix,
  at,
  b,
}: {
  readonly prefix: string;
  readonly at: { x: number; y: number };
  readonly b: number;
}) {
  const foot = bearerFoot(at, b);
  return (
    <g className="army-dust">
      {[-0.2, 0.05, 0.32].map((dx, i) => (
        <circle
          key={i}
          cx={foot.x + dx * b}
          cy={foot.y - 0.04 * b * i}
          r={(0.15 + 0.03 * i) * b}
          fill={`url(#${prefix}-puff)`}
        />
      ))}
    </g>
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
  live,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly owner: number | null;
  /** Hier steht eine Burg: Sie zeichnet die Karte selbst, mit ihren Leben. */
  readonly castle: boolean;
  readonly size: number;
  readonly layer: RealmLayer;
  /** Die Karte steht schon: Was jetzt erscheint, hat die Seite miterlebt. */
  readonly live: boolean;
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
  // Eine eingestürzte Burg zeichnet `RealmRuinArt`, ein genommenes Feld `RealmRoutArt`, beide
  // mit ihrem Bannerträger
  const ruin = motion?.fell === 'CASTLE';
  const rout = routed(motion, owner);
  const fell = motion?.fell === undefined || ruin ? null : motion.fell;
  const rising = motion?.built === true && planned === null;
  const was = armiesBefore(state.armies, motion);
  const standing = owner !== null && (state.armies > 0 || plus > 0);
  const moved = motion !== null && was !== state.armies;
  const loss = motion?.lost !== undefined;
  // Ist bekannt, was sich bewegt hat, trägt nur das den Schein; sonst alles auf dem Feld
  const known = layer.motion !== undefined && layer.motion !== null;
  // Fällt ein Gebäude, trägt nur die Stufe den Schein, die danach noch steht, und erst dann
  const glowBuilding = fresh && drawn && (known ? rising || fell !== null : true);
  const glowArmy = fresh && (!known || moved);
  const count = (x: number, y: number, size: number, value: number, extra = '') => (
    <text x={x + 0.22 * size} y={y - 0.25 * size} className={`army-count${extra}`}>
      {value}
    </text>
  );
  const box = houseBox(region, s);
  const house = (kind: RealmBuilt) => (
    <use
      href={symbolRef(prefix, SYMBOL[kind])}
      x={box.x}
      y={box.y}
      width={box.size}
      height={box.size}
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
          className={`fresh-glow${fell !== null ? ' after-fall' : ''}`}
          fill={`url(#${prefix}-glow)`}
        />
      ) : null}
      {fell !== null ? (
        // Was hier stand, bricht in Stücke; im Endbild ist es fort
        <g key="fall" className="building falling" style={flag} data-fell={fell}>
          <Shatter
            prefix={prefix}
            symbol={SYMBOL[fell]}
            box={box}
            cracks={['crack-0', 'crack-1', 'crack-2']}
            ground={`${prefix}-ground-${region.id}`}
          />
        </g>
      ) : null}
      {drawn ? (
        // Ein Plan ist ein anderes Bild als das Gebäude selbst: Mit eigenem Schlüssel erscheint er
        // neu und setzt sich wie eine Skizze (`plan-sketch`), das goldene Plus stempelt sich
        <Fresh
          key={planned ? `plan-${planned}` : 'building'}
          className={`building${planned ? ' ghost' : ''}${fresh ? ' fresh' : ''}${rising ? ' rising' : ''}${fell !== null ? ' settling' : ''}`}
          motion={planned ? 'sketched' : ''}
          live={live}
          style={flag}
          data-building={building}
        >
          {planned ? <g className="ghost-house">{house(building)}</g> : house(building)}
          {planned ? (
            <g className="ghost-plus">
              <circle cx={cx + 0.36 * s} cy={cy - 0.66 * s} r={0.12 * s} />
              <path
                d={`M${cx + 0.36 * s - 0.06 * s} ${cy - 0.66 * s}h${0.12 * s}M${cx + 0.36 * s} ${cy - 0.72 * s}v${0.12 * s}`}
              />
            </g>
          ) : null}
        </Fresh>
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
          {moved && loss ? <ArmyDust prefix={prefix} at={banner} b={b} /> : null}
        </g>
      ) : moved && motion && was > 0 && !ruin && !rout ? (
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
          {loss ? <ArmyDust prefix={prefix} at={banner} b={b} /> : null}
        </g>
      ) : null}
    </>
  );
}

/**
 * Ein eben genommenes Feld: Der Bannerträger des Verlierers fällt, wenn der Schlag sitzt. Er
 * steht außerhalb der Beschriftung des Felds, die wartet, bis das Wappen des Siegers geht;
 * stünde er darin, tauchte er erst mit ihr auf und fiele im selben Augenblick.
 */
export function RealmRoutArt({
  prefix,
  region,
  size: s,
  motion,
  armiesSeen,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly size: number;
  readonly motion: RealmFieldMotion;
  readonly armiesSeen?: number | undefined;
}) {
  const seat = motion.lost ?? 0;
  const banner = bannerAt(region, false, s);
  const b = BEARER.field * s;
  return (
    <g
      className={`army gone rout seat-${seat}`}
      style={{ ['--flag' as string]: `var(--seat-${seat})` }}
      data-switch="rout"
    >
      <g className="army-body">
        <Bearer prefix={prefix} x={banner.x} y={banner.y} size={b}>
          <text x={banner.x + 0.22 * b} y={banner.y - 0.25 * b} className="army-count">
            {Math.max(1, armiesSeen ?? 1)}
          </text>
        </Bearer>
      </g>
      <ArmyDust prefix={prefix} at={banner} b={b} />
    </g>
  );
}

/**
 * Eine eben genommene Burg stürzt ein, wo sie stand: Sie bricht in Turm, Bergfried und Turm, die
 * nacheinander einsacken und kippen, ihr letztes Schild zerspringt, die leeren fallen mit, und der
 * Bannerträger daneben stürzt. Sie liegt außerhalb der Beschriftung des Felds: Die wartet, bis
 * das Wappen des Siegers geht, die Burg fällt unter ihm.
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
  /** Lebensschilde einer Burg nach den Regeln; das letzte bricht eben, die übrigen waren leer. */
  readonly lives: number;
  readonly armiesSeen?: number | undefined;
}) {
  const { cy } = region;
  const seat = motion.fellOf ?? motion.lost ?? 0;
  const flag: CSSProperties = { ['--flag' as string]: `var(--seat-${seat})` };
  // Neben einem Bannerträger stand die Burg nach links gerückt
  const guarded = motion.lost !== undefined;
  const box = castleBox(region, s, guarded);
  const x = box.x + box.size / 2;
  const shield = REALM_CASTLE.life * s;
  const banner = bannerAt(region, true, s);
  const b = BEARER.castle * s;
  const shieldAt = (i: number) => ({
    x: x + (i - (lives - 1) / 2) * REALM_CASTLE.livesGap * s,
    y: cy + REALM_CASTLE.livesY * s,
  });
  return (
    <>
      <g className="castle falling" style={flag}>
        <Shatter
          prefix={prefix}
          symbol="castle"
          box={box}
          cracks={['tower-0', 'tower-1', 'tower-2']}
          ground={`${prefix}-ruin-${region.id}`}
        />
        {Array.from({ length: lives }, (_, i) =>
          // Vor dem Fall stand noch ein Leben: das erste, wie in der Reihe der Burg
          i === 0 ? (
            <ShieldShatter key={i} prefix={prefix} {...shieldAt(i)} size={shield} />
          ) : (
            <g key={i} className={`life life-off drop drop-${i}`}>
              <use
                href={symbolRef(prefix, 'shield')}
                x={shieldAt(i).x - shield / 2}
                y={shieldAt(i).y - shield / 2}
                width={shield}
                height={shield}
              />
            </g>
          ),
        )}
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
          <ArmyDust prefix={prefix} at={banner} b={b} />
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

/** Wie weit der Stützpunkt eines Zugpfeils neben der geraden Linie liegt (in Feldgrößen). */
const MOVE_BOW = 0.34;

/** Name eines Felds an seinem Ort auf der Karte. */
export interface PlanLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** Ebene der Pläne: Auswahl und mögliche Ziele unter, Pfeile und Schilder über der Beschriftung. */
export function RealmPlanArt({
  prefix,
  art,
  layer,
  owners,
  size: s,
  level,
  live: settled,
  home = null,
  label,
}: {
  readonly prefix: string;
  readonly art: MapArt;
  readonly layer: RealmLayer;
  /** Besitzer je Feld, für das Zurücktreten fremder Felder. */
  readonly owners: readonly (number | null)[];
  readonly size: number;
  /** Die Karte steht schon: Was jetzt erscheint (Auswahl, Ziele, Pläne), antwortet auf einen Tipp. */
  readonly live: boolean;
  /**
   * `under`: Flächen und Ränder unter den Beschriftungen; `over`: Pfeile darüber; `top`: Schilder
   * über allem, auch über dem Schleier eines Duells.
   */
  readonly level: 'under' | 'over' | 'top';
  /** Eigener Sitz: Seine Felder treten in der Rüstzeit nicht zurück. */
  readonly home?: number | null;
  /** Beschriftung eines Felds (Ort und Name): Sie bleibt über den Pfeilen der Züge lesbar. */
  readonly label?: (region: number) => PlanLabel | null;
}) {
  const at = (id: number) => art.regions[id];
  if (level === 'under') {
    const selected =
      layer.selected === undefined || layer.selected === null ? undefined : at(layer.selected);
    const refused =
      layer.refused === undefined || layer.refused === null ? undefined : at(layer.refused);
    // Der Schleier über fremden Feldern liegt für den eigenen Sitz immer bereit und ist außerhalb
    // der Rüstzeit unsichtbar: So blendet er mit ihrem Beginn und Ende weich, statt zu springen
    const focused = layer.focusSeat !== undefined && layer.focusSeat !== null;
    const rest = focused ? layer.focusSeat : home;
    return (
      <g className="realm-plan" aria-hidden="true">
        {rest !== undefined && rest !== null
          ? art.regions
              .filter((r) => owners[r.id] !== rest)
              .map((r) => (
                <path key={r.id} d={r.d} className={focused ? 'plan-dim on' : 'plan-dim'} />
              ))
          : null}
        {(layer.hint ?? []).map((id) => {
          const r = at(id);
          return r ? <path key={id} d={r.d} className="plan-hint" /> : null;
        })}
        {(layer.targets ?? []).map((id) => {
          const r = at(id);
          // Mit „Ziehen“ leuchten die Ziele einmal auf; ihr Strichrand läuft, solange sie warten
          return r ? (
            <Fresh key={id} className="plan-target" motion="lit" live={settled} path={r.d} />
          ) : null;
        })}
        {refused ? (
          // Der Rand ruckt als Gruppe (bewegte Teile im SVG sind `<g>`, WebKit)
          <Fresh key={refused.id} className="plan-refused" motion="shaken" live={settled}>
            <path d={refused.d} />
          </Fresh>
        ) : null}
        {selected ? (
          // Der goldene Rand setzt sich mit dem Tipp; die dunkle Fassung ist eine eigene Form
          // statt eines Filters (WebKit)
          <Fresh key={selected.id} className="plan-selected" motion="land" live={settled}>
            <path d={selected.d} className="ring-casing" />
            <path d={selected.d} className="ring-line" />
          </Fresh>
        ) : null}
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
          // Mit Bewegung kommt das Schild erst, wenn der Schlag sitzt; fällt ein Gebäude oder
          // bebt eine Burg, danach, damit es nicht verdeckt, was dort geschieht
          const late = layer.motion?.kind === 'outcome';
          const field = layer.motion?.fields[change.region];
          const fell = field?.fell !== undefined || field?.hit === true;
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
  // Züge: Der Pfeil springt im Bogen von Feld zu Feld; seine Zahl sitzt außen am Scheitel,
  // neben der Zeile der Namen statt auf ihr
  const moves = (layer.moves ?? []).flatMap((move) => {
    const a = at(move.from);
    const b = at(move.to);
    if (!a || !b) return [];
    const live = layer.motion?.kind === 'orders';
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const x1 = a.cx + ux * 0.46 * s;
    const y1 = a.cy + uy * 0.46 * s;
    const x2 = b.cx - ux * 0.56 * s;
    const y2 = b.cy - uy * 0.56 * s;
    const mx = (x1 + x2) / 2 - uy * MOVE_BOW * s;
    const my = (y1 + y2) / 2 + ux * MOVE_BOW * s;
    // Scheitel des Bogens liegt auf halbem Weg zum Stützpunkt; die Zahl berührt ihn von außen
    const out = (MOVE_BOW / 2 + 0.19) * s;
    return [
      {
        move,
        live,
        // Geplant (Rüstzeit) schießt der Pfeil mit dem Tipp aufs Ziel, und seine Zahl steht auf
        // Gold; aufgedeckt zieht er sich wie ein Federstrich (`drawn`)
        planning: layer.planning === true && !live,
        curve: `M${round(x1)} ${round(y1)}Q${round(mx)} ${round(my)} ${round(x2)} ${round(y2)}`,
        tipPath: tip(mx, my, x2, y2, 0.26 * s),
        badgeX: (x1 + x2) / 2 - uy * out,
        badgeY: (y1 + y2) / 2 + ux * out,
      },
    ];
  });
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
          // Jede Änderung der Zahl stempelt das Plättchen neu: die Antwort auf „Kaufen“, + und −
          <Fresh
            key={`${key}:${plus}`}
            className="army-plus"
            motion="stamped"
            live={settled && layer.planning === true}
          >
            <circle cx={px} cy={py} r={0.16 * s} />
            <text x={px} y={py + 0.005 * s}>
              +{plus}
            </text>
          </Fresh>
        );
      })}
      {/* Züge in drei Lagen: erst die Pfeile, dann die Namen der Felder, die sie berühren, dann
          die Zahlen. So liegt kein Pfeil auf einem Namen und keine Zahl unter einem */}
      {moves.map(({ move, curve, tipPath, live, planning }) => (
        <Fresh
          key={`${move.seat}:${move.from}:${move.to}`}
          className={`plan-move${live ? ' drawn' : ''}${planning ? ' planned' : ''}`}
          motion={planning ? 'run' : ''}
          live={settled}
          style={{ ['--flag' as string]: `var(--seat-${move.seat})` }}
        >
          <path d={curve} className="move-halo" pathLength={live || planning ? 1 : undefined} />
          <path d={curve} className="move-line" pathLength={live || planning ? 1 : undefined} />
          <g className="move-head">
            <path d={tipPath} className="move-tip" />
          </g>
        </Fresh>
      ))}
      {label
        ? [...new Set(moves.flatMap(({ move }) => [move.from, move.to]))].map((id) => {
            const name = label(id);
            return name ? (
              <text key={id} x={name.x} y={name.y} className="board-name">
                {name.text}
              </text>
            ) : null;
          })
        : null}
      {moves.map(({ move, badgeX, badgeY, live, planning }) => (
        <g
          key={`${move.seat}:${move.from}:${move.to}`}
          className={`plan-move${live ? ' drawn' : ''}${planning ? ' planned' : ''}`}
          style={{ ['--flag' as string]: `var(--seat-${move.seat})` }}
        >
          {/* Zieht noch eine Armee denselben Weg, stempelt sich nur die Zahl neu */}
          <Fresh
            key={planning ? move.count : 'badge'}
            className="move-badge"
            motion={planning ? 'stamped' : ''}
            live={settled}
          >
            <circle cx={badgeX} cy={badgeY} r={0.19 * s} className="move-disc" />
            <text x={badgeX} y={badgeY} className="move-count">
              {move.count}
            </text>
          </Fresh>
        </g>
      ))}
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
            // Neue Armeen treten aus dem Tor und gehen im Träger an der Fahne auf
            const gate = gateAt(r, s);
            const size = BEARER.castle * s;
            const to = bannerAt(r, true, s);
            const seat = owners[r.id] ?? 0;
            return (
              <g key={`recruit:${key}`}>
                {/* Das Tor leuchtet auf, wenn sie heraustreten */}
                <g className="gate-light">
                  <circle
                    cx={gate.x}
                    cy={gate.y + 0.06 * s}
                    r={0.26 * s}
                    fill={`url(#${prefix}-glow)`}
                  />
                </g>
                <g
                  className={`marcher recruit seat-${seat}`}
                  style={{
                    ['--flag' as string]: `var(--seat-${seat})`,
                    ['--dx' as string]: `${round(to.x - gate.x)}px`,
                    ['--dy' as string]: `${round(to.y - gate.y)}px`,
                  }}
                >
                  <g className="marcher-hop">
                    <Bearer prefix={prefix} x={gate.x} y={gate.y} size={size}>
                      <text
                        x={gate.x + 0.22 * size}
                        y={gate.y - 0.25 * size}
                        className="army-count"
                      >
                        +{recruited}
                      </text>
                    </Bearer>
                  </g>
                </g>
              </g>
            );
          })
        : null}
    </g>
  );
}
