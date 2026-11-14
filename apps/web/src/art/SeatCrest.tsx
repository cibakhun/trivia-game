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

/** Rand eines Tropfens Siegelwachs: rund, aber von Hand gedrückt. */
const WAX =
  'M47.9 0C48.1 6.6 45.5 15 41.6 20C37.6 25 29.2 25.5 24 30.1C18.9 34.7 16.5 45.2 10.9 47.6' +
  'C5.2 49.9-3.5 46.1-10.1 44.1C-16.6 42.1-23.3 39.7-28.4 35.7C-33.6 31.6-38.6 25.6-40.9 19.7' +
  'C-43.1 13.7-42.3 6.5-42.1 0C-41.9-6.5-41.2-12.3-39.5-19C-37.9-25.7-37.1-36.7-32.1-40.2' +
  'C-27-43.7-16.2-39.6-9.2-40.2C-2.2-40.8 3.8-44.6 10-43.6C16.1-42.7 22.6-38.7 27.7-34.7' +
  'C32.7-30.6 36.9-25.2 40.2-19.4C43.6-13.6 47.7-6.6 47.9 0Z';

/**
 * Wachssiegel eines Sitzes: ein Tropfen Wachs in der Sitzfarbe, das Wappenbild hineingedrückt.
 * Steht für „abgegeben und verschlossen“ (Befehle der Rüstzeit). Rein dekorativ; Größe und Lage
 * kommen aus dem Stylesheet (`.seal-spot`).
 */
export function SeatSeal({ seat }: { readonly seat: number }) {
  return (
    <span className="seal-spot" style={{ ['--seal' as string]: `var(--seat-${seat})` }}>
      <svg className="seal" viewBox="-50 -52 108 112" aria-hidden="true" focusable="false">
        <path className="seal-shadow" d={WAX} transform="translate(2.5 5)" />
        <path className="seal-wax" d={WAX} strokeWidth="5" strokeLinejoin="round" />
        <circle className="seal-press" cx="3" cy="2" r="28" strokeWidth="3.5" />
        <path className="seal-shine" d="M-31-13C-28-24-19-32-7-34" strokeWidth="5" />
        <g className="seal-emblem" transform="translate(3 2) scale(0.46)">
          {EMBLEMS[seat] ?? null}
        </g>
      </svg>
    </span>
  );
}
