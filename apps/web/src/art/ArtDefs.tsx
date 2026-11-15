/**
 * Gezeichnete Motive der Karte als SVG-Symbole (eigene Zeichnungen, keine fremden Vorlagen,
 * docs/ASSETS.md). Jedes Symbol liegt in einem Kasten von 100 × 100 um den Mittelpunkt; Farben
 * kommen aus CSS-Variablen (`--map-*`, `--flag`), damit Tag- und Nachtkarte dieselben Symbole
 * nutzen. `prefix` macht die IDs je Karte eindeutig.
 */

const BOX = '-50 -50 100 100';

export type SymbolId =
  | 'tree'
  | 'pine'
  | 'mountain'
  | 'hill'
  | 'wheat'
  | 'grass'
  | 'reeds'
  | 'lake'
  | 'waves'
  | 'bush'
  | 'rocks'
  | 'flowers'
  | 'hay'
  | 'sea'
  | 'castle'
  | 'village'
  | 'town'
  | 'pennant'
  | 'bearer'
  | 'shield'
  | 'emblem-0'
  | 'emblem-1'
  | 'emblem-2';

export function symbolRef(prefix: string, id: SymbolId): string {
  return `#${prefix}-${id}`;
}

/**
 * Bruchlinien für Bewegung (ADR-067): Ein Motiv zerfällt in Stücke, indem es mehrmals gezeichnet
 * und je Stück entlang einer gezackten Linie beschnitten wird. Die Linien sind relativ zum Motiv
 * (`objectBoundingBox`) und reichen über seinen Rand hinaus, damit der Strich mitkommt.
 */
export type CrackId =
  /** Gebäude in drei Streifen: links, Mitte, rechts. */
  | 'crack-0'
  | 'crack-1'
  | 'crack-2'
  /** Burg in drei Teilen: linker Turm, Bergfried, rechter Turm. */
  | 'tower-0'
  | 'tower-1'
  | 'tower-2'
  /** Schild in zwei Hälften. */
  | 'half-0'
  | 'half-1';

export function crackRef(prefix: string, id: CrackId): string {
  return `url(#${prefix}-${id})`;
}

type Seam = readonly (readonly [number, number])[];

/** Gezackte Linie von oben nach unten (x je Höhe 0 … 1), über den Rand hinaus verlängert. */
function seam(points: Seam): Seam {
  return [[points[0]![0], -0.3], ...points, [points[points.length - 1]![0], 1.3]];
}

/** Fläche zwischen zwei Linien; `null` ist der Rand links oder rechts, weit außerhalb des Motivs. */
function strip(left: Seam | null, right: Seam | null): string {
  const a = left ?? seam([[-0.3, 0]]);
  const b = right ?? seam([[1.3, 0]]);
  const points = [...a, ...[...b].reverse()];
  return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}

const BUILDING_SEAMS = [
  seam([
    [0.37, 0],
    [0.31, 0.2],
    [0.4, 0.38],
    [0.33, 0.6],
    [0.41, 0.8],
    [0.36, 1],
  ]),
  seam([
    [0.65, 0],
    [0.71, 0.17],
    [0.62, 0.36],
    [0.7, 0.57],
    [0.63, 0.78],
    [0.69, 1],
  ]),
] as const;
const TOWER_SEAMS = [
  seam([
    [0.255, 0],
    [0.255, 0.34],
    [0.21, 0.5],
    [0.275, 0.68],
    [0.22, 0.85],
    [0.25, 1],
  ]),
  seam([
    [0.745, 0],
    [0.745, 0.3],
    [0.79, 0.46],
    [0.725, 0.64],
    [0.78, 0.83],
    [0.75, 1],
  ]),
] as const;
const SHIELD_SEAM = seam([
  [0.5, 0],
  [0.44, 0.22],
  [0.57, 0.42],
  [0.46, 0.63],
  [0.54, 0.82],
  [0.5, 1],
]);

const CRACKS: Readonly<Record<CrackId, string>> = {
  'crack-0': strip(null, BUILDING_SEAMS[0]),
  'crack-1': strip(BUILDING_SEAMS[0], BUILDING_SEAMS[1]),
  'crack-2': strip(BUILDING_SEAMS[1], null),
  'tower-0': strip(null, TOWER_SEAMS[0]),
  'tower-1': strip(TOWER_SEAMS[0], TOWER_SEAMS[1]),
  'tower-2': strip(TOWER_SEAMS[1], null),
  'half-0': strip(null, SHIELD_SEAM),
  'half-1': strip(SHIELD_SEAM, null),
};

