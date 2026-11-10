import type { MatchBoard as BoardState } from '@rdw/protocol';
import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import type { MatchMap } from '@rdw/game-core';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArtDefs, symbolRef, type SymbolId } from '../art/ArtDefs.tsx';
import { attackArrow, attackSource, type ArrowShape } from '../art/attack.ts';
import { mapArt, type ArtRegion, type MapArt } from '../art/map-art.ts';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import '../art/map-art.css';
import type { SeatName } from './match-text.ts';

/**
 * Karte der Partie im Stil „Alte Landkarte“ (docs/ART_DIRECTION.md): Regionen mit natürlichen
 * Grenzen, Meer, Fluss und Landschaftsmotiven. Besitz zeigt eine Aquarellfarbe je Sitz plus
 * Wappenmuster und Wappenbild (nicht nur Farbe), Hauptstädte eine Burg mit Schilden als Leben,
 * jede Region ihren Punktwert als Münze. Wählbare Regionen sind Schaltflächen mit goldener Kante,
 * die umkämpfte Region eines Duells trägt gekreuzte Schwerter. Eroberung, Wertzuwachs und
 * Treffer auf die Burg sind kurz animiert (nicht bei „Bewegung reduzieren“).
 */

/** Schmaler Bildschirm (Handy hochkant): Karte ohne Meeresrand, größere Schrift. */
const NARROW = '(max-width: 560px)';

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** `true` ab dem zweiten Rendern: Beim ersten Aufbau läuft keine Änderungsanimation. */
function useSettled(): boolean {
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  return settled.current;
}

export function MatchBoard({
  map,
  board,
  name,
  legal,
  contested,
  busy,
  onPick,
}: {
  readonly map: MatchMap;
  readonly board: BoardState;
  readonly name: SeatName;
  /** Wählbare Regionen, nur wenn dieser Spieler dran ist. */
  readonly legal: readonly number[];
  /** Umkämpfte Region eines Duells. */
  readonly contested: number | null;
  readonly busy: boolean;
  readonly onPick: (region: number) => void;
}) {
  const art = useMemo(() => mapArt(map), [map]);
  const prefix = `map${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const settled = useSettled();
  const narrow = useNarrow();
  const [hot, setHot] = useState<number | null>(null);
  const choosable = new Set(busy ? [] : legal);
  const maxLives = Math.max(
    DEFAULT_MATCH_RULES.capital.lives,
    ...board.seats.map((s) => s.capitalLivesLeft),
  );
  const s = art.size;

  function onKey(event: KeyboardEvent, region: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPick(region);
    }
  }

  const contestedArt = contested === null ? null : art.regions[contested];
  const attacker = board.step.attacker;
  const arrow = useMemo(() => {
    if (contested === null || attacker === null) return null;
    const from = attackSource(
      map,
      {
        owner: board.regions.map((r) => r.owner),
        capital: board.regions.findIndex((r) => r.capitalOf === attacker),
      },
      attacker,
      contested,
    );
    return from === null ? null : attackArrow(art, from, contested);
  }, [art, map, board.regions, attacker, contested]);
  const hotArt = hot !== null && choosable.has(hot) ? art.regions[hot] : undefined;

  return (
    <svg
      className={`board map-art${narrow ? ' narrow' : ''}`}
      viewBox={narrow ? art.tightViewBox : art.viewBox}
      role="group"
      aria-label={t('match.board.label')}
      data-testid="match-board"
    >
      <ArtDefs prefix={prefix} />
      <defs>
        {art.regions.map((region) => (
          <clipPath key={region.id} id={`${prefix}-clip-${region.id}`}>
            <path d={region.d} />
          </clipPath>
        ))}
      </defs>

      <rect className="sea" width={art.width} height={art.height} />
      <g className="sea-marks" aria-hidden="true">
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
      <g className="coast-ripples" aria-hidden="true">
        <path d={art.coast} className="ripple ripple-3" />
        <path d={art.coast} className="ripple ripple-2" />
        <path d={art.coast} className="ripple ripple-1" />
      </g>

      <g className="regions">
        {art.regions.map((region) => {
          const state = board.regions[region.id];
          if (!state) return null;
          const owner = state.owner;
          const canPick = choosable.has(region.id);
          const label = t('match.board.region', {
            name: region.name,
            owner: owner === null ? t('match.board.free') : name(owner),
            value: state.value,
          });
          const capitalOf = state.capitalOf;
          const lives = capitalOf === null ? 0 : (board.seats[capitalOf]?.capitalLivesLeft ?? 0);
          const classes = [
            'board-region',
            owner === null ? 'free' : `seat-${owner}`,
            canPick ? 'legal' : '',
            contested === region.id ? 'contested' : '',
            capitalOf !== null ? 'capital' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g
              key={region.id}
              className={classes}
              data-region={region.id}
              {...(canPick
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': region.name,
                    onClick: () => onPick(region.id),
                    onKeyDown: (event: KeyboardEvent) => onKey(event, region.id),
                    onPointerEnter: () => setHot(region.id),
                    onPointerLeave: () => setHot((h) => (h === region.id ? null : h)),
                    onFocus: () => setHot(region.id),
                    onBlur: () => setHot((h) => (h === region.id ? null : h)),
                  }
                : { role: 'img', 'aria-label': label })}
            >
              <title>
                {capitalOf !== null
                  ? `${label} · ${t('match.board.capital')} · ${tp('match.board.lives', lives)}`
                  : label}
              </title>
              <path d={region.d} className="land" />
              {owner !== null ? (
                <g key={`wash-${owner}`} className={`wash${settled ? ' ink-in' : ''}`}>
                  <path d={region.d} className="wash-fill" />
                  <path
                    d={region.d}
                    className="wash-pattern"
                    fill={`url(#${prefix}-pattern-${owner})`}
                  />
                  <path
                    d={region.d}
                    className="wash-edge"
                    clipPath={`url(#${prefix}-clip-${region.id})`}
                  />
                </g>
              ) : null}
              {canPick ? <path d={region.d} className="legal-glow" /> : null}
            </g>
          );
        })}
      </g>

      <g className="region-borders" aria-hidden="true">
        {art.regions.map((region) => (
          <path key={region.id} d={region.d} />
        ))}
      </g>
      {art.river ? (
        <g className="river" aria-hidden="true">
          <path d={art.river} className="river-bank" />
          <path d={art.river} className="river-water" />
        </g>
      ) : null}
      <path d={art.coast} className="coastline" aria-hidden="true" />

      <g className="region-art" aria-hidden="true">
        {art.regions.map((region) => {
          const state = board.regions[region.id];
          if (!state) return null;
          return (
            <RegionArt
              key={region.id}
              prefix={prefix}
              region={region}
              owner={state.owner}
              value={state.value}
              capitalOf={state.capitalOf}
              lives={
                state.capitalOf === null ? 0 : (board.seats[state.capitalOf]?.capitalLivesLeft ?? 0)
              }
              maxLives={maxLives}
              contested={contested === region.id}
              settled={settled}
              size={s}
            />
          );
        })}
      </g>

      <g className="board-overlay" aria-hidden="true">
        {art.regions
          .filter((region) => choosable.has(region.id))
          .map((region) => (
            <path key={region.id} d={region.d} className="legal-ring" />
          ))}
        {hotArt ? <path d={hotArt.d} className="hot-ring" /> : null}
        {contestedArt ? (
          <Contested
            prefix={prefix}
            region={contestedArt}
            arrow={arrow}
            attacker={attacker}
            settled={settled}
            size={s}
          />
        ) : null}
      </g>

      <Compass art={art} />
      <Cartouche art={art} title={map.name} />
    </svg>
  );
}

