/** Gekreuzte Schwerter als eigenständiges Bild (wie das Symbol auf der Karte), rein dekorativ. */
export function Swords({ size = 32 }: { readonly size?: number }) {
  return (
    <svg
      className="swords-icon"
      viewBox="-50 -50 100 100"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <g className="swords-steel" strokeWidth="4" strokeLinejoin="round">
        <path d="M-38-42L-30-44L22 8L16 14L-36-34Z" />
        <path d="M38-42L30-44L-22 8L-16 14L36-34Z" />
        <path d="M8 6L26 24M-8 6L-26 24" strokeWidth="7" />
        <path d="M20 22L34 36L38 32L24 18Z M-20 22L-34 36L-38 32L-24 18Z" className="swords-grip" />
      </g>
    </svg>
  );
}