export function ArtDefs({ prefix }: { readonly prefix: string }) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <defs>
      {/* Papier: feines Rauschen, nur als Überzug mit geringer Deckkraft */}
      <filter id={id('paper')} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" />
        <feColorMatrix
          values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.55 -0.12"
          result="grain"
        />
        <feComposite in="grain" in2="SourceGraphic" operator="in" />
      </filter>
      <filter id={id('soft')} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="3" />
      </filter>

      {/* Wappenmuster je Sitz, zusätzlich zur Farbe */}
      <pattern
        id={id('pattern-0')}
        patternUnits="userSpaceOnUse"
        width="9"
        height="9"
        patternTransform="rotate(40)"
      >
        <line x1="0" y1="0" x2="0" y2="9" className="pattern-line" strokeWidth="2.2" />
      </pattern>
      <pattern id={id('pattern-1')} patternUnits="userSpaceOnUse" width="11" height="11">
        <circle cx="3" cy="3" r="1.7" className="pattern-dot" />
        <circle cx="8.5" cy="8.5" r="1.7" className="pattern-dot" />
      </pattern>
      <pattern
        id={id('pattern-2')}
        patternUnits="userSpaceOnUse"
        width="10"
        height="10"
        patternTransform="rotate(45)"
      >
        <path d="M0 5H10M5 0V10" className="pattern-line" strokeWidth="1.5" />
      </pattern>

      <symbol id={id('tree')} viewBox={BOX}>
        <path d="M0 10V44" className="art-ink" strokeWidth="6" />
        <path
          d="M-30 10C-44-4-32-30-12-28C-8-46 16-46 22-30C40-28 44-6 30 10C24 22-22 22-30 10Z"
          className="art-ink art-leaf"
          strokeWidth="5"
        />
        <path d="M10-14C16-12 20-6 20 0M2 4C8 6 14 4 18 0" className="art-ink" strokeWidth="3.5" />
      </symbol>
      <symbol id={id('pine')} viewBox={BOX}>
        <path d="M0 30V46" className="art-ink" strokeWidth="6" />
        <path
          d="M0-46L-14-18H-6L-24 8H-10L-30 32H30L10 8H24L6-18H14Z"
          className="art-ink art-pine"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="M4-10L10-2M6 16L14 26" className="art-ink" strokeWidth="3.5" />
      </symbol>
      <symbol id={id('mountain')} viewBox={BOX}>
        <path
          d="M-48 36L-8-40L48 36Z"
          className="art-ink art-stone"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="M-8-40L48 36H10L2 4L8-6Z" className="art-shade" />
        <path d="M-8-40L-20-16L-11-20L-5-12L2-22L6-18Z" className="art-snow ink" strokeWidth="3" />
        <path d="M14 8L22 20M22 0L32 16M8 20L14 32" className="art-ink" strokeWidth="3" />
      </symbol>
      <symbol id={id('hill')} viewBox={BOX}>
        <path d="M-48 30C-34-18 30-18 48 30Z" className="art-ink art-leaf" strokeWidth="5" />
        <path
          d="M12-4C20 2 26 12 28 22M2 2C8 8 12 16 12 24"
          className="art-ink"
          strokeWidth="3.5"
        />
      </symbol>
      <symbol id={id('wheat')} viewBox={BOX}>
        <path
          d="M-44 26L-22-14H44L22 26Z"
          className="art-ink art-wheat"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <path
          d="M-32 26L-10-14M-18 26L4-14M-4 26L18-14M10 26L32-14"
          className="art-ink"
          strokeWidth="2.5"
        />
      </symbol>
      <symbol id={id('grass')} viewBox={BOX}>
        <path
          d="M-26 24C-28 10-34 2-40-4M-14 24C-14 6-18-6-20-18M-2 24C0 6 4-8 10-20M12 24C16 12 22 4 30-2M24 24C28 18 34 14 40 12"
          className="art-ink"
          strokeWidth="5"
        />
      </symbol>
      <symbol id={id('reeds')} viewBox={BOX}>
        <path
          d="M-40 34C-26 28-14 40 0 34S26 28 40 34"
          className="art-water-ink"
          strokeWidth="4.5"
        />
        <path
          d="M-18 28V-16M0 28V-28M18 28V-8M-30 28C-30 10-34 0-40-6M30 28C30 14 34 4 40 0"
          className="art-ink"
          strokeWidth="4"
        />
        <rect
          x="-23"
          y="-24"
          width="10"
          height="20"
          rx="5"
          className="art-ink art-reed"
          strokeWidth="3"
        />
        <rect
          x="-5"
          y="-38"
          width="10"
          height="20"
          rx="5"
          className="art-ink art-reed"
          strokeWidth="3"
        />
        <rect
          x="13"
          y="-18"
          width="10"
          height="18"
          rx="5"
          className="art-ink art-reed"
          strokeWidth="3"
        />
      </symbol>
      <symbol id={id('lake')} viewBox={BOX}>
        <path
          d="M-44 4C-46-14-24-26-2-24C22-26 46-16 44 2C46 20 22 28 0 26C-24 28-42 20-44 4Z"
          className="art-ink art-water"
          strokeWidth="3.5"
        />
        <path
          d="M-24-4C-18-8-12-8-6-4M6 10C12 6 18 6 24 10M-6 16C-2 13 2 13 6 16"
          className="art-water-ink"
          strokeWidth="3"
        />
      </symbol>
      <symbol id={id('waves')} viewBox={BOX}>
        <path
          d="M-44-6C-30-18-16 6 0-6S30-18 44-6M-44 14C-30 2-16 26 0 14S30 2 44 14"
          className="art-water-ink"
          strokeWidth="5"
        />
      </symbol>
      {/* Bodenmotive: Busch, Felsen, Blumen, Heuschober */}
      <symbol id={id('bush')} viewBox={BOX}>
        <path
          d="M-36 24C-48 10-36-10-20-8C-16-26 12-28 18-10C36-12 46 8 36 24Z"
          className="art-ink art-leaf"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="M-8 4C-2 8 8 8 14 2M-22 12C-18 15-12 15-8 12"
          className="art-ink"
          strokeWidth="3.5"
        />
      </symbol>
      <symbol id={id('rocks')} viewBox={BOX}>
        <path
          d="M-42 26L-28-8L-6-14L10 26Z"
          className="art-ink art-stone"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="M-6-14L10 26H-6L-12 0Z" className="art-shade" />
        <path
          d="M6 26L18 2L34 6L44 26Z"
          className="art-ink art-stone"
          strokeWidth="5"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id={id('flowers')} viewBox={BOX}>
        <path
          d="M-24 30C-24 14-28 6-32-4M0 30C0 12 2 0 6-12M24 30C24 18 28 10 34 4M-12 30C-12 24-14 20-18 16M12 30C12 24 14 20 18 18"
          className="art-ink"
          strokeWidth="4"
        />
        <circle cx="-32" cy="-8" r="8" className="art-ink art-snow" strokeWidth="3.5" />
        <circle cx="6" cy="-16" r="9" className="art-ink art-wheat" strokeWidth="3.5" />
        <circle cx="34" cy="0" r="8" className="art-ink art-roof" strokeWidth="3.5" />
      </symbol>
      <symbol id={id('hay')} viewBox={BOX}>
        <path d="M0-30V-44" className="art-ink" strokeWidth="4.5" />
        <path
          d="M-34 30C-34-2-20-30 0-30C20-30 34-2 34 30Z"
          className="art-ink art-wheat"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="M-14 30C-12 10-8-6 0-18M10 30C10 14 8 2 4-8M-24 30C-22 18-20 10-16 2M22 30C22 20 20 12 16 4"
          className="art-ink"
          strokeWidth="3"
        />
      </symbol>
      <symbol id={id('sea')} viewBox={BOX}>
        <path
          d="M-44 2C-34-8-24-8-14 2S6 12 16 2S36-8 44 0"
          className="art-sea-ink"
          strokeWidth="5"
        />
      </symbol>

      {/* Burg der Hauptstadt: Fahne in Sitzfarbe über `--flag` */}
      <symbol id={id('castle')} viewBox={BOX}>
        <path
          d="M0-34V-50L22-44L0-38Z"
          className="art-ink art-flag"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <path
          d="M-42 40V-6H-46V-20H-38V-14H-30V-20H-22V-6H-26V40Z M26 40V-6H22V-20H30V-14H38V-20H46V-6H42V40Z"
          className="art-ink art-stone"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path
          d="M-26 40V2H-14V-34H-6V-28H6V-34H14V2H26V40Z"
          className="art-ink art-stone"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M-10 40V24C-10 14 10 14 10 24V40" className="art-ink art-gate" strokeWidth="4" />
        <path d="M-4-16V-6M4-16V-6M-36 6V14M36 6V14" className="art-ink" strokeWidth="3.5" />
      </symbol>
      {/* Partie mit Ausbau: Dorf (zwei Häuser) und Stadt (Mauer, Dächer, Turm), Fahne in Sitzfarbe */}
      <symbol id={id('village')} viewBox={BOX}>
        <path d="M-4-22V-50" className="art-ink" strokeWidth="4" />
        <path
          d="M-4-50L26-41L-4-32Z"
          className="art-ink art-flag"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M-16-4V22H12V-4Z" className="art-ink art-land" strokeWidth="4.5" />
        <path
          d="M-23-2L-2-26L19-2Z"
          className="art-ink art-roof"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <path d="M-44 16V40H-12V16Z" className="art-ink art-land" strokeWidth="4.5" />
        <path
          d="M-51 18L-28-8L-5 18Z"
          className="art-ink art-roof"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <path d="M6 22V40H40V22Z" className="art-ink art-land" strokeWidth="4.5" />
        <path
          d="M-1 24L23-2L47 24Z"
          className="art-ink art-roof"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <path
          d="M18 40V30H28V40M-32 40V30H-24V40M-5 6H1V12H-5Z"
          className="art-ink"
          strokeWidth="3.5"
        />
      </symbol>
      <symbol id={id('town')} viewBox={BOX}>
        <path
          d="M-2-34V-50L24-43L-2-36"
          className="art-ink art-flag"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <path d="M-12-18V14H8V-18Z" className="art-ink art-stone" strokeWidth="4" />
        <path
          d="M-17-16L-2-36L13-16Z M-46 12L-32-8L-18 12Z M14 12L30-10L46 12Z"
          className="art-ink art-roof"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path
          d="M-48 40V10H-40V16H-30V10H-20V16H-10V10H10V16H20V10H30V16H40V10H48V40Z"
          className="art-ink art-stone"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M-9 40V28C-9 18 9 18 9 28V40" className="art-ink art-gate" strokeWidth="4" />
        <path d="M-2-6V2M-34 22V30M34 22V30M-24-2V4M24-2V4" className="art-ink" strokeWidth="3.5" />
      </symbol>
      {/* Banner: Armeen auf einem Feld, Tuch in Sitzfarbe, die Zahl steht darauf */}
      <symbol id={id('pennant')} viewBox={BOX}>
        <path
          d="M-30-36H30V34L0 16L-30 34Z"
          className="art-ink art-flag"
          strokeWidth="7"
          strokeLinejoin="round"
        />
        <path d="M-40-38H40" className="art-ink" strokeWidth="10" />
      </symbol>
      {/* Bannerträger: eine Armee als Figur mit Fahne, Tuch und Rock in Sitzfarbe, die Zahl steht auf dem Tuch */}
      <symbol id={id('bearer')} viewBox={BOX}>
        <path d="M-4-48V46" className="art-ink" strokeWidth="6" />
        <path
          d="M-4-44H46V6L21-8L-4 6Z"
          className="art-ink art-flag"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path
          d="M-46 46V32C-46 16-8 16-8 32V46Z"
          className="art-ink art-flag"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <circle cx="-27" cy="2" r="12" className="art-ink art-steel" strokeWidth="5" />
        <path d="M-37 1H-17" className="art-ink" strokeWidth="3.5" />
      </symbol>
      <symbol id={id('shield')} viewBox={BOX}>
        <path
          d="M-34-38H34V-4C34 20 14 36 0 46C-14 36-34 20-34-4Z"
          strokeWidth="7"
          strokeLinejoin="round"
        />
      </symbol>
      {(Object.keys(CRACKS) as CrackId[]).map((crack) => (
        <clipPath key={crack} id={id(crack)} clipPathUnits="objectBoundingBox">
          <path d={CRACKS[crack]} />
        </clipPath>
      ))}
      {/* Staub, der am Fuß aufwirbelt: weich auslaufend, eine Form statt eines Filters (WebKit) */}
      <radialGradient id={id('puff')}>
        <stop offset="0.2" className="puff-in" />
        <stop offset="1" className="puff-out" />
      </radialGradient>
      {/* Wappenbilder der Sitze, wie die Zeichen ◆ ● ▲ */}
      <symbol id={id('emblem-0')} viewBox={BOX}>
        <path d="M0-40L30 0L0 40L-30 0Z" />
      </symbol>
      <symbol id={id('emblem-1')} viewBox={BOX}>
        <circle r="32" />
      </symbol>
      <symbol id={id('emblem-2')} viewBox={BOX}>
        <path d="M0-38L38 32H-38Z" />
      </symbol>
    </defs>
  );
}
