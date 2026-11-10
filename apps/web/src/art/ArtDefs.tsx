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
  | 'house'
  | 'tower'
  | 'waves'
  | 'sea'
  | 'castle'
  | 'shield'
  | 'swords'
  | 'emblem-0'
  | 'emblem-1'
  | 'emblem-2';

export function symbolRef(prefix: string, id: SymbolId): string {
  return `#${prefix}-${id}`;
}

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
      <symbol id={id('house')} viewBox={BOX}>
        <path d="M-22 2V36H22V2Z" className="art-ink art-land" strokeWidth="5" />
        <path
          d="M-30 6L0-30L30 6Z"
          className="art-ink art-roof"
          strokeWidth="5"
          strokeLinejoin="round"
        />
        <path d="M-6 36V18H6V36" className="art-ink" strokeWidth="4" />
      </symbol>
      <symbol id={id('tower')} viewBox={BOX}>
        <path d="M-14-22V42H14V-22Z" className="art-ink art-stone" strokeWidth="5" />
        <path
          d="M-19-22V-36H-11V-29H-4V-36H4V-29H11V-36H19V-22Z"
          className="art-ink art-stone"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />
        <path d="M-4 0V-10H4V0" className="art-ink" strokeWidth="4" />
        <path d="M0-36V-50L14-45L0-40" className="art-ink art-roof" strokeWidth="3.5" />
      </symbol>
      <symbol id={id('waves')} viewBox={BOX}>
        <path
          d="M-44-6C-30-18-16 6 0-6S30-18 44-6M-44 14C-30 2-16 26 0 14S30 2 44 14"
          className="art-water-ink"
          strokeWidth="5"
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
      <symbol id={id('shield')} viewBox={BOX}>
        <path
          d="M-34-38H34V-4C34 20 14 36 0 46C-14 36-34 20-34-4Z"
          strokeWidth="7"
          strokeLinejoin="round"
        />
      </symbol>
      <symbol id={id('swords')} viewBox={BOX}>
        <g className="art-ink art-steel" strokeWidth="4" strokeLinejoin="round">
          <path d="M-38-42L-30-44L22 8L16 14L-36-34Z" />
          <path d="M38-42L30-44L-22 8L-16 14L36-34Z" />
          <path d="M8 6L26 24M-8 6L-26 24" strokeWidth="7" />
          <path
            d="M20 22L34 36L38 32L24 18Z M-20 22L-34 36L-38 32L-24 18Z"
            className="art-ink art-roof"
          />
        </g>
      </symbol>
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
