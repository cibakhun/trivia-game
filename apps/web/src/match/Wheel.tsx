import type { QuestionCategory, RealmWheelDto } from '@rdw/protocol';
import type { CSSProperties } from 'react';
import { CATEGORY_GLYPH } from '../art/RealmIcons.tsx';

/**
 * Glücksrad eines Duells (MATCH_RULES §11.5, docs/ART_DIRECTION.md §4): Jede Kategorie ist ein
 * Feld, so breit wie ihre Chance. Die Farbe zeigt, wessen Lieblingskategorie ein Feld ist: der
 * Anteil des Angreifers und des Verteidigers in ihren Farben, der Rest ist frei. Kategorien ohne
 * ungestellte Frage fehlen. Das Rad dreht, bis die gezogene Kategorie unter dem Zeiger liegt; mit
 * „Bewegung reduzieren“ steht es sofort dort. Nur Zierde: Was gezogen wurde, sagt das Blatt.
 */

const R = 88;
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

/** Drehung, bei der `landed` unter dem Zeiger oben liegt; 0 ohne Treffer. */
export function wheelTurn(parts: readonly WheelPart[], landed: QuestionCategory | null): number {
  const hit = parts.find((p) => p.category === landed);
  return hit ? -(hit.from + hit.span * 0.62) : 0;
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
  const style: CSSProperties = {
    ['--turn' as string]: `${round(turn)}deg`,
    ['--turn-from' as string]: `${round(turn - TURNS * 360)}deg`,
    ['--spin' as string]: `${spinMs}ms`,
    ['--spun' as string]: `${-Math.max(0, Math.round(elapsedMs))}ms`,
  };
  return (
    <svg
      className={`wheel${spinning ? ' spinning' : ''}`}
      viewBox="-104 -114 208 222"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <circle r={R + 10} className="wheel-rim" />
      <circle r={R + 4.5} className="wheel-rim-in" />
      <g className="wheel-disc">
        {parts.map((p) => {
          const mid = p.from + p.span / 2;
          const [ix, iy] = polar(mid, R * 0.66);
          const k = p.span >= 40 ? 0.3 : p.span >= 24 ? 0.25 : 0.17;
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
                <g transform={`translate(${round(ix)} ${round(iy)}) scale(${k})`}>
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
        {hit ? <path d={slice(hit.from, hit.to, R)} className="seg-hit-ring" /> : null}
      </g>
      <circle r="14" className="wheel-hub" />
      <path d="M0-5L5 0L0 5L-5 0Z" className="wheel-hub-mark" />
      <path d={`M-14 ${-R - 24}H14L0 ${-R + 10}Z`} className="wheel-pointer" />
    </svg>
  );
}