function RegionArt({
  prefix,
  region,
  owner,
  value,
  capitalOf,
  lives,
  maxLives,
  contested,
  settled,
  size: s,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly owner: number | null;
  readonly value: number;
  readonly capitalOf: number | null;
  readonly lives: number;
  readonly maxLives: number;
  /** Umkämpft: Das obere Motiv weicht dem Angriffspfeil. */
  readonly contested: boolean;
  readonly settled: boolean;
  readonly size: number;
}) {
  const { cx, cy } = region;
  const capital = capitalOf !== null;
  const use = (id: SymbolId, x: number, y: number, size: number, extra?: string) => (
    <use
      href={symbolRef(prefix, id)}
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      className={extra}
    />
  );
  const coinX = owner === null ? cx : cx + 0.13 * s;
  const coinY = capital ? cy + 0.08 * s : cy + 0.3 * s;
  return (
    <g className={`region-label${owner === null ? ' free' : ` seat-${owner}`}`}>
      {region.decor
        .filter((d) => (!capital && !contested) || d.slot === 'side')
        .map((d, i) => (
          <use
            key={i}
            href={symbolRef(prefix, d.kind)}
            x={d.x - d.size / 2}
            y={d.y - d.size / 2}
            width={d.size}
            height={d.size}
            transform={d.flip ? `translate(${2 * d.x} 0) scale(-1 1)` : undefined}
            className="decor"
          />
        ))}
      {capital ? (
        <>
          <g
            key={`castle-${lives}`}
            className={`castle${settled && lives < maxLives ? ' hit' : ''}`}
            style={{ ['--flag' as string]: `var(--seat-${capitalOf})` }}
          >
            {use('castle', cx - 0.12 * s, cy + 0.02 * s, 0.62 * s)}
          </g>
          <g className="lives">
            {Array.from({ length: maxLives }, (_, i) => {
              const left = i < lives;
              const x = cx + (i - (maxLives - 1) / 2) * 0.24 * s;
              return (
                <g
                  key={`${i}-${left ? 'on' : 'off'}`}
                  className={`life ${left ? 'life-on' : `life-off${settled ? ' breaking' : ''}`}`}
                  style={{ ['--flag' as string]: `var(--seat-${capitalOf})` }}
                >
                  {use('shield', x, cy + 0.5 * s, 0.22 * s)}
                </g>
              );
            })}
          </g>
        </>
      ) : null}
      <text x={cx} y={capital ? cy - 0.47 * s : cy - 0.06 * s} className="board-name">
        {region.name}
      </text>
      {owner !== null ? (
        <g className="owner-badge">
          {use('shield', cx - 0.2 * s, coinY, 0.27 * s, `badge-shield seat-fill-${owner}`)}
          {use(
            `emblem-${owner}` as SymbolId,
            cx - 0.2 * s,
            coinY - 0.015 * s,
            0.11 * s,
            'badge-emblem',
          )}
        </g>
      ) : null}
      <g key={`coin-${value}`} className={`coin${settled ? ' pop' : ''}`}>
        <circle cx={coinX} cy={coinY} r={0.2 * s} />
        <text x={coinX} y={coinY + 0.01 * s} className="board-value">
          {formatNumber(value)}
        </text>
      </g>
    </g>
  );
}

