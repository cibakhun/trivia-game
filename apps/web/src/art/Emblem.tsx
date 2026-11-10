/**
 * Wappen von „Reiche des Wissens“: Schild mit aufgeschlagenem Buch unter einer Krone (eigene
 * Zeichnung, docs/ASSETS.md). Rein dekorativ.
 */
export function Emblem({ size = 96 }: { readonly size?: number }) {
  return (
    <svg
      className="emblem"
      viewBox="-60 -70 120 132"
      width={size}
      height={(size * 132) / 120}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="emblem-crown"
        d="M-24-40L-29-62L-13-51L0-67L13-51L29-62L24-40Z"
        strokeLinejoin="round"
      />
      <circle className="emblem-gem" cx="0" cy="-51" r="4" />
      <path
        className="emblem-shield"
        d="M-46-40H46V0C46 30 22 48 0 58C-22 48-46 30-46 0Z"
        strokeLinejoin="round"
      />
      <path
        className="emblem-inner"
        d="M-38-32H38V0C38 25 18 40 0 48C-18 40-38 25-38 0Z"
        strokeLinejoin="round"
      />
      <path
        className="emblem-book"
        d="M-28-8C-16-15-5-13 0-6C5-13 16-15 28-8V24C16 18 5 19 0 26C-5 19-16 18-28 24Z"
        strokeLinejoin="round"
      />
      <path
        className="emblem-lines"
        d="M0-6V26M-22-2C-14-6-8-5-5-2M-22 6C-14 2-8 3-5 6M-22 14C-14 10-8 11-5 14M5-2C8-5 14-6 22-2M5 6C8 3 14 2 22 6M5 14C8 11 14 10 22 14"
      />
    </svg>
  );
}
