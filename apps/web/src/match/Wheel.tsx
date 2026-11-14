import type { QuestionCategory, RealmWheelDto } from '@rdw/protocol';
import type { CSSProperties, ReactNode } from 'react';
import { CATEGORY_GLYPH } from '../art/RealmIcons.tsx';
import { wheelBlur, wheelClacks, type WheelClack } from './wheel-motion.ts';

/**
 * Glücksrad eines Duells (MATCH_RULES §11.5, docs/ART_DIRECTION.md §4): Jede Kategorie ist ein
 * Feld, so breit wie ihre Chance. Die Farbe zeigt, wessen Lieblingskategorie ein Feld ist: der
 * Anteil des Angreifers und des Verteidigers in ihren Farben, der Rest ist frei. Kategorien ohne
 * ungestellte Frage fehlen. Das Rad rollt aus, läuft ein Stück über die gezogene Kategorie hinaus
 * und federt zurück (ADR-067). An jeder Feldgrenze sitzt ein Stift; solange das Rad schnell dreht,
 * ist die Scheibe ein Wirbel und der Zeiger lehnt angedrückt, danach klackert er an jedem Stift,
 * der unter ihm durchläuft (ADR-069). Steht das Rad, flammt das gezogene Feld auf. Mit „Bewegung
 * reduzieren“ steht es sofort dort. Nur Zierde: Was gezogen wurde, sagt das Blatt.
 */

const R = 88;
const VIEW = '-104 -114 208 222';
/** So viele ganze Umdrehungen läuft das Rad, bevor es stehen bleibt. */
const TURNS = 3;

function polar(angle: number, r: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
}

const round = (n: number) => Math.round(n * 100) / 100;

