import type { MatchBoard as BoardState } from '@rdw/protocol';
import type { MatchMap } from '@rdw/game-core';
import { useMemo, type KeyboardEvent } from 'react';
import { t, tp } from '../i18n/i18n.ts';
import { boardLayout } from './board-layout.ts';
import type { SeatName } from './match-text.ts';

/**
 * Karte der Partie als SVG: Besitz über Farbe und Zeichen je Sitz (nicht nur über Farbe),
 * Hauptstädte mit ihren Leben, Punktwert je Region. Wählbare Regionen sind Schaltflächen; die
 * umkämpfte Region eines Duells ist hervorgehoben.
 */

/** Zeichen je Sitz, zusätzlich zur Farbe. */
export const SEAT_MARKS = ['◆', '●', '▲'] as const;

export function seatMark(seat: number): string {
  return SEAT_MARKS[seat] ?? '?';
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
  const layout = useMemo(() => boardLayout(map), [map]);
  const choosable = new Set(busy ? [] : legal);

  function onKey(event: KeyboardEvent, region: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPick(region);
    }
  }

  return (
    <svg
      className="board"
      viewBox={layout.viewBox}
      role="group"
      aria-label={t('match.board.label')}
      data-testid="match-board"
    >
      {layout.cells.map((cell) => {
        const region = board.regions[cell.id];
        if (!region) return null;
        const owner = region.owner;
        const capitalOf = region.capitalOf;
        const lives = capitalOf === null ? 0 : (board.seats[capitalOf]?.capitalLivesLeft ?? 0);
        const canPick = choosable.has(cell.id);
        const label = t('match.board.region', {
          name: cell.name,
          owner: owner === null ? t('match.board.free') : name(owner),
          value: region.value,
        });
        const classes = [
          'board-region',
          owner === null ? 'free' : `seat-${owner}`,
          canPick ? 'legal' : '',
          contested === cell.id ? 'contested' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <g
            key={cell.id}
            className={classes}
            data-region={cell.id}
            {...(canPick
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': cell.name,
                  onClick: () => onPick(cell.id),
                  onKeyDown: (event: KeyboardEvent) => onKey(event, cell.id),
                }
              : { role: 'img', 'aria-label': label })}
          >
            <title>
              {capitalOf !== null
                ? `${label} · ${t('match.board.capital')} · ${tp('match.board.lives', lives)}`
                : label}
            </title>
            <polygon points={cell.points} />
            <text x={cell.cx} y={cell.cy - 16} className="board-name">
              {cell.name}
            </text>
            <text x={cell.cx} y={cell.cy + 4} className="board-value">
              {owner === null ? region.value : `${seatMark(owner)} ${region.value}`}
            </text>
            {capitalOf !== null ? (
              <text x={cell.cx} y={cell.cy + 22} className="board-capital">
                {`♛ ${'♥'.repeat(lives)}`}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
