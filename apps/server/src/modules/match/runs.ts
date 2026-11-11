import type { Tx } from '@rdw/db';
import { readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import { ClassicRun } from './classic-run.ts';
import type { MatchEngineContext, MatchRun } from './engine.ts';
import { RealmRun } from './realm-run.ts';
import { loadMatch, loadPlayers, type MatchPlayerRow, type MatchRow } from './store.ts';

/** Durchgang an einer gesperrten Partie in ihrer Spielart (ADR-058). */
export function openRun(
  tx: Tx,
  ctx: MatchEngineContext,
  match: MatchRow,
  players: readonly MatchPlayerRow[],
  now: Date,
): MatchRun {
  switch (match.mode) {
    case 'CLASSIC':
      return new ClassicRun(tx, ctx, match, players, now);
    case 'REALM':
      return new RealmRun(tx, ctx, match, players, now);
  }
}

/**
 * Sperrt die Partie für einen Teilnehmer und liefert den Durchgang mit der Spielzeit nach der
 * Sperre. Wer nicht teilnimmt, bekommt „nicht gefunden“, wie bei fremden Herausforderungen.
 */
export async function lockMatchFor(
  tx: Tx,
  ctx: MatchEngineContext,
  matchId: string,
  userId: string,
): Promise<MatchRun> {
  const match = await loadMatch(tx, matchId, { lock: 'UPDATE' });
  const players = match ? await loadPlayers(tx, matchId) : [];
  if (!match || !players.some((p) => p.userId === userId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  }
  return openRun(tx, ctx, match, players, await readGameNow(tx));
}
