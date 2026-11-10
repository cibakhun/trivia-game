import type { ReactNode } from 'react';

/**
 * Kleine Tuschezeichnungen für Überschriften (eigene Zeichnungen, docs/ASSETS.md): Banner für eine
 * neue Partie, Schlüssel zum Beitreten, Übungsscheibe für die Testpartie, Schriftrolle für den
 * Verlauf. Rein dekorativ.
 */
export type IconKind = 'banner' | 'key' | 'target' | 'scroll';

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
