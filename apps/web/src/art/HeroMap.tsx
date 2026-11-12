import { WENDELMARK } from '@rdw/game-core';
import { useId, useMemo } from 'react';
import { ArtDefs, symbolRef } from './ArtDefs.tsx';
import { mapArt } from './map-art.ts';
import './map-art.css';

/** Wem eine Region auf der Startseite „gehört“: drei Reiche in einer festen Szene. */
const SCENE: Readonly<Record<number, number>> = {
  0: 0,
  1: 0,
  4: 0,
  5: 0,
  9: 0,
  10: 0,
  3: 1,
  7: 1,
  8: 1,
  13: 1,
  14: 1,
  15: 2,
  19: 2,
  20: 2,
  16: 2,
};

/**
 * Die Wendelmark als Schmuckbild ohne Beschriftung (Startseite): Küste, Grenzen, Fluss, Motive
 * und drei Reiche in Sitzfarben. Rein dekorativ. Mit `cover` füllt sie ihre Fläche ganz und wird
 * dafür beschnitten: der Hintergrund der Aufstellung (ADR-059).
 */
export function HeroMap({ cover = false }: { readonly cover?: boolean }) {
  const art = useMemo(() => mapArt(WENDELMARK), []);
  const prefix = `hero${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg
      className="map-art hero-map"
      viewBox={art.viewBox}
      preserveAspectRatio={cover ? 'xMidYMid slice' : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <ArtDefs prefix={prefix} />
      <rect className="sea" width={art.width} height={art.height} />
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
                style={{ animationDelay: `${0.3 + (region.id % 7) * 0.12}s` }}
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
    </svg>
  );
}
