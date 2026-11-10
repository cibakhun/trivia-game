/**
 * Wappenschild eines Sitzes: Sitzfarbe mit weißem Wappenbild (◆ ● ▲), dieselben Formen wie auf der
 * Karte. Rein dekorativ; der Name steht immer daneben.
 */

const EMBLEMS = [
  <path key="0" d="M0-40L30 0L0 40L-30 0Z" />,
  <circle key="1" r="30" />,
  <path key="2" d="M0-36L36 30H-36Z" />,
] as const;

export function SeatCrest({ seat, size = 28 }: { readonly seat: number; readonly size?: number }) {
  return (
    <svg
      className={`crest seat-${seat}`}
      viewBox="-50 -52 100 104"
      width={size}
      height={size * 1.04}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="crest-shield"
        d="M-42-46H42V-4C42 24 18 40 0 50C-18 40-42 24-42-4Z"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <path className="crest-shine" d="M-34-38H34V-28H-34Z" />
      <g className="crest-emblem" transform="translate(0 -2) scale(0.62)">
        {EMBLEMS[seat] ?? null}
      </g>
    </svg>
  );
}