function Contested({
  prefix,
  region,
  arrow,
  attacker,
  settled,
  size: s,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly arrow: ArrowShape | null;
  readonly attacker: number | null;
  readonly settled: boolean;
  readonly size: number;
}) {
  // Siegel auf der Grenze zwischen Angreifer und Ziel, sonst oben rechts neben dem Namen
  const x = arrow ? arrow.mid.x : region.cx + 0.55 * s;
  const y = arrow ? arrow.mid.y : region.cy - 0.55 * s;
  return (
    <g className="contested-mark">
      <path d={region.d} className="contested-ring" />
      {arrow && attacker !== null ? (
        <g
          key={arrow.d}
          className={`attack-arrow seat-${attacker}${settled ? ' draw' : ''}`}
          style={{ ['--arrow' as string]: `var(--seat-${attacker})` }}
        >
          <path d={arrow.d} pathLength={1} className="arrow-ink" />
          <path d={arrow.d} pathLength={1} className="arrow-shaft" />
          <path d={arrow.head} className="arrow-head" />
        </g>
      ) : null}
      <circle cx={x} cy={y} r={0.18 * s} className="contested-seal" />
      <g className="swords">
        <use
          href={symbolRef(prefix, 'swords')}
          x={x - 0.15 * s}
          y={y - 0.15 * s}
          width={0.3 * s}
          height={0.3 * s}
        />
      </g>
    </g>
  );
}

function Compass({ art }: { readonly art: MapArt }) {
  const { x, y, r } = art.compass;
  const point = (angle: number, length: number, width: number) => {
    const rad = (angle * Math.PI) / 180;
    const tip = { x: x + Math.sin(rad) * length, y: y - Math.cos(rad) * length };
    const left = {
      x: x + Math.sin(rad - Math.PI / 2) * width,
      y: y - Math.cos(rad - Math.PI / 2) * width,
    };
    const right = {
      x: x + Math.sin(rad + Math.PI / 2) * width,
      y: y - Math.cos(rad + Math.PI / 2) * width,
    };
    return { tip, left, right };
  };
  const ray = (angle: number, length: number, width: number) => {
    const { tip, left, right } = point(angle, length, width);
    return (
      <g key={angle}>
        <path d={`M${x} ${y}L${left.x} ${left.y}L${tip.x} ${tip.y}Z`} className="compass-light" />
        <path d={`M${x} ${y}L${right.x} ${right.y}L${tip.x} ${tip.y}Z`} className="compass-dark" />
      </g>
    );
  };
  return (
    <g className="compass" aria-hidden="true">
      <circle cx={x} cy={y} r={r * 0.78} className="compass-ring" />
      <circle cx={x} cy={y} r={r * 0.64} className="compass-ring thin" />
      {[45, 135, 225, 315].map((a) => ray(a, r * 0.62, r * 0.12))}
      {[0, 90, 180, 270].map((a) => ray(a, r, r * 0.17))}
      <circle cx={x} cy={y} r={r * 0.08} className="compass-hub" />
      <text x={x} y={y - r * 1.2} className="compass-north">
        N
      </text>
    </g>
  );
}

function Cartouche({ art, title }: { readonly art: MapArt; readonly title: string }) {
  const { x, y, width } = art.title;
  const s = art.size;
  const height = 0.72 * s;
  const curl = 0.2 * s;
  return (
    <g className="cartouche" aria-hidden="true">
      <path
        d={`M${x + curl} ${y}H${x + width - curl}C${x + width} ${y} ${x + width} ${y + height} ${x + width - curl} ${y + height}H${x + curl}C${x} ${y + height} ${x} ${y} ${x + curl} ${y}Z`}
        className="cartouche-scroll"
      />
      <path
        d={`M${x + curl * 1.6} ${y + 0.12 * s}H${x + width - curl * 1.6}M${x + curl * 1.6} ${y + height - 0.12 * s}H${x + width - curl * 1.6}`}
        className="cartouche-rule"
      />
      <text x={x + width / 2} y={y + height / 2 + 0.02 * s} className="cartouche-title">
        {title}
      </text>
    </g>
  );
}
