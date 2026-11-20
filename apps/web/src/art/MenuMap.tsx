import { WENDELMARK } from '@rdw/game-core';
import { useId, useMemo } from 'react';
import { ArtDefs, symbolRef } from './ArtDefs.tsx';
import { SCENE } from './HeroMap.tsx';
import { inkBlob, inkBox, inkOrigin, inkReach, inkStyle } from './ink.ts';
import { mapArt } from './map-art.ts';
import { seaDepth } from './stage-frame.ts';
import './map-art.css';

/** So weit reicht das Meer über den Rand der Karte hinaus (Karteneinheiten): Breite Bildschirme sehen kein Ende. */
const SEA = 3000;

/** Burgen der drei Reiche: Region und Sitz. */
const CASTLES = [
  [5, 0],
  [8, 1],
  [15, 2],
] as const;

/** Armeen: Region, Sitz und Stärke. */
const ARMIES = [
  [9, 0, 3],
  [13, 1, 2],
  [19, 2, 4],
] as const;

/**
 * Schiffe in Reichsfarben, wo neben dem Land Meer ist (Karteneinheiten); nicht ganz oben, wo am PC
 * Plakette und Werkzeuge liegen.
 */
const SHIPS = [
  { x: 680, y: 172, seat: 1, flip: false, scale: 1.1 },
  { x: 664, y: 522, seat: 2, flip: true, scale: 0.95 },
  { x: 64, y: 180, seat: 0, flip: true, scale: 1.1 },
] as const;

interface Point {
  readonly cx: number;
  readonly cy: number;
}

/**
 * Die Wendelmark als Bühne des Hauptmenüs (ADR-074): die feste Szene der drei Reiche wie im
 * Schmuckbild, dazu Burgen in Reichsfarben, Armeen mit ihrer Stärke, ein Angriff, der gerade
 * läuft, und Schiffe auf dem Meer. Rein dekorativ und nie zu tippen. Mit `cover` füllt die Karte
 * die ganze Bühne und wird dafür beschnitten. Bewegung steht in `menu.css`.
 */
