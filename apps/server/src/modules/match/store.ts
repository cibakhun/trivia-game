import type { Db, Tx } from '@rdw/db';
import type { MatchState } from '@rdw/game-core';
import type {
  MatchBotStrengthCode,
  MatchKind,
  MatchPhaseKind,
  MatchRules,
  MatchRulesPreset,
  MatchStatus,
} from '@rdw/protocol';
import { sql } from 'kysely';

/**
 * Lesen und Schreiben der Partie-Tabellen (Migration 0012). Eine Partie wird nur unter der
 * Zeilensperre auf `matches` geändert; Ereignisse bekommen ihre Nummer unter dieser Sperre.
 */

export interface MatchRow {
  readonly id: string;
  readonly kind: MatchKind;
  status: MatchStatus;
  readonly hostUserId: string;
  readonly inviteCode: string;
  readonly rulesPreset: MatchRulesPreset;
  readonly testSeats: 2 | 3 | null;
  readonly testBotStrengths: readonly MatchBotStrengthCode[] | null;
  rules: MatchRules | null;
  state: MatchState | null;
  phase: MatchPhaseKind | null;
  phaseDeadlineAt: Date | null;
  questionSeq: number | null;
  readonly rngKeyId: string;
  readonly rngVersion: number;
  draws: number;
  readonly createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface MatchPlayerRow {
  readonly joinOrder: number;
  readonly userId: string | null;
  readonly botStrength: MatchBotStrengthCode | null;
  seat: number | null;
  readonly joinedAt: Date;
}

const MATCH_COLUMNS = [
  'id',
  'kind',
  'status',
  'host_user_id',
  'invite_code',
  'rules_preset',
  'test_seats',
  'test_bot_strengths',
  'rules',
  'state',
  'phase',
  'phase_deadline_at',
  'question_seq',
  'rng_key_id',
  'rng_version',
  'draws',
  'created_at',
  'started_at',
  'finished_at',
] as const;

type RawMatch = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly host_user_id: string;
  readonly invite_code: string;
  readonly rules_preset: string;
  readonly test_seats: number | null;
  readonly test_bot_strengths: string[] | null;
  readonly rules: unknown;
  readonly state: unknown;
  readonly phase: string | null;
  readonly phase_deadline_at: Date | null;
  readonly question_seq: number | null;
  readonly rng_key_id: string;
  readonly rng_version: number;
  readonly draws: number;
  readonly created_at: Date;
  readonly started_at: Date | null;
  readonly finished_at: Date | null;
};

function toMatchRow(raw: RawMatch): MatchRow {
  return {
    id: raw.id,
    kind: raw.kind as MatchKind,
    status: raw.status as MatchStatus,
    hostUserId: raw.host_user_id,
    inviteCode: raw.invite_code,
    rulesPreset: raw.rules_preset as MatchRulesPreset,
    testSeats: raw.test_seats === 2 || raw.test_seats === 3 ? raw.test_seats : null,
    testBotStrengths: raw.test_bot_strengths as MatchBotStrengthCode[] | null,
    // Eigene Schreibvorgänge: Regeln und Zustand stammen aus `matchRulesSchema` bzw. game-core
    rules: raw.rules as MatchRules | null,
    state: raw.state as MatchState | null,
    phase: raw.phase as MatchPhaseKind | null,
    phaseDeadlineAt: raw.phase_deadline_at,
    questionSeq: raw.question_seq,
    rngKeyId: raw.rng_key_id,
    rngVersion: raw.rng_version,
    draws: raw.draws,
    createdAt: raw.created_at,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
  };
}

/** Liest eine Partie; mit `lock` unter Zeilensperre (nur in einer Transaktion). */
export async function loadMatch(
  db: Db | Tx,
  matchId: string,
  options: { readonly lock?: 'UPDATE' | 'UPDATE_SKIP_LOCKED' } = {},
): Promise<MatchRow | null> {
  let query = db
    .selectFrom('matches')
    .select([...MATCH_COLUMNS])
    .where('id', '=', matchId);
  if (options.lock === 'UPDATE') query = query.forUpdate();
  if (options.lock === 'UPDATE_SKIP_LOCKED') query = query.forUpdate().skipLocked();
  const raw = await query.executeTakeFirst();
  return raw ? toMatchRow(raw) : null;
}

/** Schreibt die veränderlichen Spalten zurück. */
export async function saveMatch(tx: Tx, match: MatchRow): Promise<void> {
  await tx
    .updateTable('matches')
    .set({
      status: match.status,
      rules: match.rules === null ? null : JSON.stringify(match.rules),
      state: match.state === null ? null : JSON.stringify(match.state),
      phase: match.phase,
      phase_deadline_at: match.phaseDeadlineAt,
      question_seq: match.questionSeq,
      draws: match.draws,
      started_at: match.startedAt,
      finished_at: match.finishedAt,
    })
    .where('id', '=', match.id)
    .execute();
}

export async function loadPlayers(db: Db | Tx, matchId: string): Promise<MatchPlayerRow[]> {
  const rows = await db
    .selectFrom('match_players')
    .select(['join_order', 'user_id', 'bot_strength', 'seat', 'joined_at'])
    .where('match_id', '=', matchId)
    .orderBy('join_order')
    .execute();
  return rows.map((row) => ({
    joinOrder: row.join_order,
    userId: row.user_id,
    botStrength: row.bot_strength as MatchBotStrengthCode | null,
    seat: row.seat,
    joinedAt: row.joined_at,
  }));
}

export interface MatchEventInput {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** Hängt Ereignisse an; der Aufrufer hält die Sperre auf die Partie. Liefert die letzte Nummer. */
export async function appendMatchEvents(
  tx: Tx,
  matchId: string,
  events: readonly MatchEventInput[],
): Promise<number> {
  const last = await lastEventSeq(tx, matchId);
  if (events.length === 0) return last;
  await tx
    .insertInto('match_events')
    .values(
      events.map((event, i) => ({
        match_id: matchId,
        seq: last + 1 + i,
        type: event.type,
        payload: JSON.stringify(event.payload),
        at: sql<Date>`game_now()`,
      })),
    )
    .execute();
  return last + events.length;
}

export async function lastEventSeq(db: Db | Tx, matchId: string): Promise<number> {
  const { last } = await db
    .selectFrom('match_events')
    .select((eb) => eb.fn.coalesce(eb.fn.max('seq'), eb.lit(0)).as('last'))
    .where('match_id', '=', matchId)
    .executeTakeFirstOrThrow();
  return Number(last);
}

/** Offene Partie (Aufstellung oder laufend) des Kontos, falls es eine gibt. */
export async function openMatchOf(db: Db | Tx, userId: string): Promise<string | null> {
  const row = await db
    .selectFrom('match_players as p')
    .innerJoin('matches as m', 'm.id', 'p.match_id')
    .select('m.id')
    .where('p.user_id', '=', userId)
    .where('m.status', 'in', ['LOBBY', 'RUNNING'])
    .orderBy('m.created_at', 'desc')
    .executeTakeFirst();
  return row?.id ?? null;
}