function slice(from: number, to: number, r: number): string {
  // Ein ganzer Kreis (nur eine Kategorie übrig) hat denselben Anfangs- und Endpunkt; SVG ließe
  // den Bogen dann weg. Zwei Halbkreise zeichnen ihn, ohne Strich zur Mitte.
  if (to - from >= 360) {
    const [ax, ay] = polar(from, r).map(round);
    const [bx, by] = polar(from + 180, r).map(round);
    return `M${ax} ${ay}A${r} ${r} 0 1 1 ${bx} ${by}A${r} ${r} 0 1 1 ${ax} ${ay}Z`;
  }
  const [x1, y1] = polar(from, r);
  const [x2, y2] = polar(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M0 0L${round(x1)} ${round(y1)}A${r} ${r} 0 ${large} 1 ${round(x2)} ${round(y2)}Z`;
}

export interface WheelPart {
  readonly category: QuestionCategory;
  readonly from: number;
  readonly to: number;
  readonly span: number;
  /** Winkel der Anteile aus den Lieblingskategorien von Angreifer und Verteidiger. */
  readonly attacker: number;
  readonly defender: number;
}

/**
 * Felder des Rads als Winkel; Kategorien aus `exhausted` fallen heraus (MATCH_RULES §11.6). Sind
 * alle erschöpft, gilt wie am Server wieder das ganze Rad.
 */
export function wheelParts(
  wheel: Pick<RealmWheelDto, 'segments'>,
  exhausted: readonly QuestionCategory[] = [],
): WheelPart[] {
  const weighted = wheel.segments.filter((s) => s.weight > 0);
  const open = weighted.filter((s) => !exhausted.includes(s.category));
  const live = open.length > 0 ? open : weighted;
  const total = live.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return [];
  let angle = 0;
  return live.map((s) => {
    const span = (s.weight / total) * 360;
    const from = angle;
    angle += span;
    return {
      category: s.category,
      from,
      to: angle,
      span,
      attacker: (s.attacker / s.weight) * span,
      defender: (s.defender / s.weight) * span,
    };
  });
}

/** Wo im gezogenen Feld der Zeiger stehen bleibt, als Anteil seiner Breite. */
const REST = 0.62;
/** Mitte des Zeichens eines Felds, als Anteil des Halbmessers. */
const GLYPH_AT = 0.66;

/** Drehung, bei der `landed` unter dem Zeiger oben liegt; 0 ohne Treffer. */
export function wheelTurn(parts: readonly WheelPart[], landed: QuestionCategory | null): number {
  const hit = parts.find((p) => p.category === landed);
  return hit ? -(hit.from + hit.span * REST) : 0;
}

/**
 * So weit läuft das Rad über sein Ziel hinaus, bevor es zurückfedert, in Grad: höchstens 7 und
 * nie mehr als 40 % des Wegs bis zum Rand des gezogenen Felds. Der Zeiger verlässt das Feld also
 * nie, auch ein schmales nicht.
 */
export function wheelOvershoot(span: number): number {
  return Math.max(0, Math.min(7, span * REST * 0.4));
}

/** Anteil des Ausschlags, um den das Rad danach zur anderen Seite schwingt. */
export const WHEEL_SWING_BACK = 0.35;

/** Drehpunkt des Zeigers (über dem Rand) und Halbmesser der Stifte. */
const PIVOT_Y = -107;
const PEG_AT = R + 4.5;
/** So breit verwischt der Wirbel die Felder, in Grad. */
const WHIRL_DEG = 40;

/**
 * Strahlen hinter dem Rad, wenn es steht: ein Fächer über dem gezogenen Feld oben, die mittleren
 * am längsten, nach außen kürzer.
 */
const RAYS = Array.from({ length: 13 }, (_, i) => {
  const angle = (i - 6) * 10;
  const cos = Math.cos((angle * Math.PI) / 180);
  const reach = R + 12 + 30 * cos * cos;
  const [ax, ay] = polar(angle - 2.4, R + 6).map(round);
  const [tx, ty] = polar(angle, reach).map(round);
  const [bx, by] = polar(angle + 2.4, R + 6).map(round);
  return `M${ax} ${ay}L${tx} ${ty}L${bx} ${by}Z`;
}).join('');

/**
 * Zeiger: eine goldene Klinge, oben breit um den Drehpunkt, mit eingezogenen Flanken, die in eine
 * feine Spitze bis knapp ins Rad auslaufen. Schmal, wo die Stifte durchlaufen: Auch zwischen zwei
 * Stiften eines schmalen Felds bleibt Platz.
 */
const POINTER =
  'M-12 -112Q-12 -115-9 -115H9Q12 -115 12 -112V-109C5 -105 1.6 -96 0 -80C-1.6 -96-5 -105-12 -109Z';

/** Farbe des Rads an einer Stelle als Anteile von Angreifer, Verteidiger und freien Losen. */
interface Mix {
  readonly a: number;
  readonly d: number;
}

function mixColour({ a, d }: Mix, attacker: number, defender: number | null): string {
  const pct = (n: number) => `${round(Math.min(1, Math.max(0, n)) * 100)}%`;
  const free = Math.max(0, 1 - a - d);
  const rest =
    d > 1e-4 && defender !== null
      ? `color-mix(in srgb, var(--seat-${defender}) ${pct(d / Math.max(1e-6, d + free))}, var(--map-coin))`
      : 'var(--map-coin)';
  return a > 1e-4 ? `color-mix(in srgb, var(--seat-${attacker}) ${pct(a)}, ${rest})` : rest;
}

export interface WhirlStop {
  readonly angle: number;
  readonly colour: string;
}

/**
 * Wirbel: die Felder, um `WHIRL_DEG` verwischt, als Farbverlauf rund um die Mitte. Ein Kastenfilter
 * über Keile ergibt zwischen den Stellen eine Halbbreite vor und nach jeder Grenze gerade Übergänge,
 * die der Verlauf von selbst zieht; nur dort braucht er Stützstellen.
 */
export function wheelWhirl(
  parts: readonly WheelPart[],
  attacker: number,
  defender: number | null,
): string {
  const stops = whirlStops(parts, attacker, defender);
  if (stops.length === 0) return 'var(--map-coin)';
  return `conic-gradient(${stops.map((stop) => `${stop.colour} ${stop.angle}deg`).join(', ')})`;
}

/** Stützstellen des Wirbels von 0 bis 360 Grad. */
export function whirlStops(
  parts: readonly WheelPart[],
  attacker: number,
  defender: number | null,
): WhirlStop[] {
  const wedges = parts.flatMap((p) => {
    const d = defender === null ? 0 : p.defender;
    return [
      { from: p.from, to: p.from + p.attacker, a: 1, d: 0 },
      { from: p.from + p.attacker, to: p.from + p.attacker + d, a: 0, d: 1 },
      { from: p.from + p.attacker + d, to: p.to, a: 0, d: 0 },
    ].filter((w) => w.to - w.from > 1e-6);
  });
  if (wedges.length === 0) return [];
  const half = WHIRL_DEG / 2;
  // Anteil eines Keils am Fenster [lo, hi], auch über 0 Grad hinweg
  const overlap = (w: { from: number; to: number }, lo: number, hi: number) => {
    let sum = 0;
    for (const shift of [-360, 0, 360]) {
      sum += Math.max(0, Math.min(hi, w.to + shift) - Math.max(lo, w.from + shift));
    }
    return sum;
  };
  const at = (angle: number): Mix => {
    let a = 0;
    let d = 0;
    for (const w of wedges) {
      const share = overlap(w, angle - half, angle + half) / WHIRL_DEG;
      a += share * w.a;
      d += share * w.d;
    }
    return { a, d };
  };
  const stops = new Set<number>([0, 360]);
  for (const w of wedges) {
    for (const edge of [w.from, w.to]) {
      for (const side of [-half, half]) stops.add(round((((edge + side) % 360) + 360) % 360));
    }
  }
  return [...stops]
    .sort((x, y) => x - y)
    .map((angle) => ({ angle, colour: mixColour(at(angle), attacker, defender) }));
}

/**
 * Die Zeichen im Wirbel: ein heller Ring, so dicht wie ihr Anteil am Umfang, weich auslaufend wie
 * ihre runden Scheiben.
 */
function glyphBand(parts: readonly WheelPart[]): string | null {
  const sizes = parts.filter((p) => p.span >= 14).map((p) => 54 * glyphScale(p.span));
  if (sizes.length === 0) return null;
  const mean = sizes.reduce((sum, r) => sum + r, 0) / sizes.length;
  const cover = sizes.reduce((sum, r) => sum + 2 * r, 0) / (2 * Math.PI * R * GLYPH_AT);
  const at = GLYPH_AT * 100;
  const half = (mean / R) * 100;
  const tint = (share: number) =>
    `color-mix(in srgb, var(--map-coin) ${round(Math.min(0.7, cover) * share * 100)}%, transparent)`;
  return `radial-gradient(circle closest-side, transparent ${round(at - half)}%, ${tint(0.75)} ${round(at - half * 0.4)}%, ${tint(0.85)} ${round(at)}%, ${tint(0.75)} ${round(at + half * 0.4)}%, transparent ${round(at + half)}%)`;
}

/** Größe des Zeichens in einem Feld: Schmale Felder tragen kleinere. */
function glyphScale(span: number): number {
  return span >= 40 ? 0.3 : span >= 24 ? 0.25 : 0.17;
}

export function Wheel({
  wheel,
  attacker,
  defender,
  landed,
  exhausted = [],
  spinMs = 0,
  elapsedMs = 0,
}: {
  readonly wheel: RealmWheelDto;
  readonly attacker: number;
  /** `null` = freies Feld: Das Rad hat keine Anteile eines Verteidigers. */
  readonly defender: number | null;
  /** Gezogene Kategorie; `null` zeigt das Rad ohne Treffer. */
  readonly landed: QuestionCategory | null;
  readonly exhausted?: readonly QuestionCategory[];
  /** Dauer der Drehung; 0 = das Rad steht. */
  readonly spinMs?: number;
  /** So lange dreht es schon (Seite mitten in der Ansage geladen). */
  readonly elapsedMs?: number;
}) {
  const parts = wheelParts(wheel, exhausted);
  const hit = parts.find((p) => p.category === landed) ?? null;
  const turn = wheelTurn(parts, landed);
  const spinning = spinMs > 0 && hit !== null;
  const over = hit ? wheelOvershoot(hit.span) : 0;
  // Ein Rad mit nur einem Feld hat keine Grenze und damit keinen Stift
  const edges = parts.length > 1 ? parts.map((p) => p.from) : [];
  const sweep = { edges, from: turn - TURNS * 360, to: turn + over, spinMs };
  const clacks = spinning ? wheelClacks(sweep) : [];
  const blur = spinning ? wheelBlur(sweep) : { fullMs: 0, goneMs: 0 };
  // Angelehnt bleibt der Zeiger, bis der erste Stift ihn einzeln anstößt
  const first = clacks[0];
  const leanMs = first ? Math.min(first.atMs - first.pushMs, blur.goneMs) : blur.goneMs;
  // Wo das Zeichen des gezogenen Felds steht, wenn das Rad steht: Von dort springt es ins Blatt
  const [markX, markY] = hit ? polar(hit.span * (0.5 - REST), R * GLYPH_AT) : [0, 0];
  const band = spinning ? glyphBand(parts) : null;
  const style: CSSProperties = {
    ['--turn' as string]: `${round(turn)}deg`,
    ['--turn-from' as string]: `${round(sweep.from)}deg`,
    ['--turn-over' as string]: `${round(turn + over)}deg`,
    ['--turn-back' as string]: `${round(turn - over * WHEEL_SWING_BACK)}deg`,
    ['--spin' as string]: `${spinMs}ms`,
    ['--spun' as string]: `${-Math.max(0, Math.round(elapsedMs))}ms`,
    ...(spinning
      ? {
          ['--lean-ms' as string]: `${Math.max(120, Math.round(leanMs))}ms`,
          ['--blur-full' as string]: `${Math.round(blur.fullMs)}ms`,
          ['--blur-fade' as string]: `${Math.max(1, Math.round(blur.goneMs - blur.fullMs))}ms`,
        }
      : {}),
  };
  const pointer = (
    <g className="wheel-pointer">
      <path d={POINTER} className="wheel-pointer-shade" transform="translate(1.4 3)" />
      <path d={POINTER} className="wheel-pointer-blade" />
      <path d="M0 -104L0 -88" className="wheel-pointer-ridge" />
      <circle cy={PIVOT_Y} r="2.6" className="wheel-pointer-pin" />
    </g>
  );
  return (
    <div className={`wheel${spinning ? ' spinning' : ''}`} style={style} aria-hidden="true">
      <svg className="wheel-art" viewBox={VIEW} focusable="false">
        <defs>
          {/* Schatten und Strahlen als eigene Formen mit Verlauf statt Filter: Über einem drehenden
              Rad rechnete ein Filter jedes Bild neu */}
          <radialGradient id="wheel-shade">
            <stop offset="0.8" className="wheel-shade-in" />
            <stop offset="1" className="wheel-shade-out" />
          </radialGradient>
          <radialGradient id="wheel-ray" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={R + 42}>
            <stop offset="0.7" className="wheel-ray-in" />
            <stop offset="1" className="wheel-ray-out" />
          </radialGradient>
        </defs>
        <circle cy="7" r={R + 22} fill="url(#wheel-shade)" />
        {hit ? <path d={RAYS} fill="url(#wheel-ray)" className="wheel-rays" /> : null}
        <circle r={R + 10} className="wheel-rim" />
        <circle r={R + 4.5} className="wheel-rim-in" />
        <g className="wheel-disc">
          {parts.map((p) => {
            const mid = p.from + p.span / 2;
            const [ix, iy] = polar(mid, R * GLYPH_AT);
            return (
              <g key={p.category} className="wheel-seg">
                <path d={slice(p.from, p.to, R)} className="seg-free" />
                {p.attacker > 0 ? (
                  <path
                    d={slice(p.from, p.from + p.attacker, R)}
                    className="seg-side"
                    style={{ fill: `var(--seat-${attacker})` }}
                  />
                ) : null}
                {p.defender > 0 && defender !== null ? (
                  <path
                    d={slice(p.from + p.attacker, p.from + p.attacker + p.defender, R)}
                    className="seg-side"
                    style={{ fill: `var(--seat-${defender})` }}
                  />
                ) : null}
                <path d={slice(p.from, p.to, R)} className="seg-line" />
                {p.span >= 14 ? (
                  <g
                    transform={`translate(${round(ix)} ${round(iy)}) scale(${glyphScale(p.span)})`}
                  >
                    {/* Die Zeichen stehen aufrecht, wenn das Rad steht */}
                    <g className="seg-glyph" transform={`rotate(${round(-turn)})`}>
                      <circle r="54" className="seg-glyph-back" />
                      {CATEGORY_GLYPH[p.category]}
                    </g>
                  </g>
                ) : null}
              </g>
            );
          })}
          {hit ? (
            <>
              <path d={slice(hit.from, hit.to, R)} className="seg-hit-flash" />
              <path d={slice(hit.from, hit.to, R)} className="seg-hit-glow" />
              <path d={slice(hit.from, hit.to, R)} className="seg-hit-ring" />
            </>
          ) : null}
          {edges.length > 0 ? (
            <g className="wheel-pegs">
              {edges.map((edge) => {
                const [x, y] = polar(edge, PEG_AT);
                return (
                  <circle key={edge} cx={round(x)} cy={round(y)} r="2" className="wheel-peg" />
                );
              })}
            </g>
          ) : null}
        </g>
      </svg>
      {spinning ? (
        // Wirbel über der Scheibe, solange sie schnell dreht: dieselbe Drehung, die Felder verwischt.
        // Als HTML-Fläche dreht ihn der Browser, ohne ihn neu zu malen
        <span
          className="wheel-whirl"
          style={{
            background: [band, wheelWhirl(parts, attacker, defender)].filter(Boolean).join(', '),
          }}
        />
      ) : null}
      <svg className="wheel-front" viewBox={VIEW} focusable="false">
        <circle r="14" className="wheel-hub" />
        <path d="M0-5L5 0L0 5L-5 0Z" className="wheel-hub-mark" />
        {hit ? (
          <circle
            cx={round(markX)}
            cy={round(markY)}
            r="15"
            className="wheel-mark"
            data-wheel-mark
          />
        ) : null}
        <g className="wheel-arm">{clacked(pointer, clacks)}</g>
      </svg>
    </div>
  );
}

/**
 * Zeiger in einer Gruppe je Klacker: Jede dreht ihn um denselben Punkt, die Ausschläge addieren
 * sich, wenn ein Stift kommt, bevor der vorige ausgeschwungen hat.
 */
function clacked(pointer: ReactNode, clacks: readonly WheelClack[]): ReactNode {
  return clacks.reduceRight<ReactNode>(
    (inner, clack) => (
      <g
        key={Math.round(clack.atMs)}
        className="wheel-clack"
        style={{
          ['--clack-at' as string]: `${Math.round(clack.atMs - clack.pushMs)}ms`,
          ['--clack-push' as string]: `${Math.round(clack.pushMs)}ms`,
          ['--clack-snap' as string]: `${Math.round(clack.atMs)}ms`,
          ['--kick' as string]: `${round(-clack.kick)}deg`,
        }}
      >
        {inner}
      </g>
    ),
    pointer,
  );
}