export function MenuMap({
  cover = false,
  viewBox,
  life = true,
}: {
  readonly cover?: boolean;
  /** Ausschnitt der Karte; ohne Angabe die ganze Wendelmark. */
  readonly viewBox?: string;
  /** Burgen, Armeen, Angriff und Schiffe; die Bildkarten der Spielart zeichnen eigene. */
  readonly life?: boolean;
}) {
  const art = useMemo(() => mapArt(WENDELMARK), []);
  // Die Farben laufen als nasse Tinte von der Mitte ihrer Region ein (ink.ts)
  const inks = useMemo(
    () =>
      art.regions.map((region) => {
        const origin = inkOrigin(region.outline, inkBox(region.outline), {
          x: region.cx,
          y: region.cy,
        });
        return inkStyle(inkBlob(`menu:${region.id}`, origin, inkReach(origin)));
      }),
    [art],
  );
  const prefix = `menu${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const depth = seaDepth(art.viewBox) ?? { cx: art.width / 2, cy: art.height / 2, r: art.width };
  const at = (id: number): Point => art.regions[id] ?? { cx: art.width / 2, cy: art.height / 2 };
  const sea = { x: -SEA, y: -SEA, width: art.width + 2 * SEA, height: art.height + 2 * SEA };
  return (
    <svg
      className="map-art hero-map menu-map"
      viewBox={viewBox ?? art.viewBox}
      preserveAspectRatio={cover || viewBox ? 'xMidYMid slice' : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <ArtDefs prefix={prefix} />
      <defs>
        <radialGradient
          id={`${prefix}-depth`}
          gradientUnits="userSpaceOnUse"
          cx={depth.cx}
          cy={depth.cy}
          r={depth.r}
        >
          <stop offset="0.5" className="depth-near" />
          <stop offset="1" className="depth-far" />
        </radialGradient>
      </defs>
      <rect className="sea" {...sea} />
      <g className="sea-marks">
        {art.waves.map((w, i) => (
          <use
            key={i}
            href={symbolRef(prefix, 'sea')}
            x={w.x - w.size / 2}
            y={w.y - w.size / 2}
            width={w.size}
            height={w.size}
          />
        ))}
      </g>
      <rect className="sea-depth" fill={`url(#${prefix}-depth)`} {...sea} />
      <g className="coast-ripples">
        <path d={art.coast} className="ripple ripple-3" />
        <path d={art.coast} className="ripple ripple-2" />
        <path d={art.coast} className="ripple ripple-1" />
      </g>
      {art.regions.map((region) => {
        const owner = SCENE[region.id];
        return (
          <g key={region.id} className={owner === undefined ? 'free' : `seat-${owner}`}>
            <path d={region.d} className="land" />
            {owner !== undefined ? (
              <g
                className="wash ink-in"
                style={{ ...inks[region.id], animationDelay: `${0.3 + (region.id % 7) * 0.12}s` }}
              >
                <path d={region.d} className="wash-fill" />
                <path
                  d={region.d}
                  className="wash-pattern"
                  fill={`url(#${prefix}-pattern-${owner})`}
                />
              </g>
            ) : null}
          </g>
        );
      })}
      <g className="region-borders">
        {art.regions.map((region) => (
          <path key={region.id} d={region.d} />
        ))}
      </g>
      {art.river ? (
        <g className="river">
          <path d={art.river} className="river-bank" />
          <path d={art.river} className="river-water" />
        </g>
      ) : null}
      <path d={art.coast} className="coastline" />
      <g className="region-art">
        {art.regions.flatMap((region) =>
          region.decor.map((d, i) => (
            <use
              key={`${region.id}-${i}`}
              href={symbolRef(prefix, d.kind)}
              x={d.x - d.size / 2}
              y={d.y - d.size / 2}
              width={d.size}
              height={d.size}
              transform={d.flip ? `translate(${2 * d.x} 0) scale(-1 1)` : undefined}
            />
          )),
        )}
      </g>
      {life ? (
        <g className="menu-life">
          {CASTLES.map(([id, seat], i) => {
            const r = at(id);
            return (
              <g
                key={id}
                className="menu-castle"
                style={{ ['--flag' as string]: `var(--seat-${seat})` }}
              >
                <ellipse cx={r.cx} cy={r.cy + 22} rx="30" ry="7" className="menu-shadow" />
                <use
                  href={symbolRef(prefix, 'castle')}
                  x={r.cx - 36}
                  y={r.cy - 48}
                  width={72}
                  height={72}
                  style={{ animationDelay: `${1.05 + i * 0.15}s` }}
                />
              </g>
            );
          })}
          <Attack from={at(5)} to={at(6)} />
          {ARMIES.map(([id, seat, n]) => {
            const r = at(id);
            return (
              <g
                key={id}
                className="menu-army"
                style={{ ['--flag' as string]: `var(--seat-${seat})` }}
              >
                <ellipse cx={r.cx + 2} cy={r.cy + 22} rx="18" ry="5" className="menu-shadow" />
                <use
                  href={symbolRef(prefix, 'bearer')}
                  x={r.cx - 22}
                  y={r.cy - 26}
                  width={48}
                  height={48}
                />
                <text x={r.cx + 13} y={r.cy - 13} className="menu-army-n">
                  {n}
                </text>
              </g>
            );
          })}
          {SHIPS.map((ship, i) => (
            <Ship key={i} {...ship} delay={i * 0.9} />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

/** Kogge mit Rahsegel und Fahne in Reichsfarbe; schaukelt auf dem Meer. */
function Ship({
  x,
  y,
  seat,
  flip,
  scale,
  delay,
}: {
  readonly x: number;
  readonly y: number;
  readonly seat: number;
  readonly flip: boolean;
  readonly scale: number;
  readonly delay: number;
}) {
  return (
    <g
      className="menu-ship"
      transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}
    >
      <path d="M-40 22Q-26 17-12 22M12 25Q26 20 40 25" className="wake" />
      <g className="menu-bob" style={{ animationDelay: `${delay}s` }}>
        <path d="M0 6V-50" className="mast" />
        <path d="M-22-41Q0-36 22-41L19-11Q0-6-19-11Z" className="sail" />
        <path d="M-12-38V-10M12-38V-10" className="seam" />
        <path d="M-24-42H24" className="yard" />
        <path d="M0-50L18-46L0-42Z" className={`flag seat-${seat}`} />
        <path d="M-36-2L-26 1H24L34-6L30 8Q26 20 14 20H-16Q-30 20-36-2Z" className="hull" />
        <path d="M-27 8H29" className="plank" />
      </g>
    </g>
  );
}

/** Angriffspfeil von Burg zu Region: Bogen mit Spitze in Richtung des Ziels, gestrichelt laufend. */
function Attack({ from, to }: { readonly from: Point; readonly to: Point }) {
  const sx = from.cx + 30;
  const sy = from.cy + 4;
  const ex = to.cx - 14;
  const ey = to.cy + 2;
  const qx = (sx + ex) / 2;
  // Flacher Bogen: Darüber steht oben in der Mitte der Name des Spiels
  const qy = Math.min(sy, ey) - 26;
  const len = Math.hypot(ex - qx, ey - qy) || 1;
  const dx = (ex - qx) / len;
  const dy = (ey - qy) / len;
  const tip = { x: ex + dx * 8, y: ey + dy * 8 };
  const back = { x: tip.x - dx * 20, y: tip.y - dy * 20 };
  const f = (n: number) => n.toFixed(1);
  const head = `M${f(back.x - dy * 13)} ${f(back.y + dx * 13)}L${f(tip.x)} ${f(tip.y)}L${f(back.x + dy * 13)} ${f(back.y - dx * 13)}`;
  const d = `M${f(sx)} ${f(sy)}Q${f(qx)} ${f(qy)} ${f(ex)} ${f(ey)}`;
  return (
    <g className="menu-attack">
      <path d={d} className="halo" />
      <path d={head} className="halo" />
      <path d={d} className="line" />
      <path d={head} className="head" />
    </g>
  );
}
