import type { QuestionCategory } from '@rdw/protocol';
import type { ReactNode } from 'react';

/**
 * Tuschezeichen der Partie mit Ausbau (eigene Zeichnungen, docs/ASSETS.md): je Kategorie des
 * Glücksrads eines, dazu Brot, Baustoff, Armee, Gebäude, Tausch und Zug. Jedes liegt im Kasten
 * 100 × 100 um den Mittelpunkt; Farben kommen aus `realm.css` (`.glyph`, `.g-*`).
 */

export const CATEGORY_GLYPH: Readonly<Record<QuestionCategory, ReactNode>> = {
  HISTORY: (
    <>
      <path d="M-24-38H24M-24 38H24" strokeWidth="7" />
      <path d="M-18-38C-18-8 18 8 18 38M18-38C18-8-18 8-18 38" strokeWidth="6" />
      <path d="M-10 30C-6 20 6 20 10 30Z" className="g-fill" strokeWidth="3" />
    </>
  ),
  GEOGRAPHY: (
    <>
      <circle r="36" strokeWidth="6" />
      <ellipse rx="15" ry="36" strokeWidth="5" />
      <path d="M-36 0H36M-30-19H30M-30 19H30" strokeWidth="5" />
    </>
  ),
  SCIENCE: (
    <>
      <path
        d="M-12-40H12M-7-40V-10L-30 28C-34 36-30 40-22 40H22C30 40 34 36 30 28L7-10V-40"
        strokeWidth="6"
      />
      <path d="M-20 14H20L27 30C29 35 27 36 22 36H-22C-27 36-29 35-27 30Z" className="g-fill" />
    </>
  ),
  TECHNOLOGY: (
    <>
      <circle r="24" strokeWidth="6" />
      <circle r="9" strokeWidth="5" className="g-fill" />
      <path
        d="M0-24V-40M0 24V40M-24 0H-40M24 0H40M-17-17L-28-28M17 17L28 28M-17 17L-28 28M17-17L28-28"
        strokeWidth="9"
      />
    </>
  ),
  MATHEMATICS: (
    <>
      <path d="M-30-22H32" strokeWidth="8" />
      <path d="M-12-22V26C-12 34-20 36-26 32" strokeWidth="7" />
      <path d="M16-22V24C16 34 26 36 32 30" strokeWidth="7" />
    </>
  ),
  LITERATURE: (
    <>
      <path
        d="M0-22C-12-32-30-32-40-26V28C-30 22-12 22 0 32C12 22 30 22 40 28V-26C30-32 12-32 0-22Z"
        strokeWidth="6"
        className="g-paper"
      />
      <path d="M0-22V32M-28-10H-12M-28 4H-12M12-10H28M12 4H28" strokeWidth="4.5" />
    </>
  ),
  ARTS_CULTURE: (
    <>
      <path
        d="M0-38C-30-38-42-14-38 8C-34 30-10 40 8 36C18 34 10 22 18 15C28 7 42 10 40-8C38-26 22-38 0-38Z"
        strokeWidth="6"
        className="g-paper"
      />
      <circle cx="-18" cy="-14" r="6.5" className="g-fill" strokeWidth="3" />
      <circle cx="4" cy="-22" r="6.5" className="g-gold" strokeWidth="3" />
      <circle cx="-20" cy="10" r="6.5" className="g-ink" strokeWidth="3" />
    </>
  ),
  SPORTS: (
    <>
      <path
        d="M-20-36H20V-12C20 6 8 14 0 14C-8 14-20 6-20-12Z"
        strokeWidth="6"
        className="g-gold"
      />
      <path d="M-20-28H-36C-36-10-28-4-18-4M20-28H36C36-10 28-4 18-4" strokeWidth="5" />
      <path d="M0 14V28M-18 38H18V28H-18Z" strokeWidth="6" />
    </>
  ),
  POLITICS_SOCIETY: (
    <>
      <path d="M0-40V34M-22 38H22M-32-28H32" strokeWidth="6" />
      <path d="M-32-28L-44 4H-20ZM32-28L20 4H44Z" strokeWidth="5" className="g-fill" />
    </>
  ),
  NATURE_ANIMALS: (
    <>
      <path d="M-32 36C-40-8-8-40 36-36C40 8 8 40-32 36Z" strokeWidth="6" className="g-leaf" />
      <path d="M-32 36L16-14M-8 12V-8M-8 12H12" strokeWidth="4.5" />
    </>
  ),
  GENERAL: (
    <>
      <path
        d="M0-42L11-11L42 0L11 11L0 42L-11 11L-42 0L-11-11Z"
        strokeWidth="6"
        className="g-gold"
      />
      <circle r="6" className="g-ink" strokeWidth="2" />
    </>
  ),
};

