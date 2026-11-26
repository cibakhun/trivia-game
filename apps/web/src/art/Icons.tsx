import type { ReactNode } from 'react';

/**
 * Kleine Tuschezeichnungen für Überschriften und Siegel (eigene Zeichnungen, docs/ASSETS.md): Banner
 * für eine neue Partie, Schlüssel zum Beitreten, Übungsscheibe für die Übungspartie, Schriftrolle für
 * die Chronik, dazu Fragezeichen („So geht's“), Spielen, Person (Konto) und Pfeile. Rein dekorativ.
 */
export type IconKind =
  | 'banner'
  | 'key'
  | 'target'
  | 'scroll'
  | 'help'
  | 'play'
  | 'person'
  | 'back'
  | 'next'
  | 'quill'
  | 'lock'
  | 'door'
  | 'dice'
  | 'shield'
  | 'mail'
  | 'flag';

const PATHS: Record<IconKind, ReactNode> = {
  banner: (
    <>
      <path d="M-26-44V46" className="icon-ink" strokeWidth="6" />
      <path d="M-24-40H34L22-22L34-4H-24Z" className="icon-fill icon-ink" strokeWidth="5" />
      <circle cx="-26" cy="-46" r="5" className="icon-gold icon-ink" strokeWidth="3" />
    </>
  ),
  key: (
    <>
      <circle cx="-18" cy="-16" r="20" className="icon-gold icon-ink" strokeWidth="6" />
      <circle cx="-18" cy="-16" r="7" className="icon-paper icon-ink" strokeWidth="4" />
      <path d="M-4-2L36 38M18 20L28 10M26 28L34 20" className="icon-ink" strokeWidth="7" />
    </>
  ),
  target: (
    <>
      <circle r="38" className="icon-paper icon-ink" strokeWidth="5" />
      <circle r="25" className="icon-fill icon-ink" strokeWidth="4" />
      <circle r="11" className="icon-gold icon-ink" strokeWidth="4" />
      <path d="M8-8L40-40M30-42L42-42L42-30" className="icon-ink" strokeWidth="5" />
    </>
  ),
  scroll: (
    <>
      <path
        d="M-30-34H26C34-34 34-20 26-20H-30Z M-30-34C-40-34-40-20-30-20V36H26V-20"
        className="icon-paper icon-ink"
        strokeWidth="5"
      />
      <path d="M-18-6H14M-18 8H14M-18 22H4" className="icon-ink" strokeWidth="4" />
    </>
  ),
  help: (
    <>
      <circle r="38" className="icon-paper icon-ink" strokeWidth="5" />
      <path d="M-14-12C-14-28 14-30 14-12C14 0 0 0 0 14" className="icon-ink" strokeWidth="8" />
      <circle cy="28" r="5" className="icon-ink icon-dot" strokeWidth="2" />
    </>
  ),
  play: <path d="M-18-30L30 0L-18 30Z" className="icon-ink icon-dot" strokeWidth="6" />,
  person: (
    <>
      <circle cy="-16" r="18" className="icon-paper icon-ink" strokeWidth="6" />
      <path
        d="M-34 40C-34 14-20 6 0 6C20 6 34 14 34 40Z"
        className="icon-paper icon-ink"
        strokeWidth="6"
      />
    </>
  ),
  back: <path d="M14-30L-18 0L14 30" className="icon-ink" strokeWidth="11" />,
  next: <path d="M-8-26L18 0L-8 26" className="icon-ink" strokeWidth="11" />,
  quill: (
    <>
      <path
        d="M36-42C8-34-16-8-26 24L-28 34L-16 26C16 14 36-10 40-38Z"
        className="icon-paper icon-ink"
        strokeWidth="5"
      />
      <path d="M-24 28L14-18M-30 40L-36 46" className="icon-ink" strokeWidth="5" />
    </>
  ),
  lock: (
    <>
      <path d="M-17-8V-20C-17-42 17-42 17-20V-8" className="icon-ink" strokeWidth="8" />
      <rect
        x="-30"
        y="-10"
        width="60"
        height="48"
        rx="9"
        className="icon-gold icon-ink"
        strokeWidth="6"
      />
      <path d="M0 6V20" className="icon-ink" strokeWidth="8" />
    </>
  ),
  door: (
    <>
      <path d="M-6-40H-34V40H-6" className="icon-ink" strokeWidth="7" />
      <path d="M-14 0H34M18-16L34 0L18 16" className="icon-ink" strokeWidth="8" />
    </>
  ),
  dice: (
    <>
      <rect
        x="-34"
        y="-34"
        width="68"
        height="68"
        rx="14"
        className="icon-paper icon-ink"
        strokeWidth="6"
      />
      <circle cx="-14" cy="-14" r="6" className="icon-dot" />
      <circle r="6" className="icon-dot" />
      <circle cx="14" cy="14" r="6" className="icon-dot" />
    </>
  ),
  shield: (
    <>
      <path
        d="M-32-38H32V-4C32 18 14 32 0 40C-14 32-32 18-32-4Z"
        className="icon-gold icon-ink"
        strokeWidth="6"
      />
      <path d="M-14 0L-3 11L16-12" className="icon-ink" strokeWidth="8" />
    </>
  ),
  mail: (
    <>
      <rect
        x="-38"
        y="-26"
        width="76"
        height="52"
        rx="7"
        className="icon-paper icon-ink"
        strokeWidth="6"
      />
      <path d="M-34-21L0 6L34-21" className="icon-ink" strokeWidth="6" />
    </>
  ),
  flag: (
    <>
      <path d="M-26-42V44" className="icon-ink" strokeWidth="7" />
      <path
        d="M-24-38C-6-46 8-28 32-36V4C8 12-6-6-24 2Z"
        className="icon-fill icon-ink"
        strokeWidth="5"
      />
    </>
  ),
};

export function Icon({ kind, size = 30 }: { readonly kind: IconKind; readonly size?: number }) {
  return (
    <svg
      className={`icon icon-${kind}`}
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[kind]}
    </svg>
  );
}