export function CategoryIcon({
  category,
  size = 22,
}: {
  readonly category: QuestionCategory;
  readonly size?: number;
}) {
  return (
    <svg
      className="glyph"
      viewBox="-50 -50 100 100"
      style={{ width: `calc(${size} * var(--u, 1px))`, height: `calc(${size} * var(--u, 1px))` }}
      aria-hidden="true"
      focusable="false"
    >
      {CATEGORY_GLYPH[category]}
    </svg>
  );
}

export type Mark = 'bread' | 'material' | 'army' | 'village' | 'town' | 'castle' | 'trade' | 'move';

const MARKS: Readonly<Record<Mark, ReactNode>> = {
  bread: (
    <>
      <path
        d="M-40 8C-40-20-20-30 0-30C20-30 40-20 40 8C40 24 30 30 0 30C-30 30-40 24-40 8Z"
        strokeWidth="6"
        className="g-bread"
      />
      <path d="M-18-16L-10 2M0-20L8-2M18-16L26 2" strokeWidth="5" />
    </>
  ),
  material: (
    <>
      <path d="M-40 8H40V34H-40Z" strokeWidth="6" className="g-stone" />
      <path d="M-24-22H24V8H-24Z" strokeWidth="6" className="g-wood" />
      <path d="M0 8V34M-24-8H24" strokeWidth="4.5" />
    </>
  ),
  army: (
    <>
      <path d="M-26-44V46" strokeWidth="8" />
      <path d="M-23-40H38L22-20L38 0H-23Z" strokeWidth="6" className="g-flag" />
    </>
  ),
  village: (
    <>
      <path d="M-40 10V38H-8V10Z" strokeWidth="5" className="g-paper" />
      <path d="M-47 13L-24-14L-1 13Z" strokeWidth="5" className="g-roof" />
      <path d="M2 18V38H36V18Z" strokeWidth="5" className="g-paper" />
      <path d="M-5 21L19-4L43 21Z" strokeWidth="5" className="g-roof" />
    </>
  ),
  town: (
    <>
      <path d="M-12-18V14H8V-18Z" strokeWidth="5" className="g-stone" />
      <path d="M-17-16L-2-36L13-16Z" strokeWidth="5" className="g-roof" />
      <path d="M-46 12L-32-8L-18 12ZM14 12L30-10L46 12Z" strokeWidth="5" className="g-roof" />
      <path
        d="M-48 40V10H-40V16H-30V10H-20V16H-10V10H10V16H20V10H30V16H40V10H48V40Z"
        strokeWidth="5"
        className="g-stone"
      />
    </>
  ),
  castle: (
    <>
      <path
        d="M-42 40V-6H-46V-20H-38V-14H-30V-20H-22V-6H-26V40ZM26 40V-6H22V-20H30V-14H38V-20H46V-6H42V40Z"
        strokeWidth="5"
        className="g-stone"
      />
      <path d="M-26 40V2H-14V-34H-6V-28H6V-34H14V2H26V40Z" strokeWidth="5" className="g-stone" />
      <path d="M-10 40V24C-10 14 10 14 10 24V40" strokeWidth="5" className="g-ink" />
    </>
  ),
  trade: (
    <>
      <path d="M-34-14H30M16-30L32-14L16 2" strokeWidth="7" />
      <path d="M34 16H-30M-16 0L-32 16L-16 32" strokeWidth="7" />
    </>
  ),
  move: (
    <>
      <path d="M-38 22C-30-14 2-22 30-12" strokeWidth="8" />
      <path d="M12-32L34-11L8 6" strokeWidth="8" />
    </>
  ),
};

export function MarkIcon({ kind, size = 20 }: { readonly kind: Mark; readonly size?: number }) {
  return (
    <svg
      className={`glyph glyph-${kind}`}
      viewBox="-50 -50 100 100"
      style={{ width: `calc(${size} * var(--u, 1px))`, height: `calc(${size} * var(--u, 1px))` }}
      aria-hidden="true"
      focusable="false"
    >
      {MARKS[kind]}
    </svg>
  );
}

/** Preis oder Vorrat: Zeichen und Zahl; `label` nennt den Rohstoff für Screenreader. */
export function Amount({
  kind,
  value,
  label,
  size = 18,
}: {
  readonly kind: 'bread' | 'material';
  readonly value: number | string;
  readonly label: string;
  readonly size?: number;
}) {
  return (
    <span className={`amount amount-${kind}`}>
      <MarkIcon kind={kind} size={size} />
      <span className="amount-value">{value}</span>
      <span className="visually-hidden"> {label}</span>
    </span>
  );
}
