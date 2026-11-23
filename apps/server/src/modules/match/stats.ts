import type { Db } from '@rdw/db';
import {
  QUESTION_CATEGORIES,
  matchEventPayloadSchemas,
  type PlayerStatsResponse,
  type QuestionCategory,
} from '@rdw/protocol';
import { placeOf } from './view.ts';

/**
 * Eigene Zahlen über alle beendeten Partien für die Kontoseite (`GET /me/stats`, ADR-080). Liest
 * nur: Plätze und Serien aus der Abrechnung, Duelle und Schätzungen aus den Ereignissen der Partie,
 * Wissen je Kategorie aus den eigenen Antworten. Wie die Bilanz der Chronik zählen Testpartien und
 * Partien mit Bots mit. Die Rechnung steckt in reinen Funktionen, damit Tests sie ohne Datenbank
 * prüfen.
 */

/** Eine beendete Partie des Kontos: eigener Sitz, Spielart, Ende und Inhalt der Abrechnung. */
export interface FinishedMatch {
  readonly id: string;
  readonly mode: string;
  readonly seat: number | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly final: unknown;
}

/** Ein Ereignis aus einer dieser Partien. */
export interface StatsEvent {
  readonly matchId: string;
  readonly type: string;
  readonly payload: unknown;
}

/** Ereignisse, aus denen Duelle und Schätzungen gezählt werden. */
export const STATS_EVENTS = [
  'LAND_RANKED',
  'START_RANKED',
  'DUEL_RESOLVED',
  'REALM_DUEL_RESOLVED',
  'KINGDOM_ELIMINATED',
] as const;

const FINISH_EVENTS = ['MATCH_FINISHED', 'REALM_MATCH_FINISHED'] as const;

/** Partien, Plätze, Spielarten und Siegesserien; die Reihenfolge ergibt sich aus dem Ende. */
export function tallyMatches(matches: readonly FinishedMatch[]): PlayerStatsResponse['matches'] {
  const result = {
    played: 0,
    won: 0,
    places: { first: 0, second: 0, third: 0 },
    classic: { played: 0, won: 0 },
    realm: { played: 0, won: 0 },
    streak: { current: 0, best: 0 },
  };
  const ordered = [...matches].sort(
    (a, b) =>
      (a.finishedAt ?? a.createdAt).getTime() - (b.finishedAt ?? b.createdAt).getTime() ||
      a.id.localeCompare(b.id),
  );
  let run = 0;
  for (const match of ordered) {
    const place = placeOf(match.final, match.seat);
    const won = place === 1;
    const mode = match.mode === 'REALM' ? result.realm : result.classic;
    result.played += 1;
    mode.played += 1;
    if (won) {
      result.won += 1;
      mode.won += 1;
    }
    if (place === 1) result.places.first += 1;
    else if (place === 2) result.places.second += 1;
    else if (place === 3) result.places.third += 1;
    run = won ? run + 1 : 0;
    result.streak.best = Math.max(result.streak.best, run);
  }
  result.streak.current = run;
  return result;
}

/**
 * Duelle gegen andere Reiche, gestürzte Reiche und Schätzungen auf Platz 1. `seats` nennt den
 * eigenen Sitz je Partie; Ereignisse anderer Partien und unlesbare Inhalte bleiben außen vor.
 */
export function tallyEvents(
  events: readonly StatsEvent[],
  seats: ReadonlyMap<string, number>,
): { duels: PlayerStatsResponse['duels']; closest: number } {
  const duels = { fought: 0, won: 0, toppled: 0 };
  let closest = 0;
  for (const event of events) {
    const seat = seats.get(event.matchId);
    if (seat === undefined) continue;
    switch (event.type) {
      case 'LAND_RANKED':
      case 'START_RANKED': {
        const schema =
          event.type === 'LAND_RANKED'
            ? matchEventPayloadSchemas.LAND_RANKED
            : matchEventPayloadSchemas.START_RANKED;
        const parsed = schema.safeParse(event.payload);
        if (!parsed.success) break;
        // Platz 1 nur mit eigener Schätzung; wer nichts abgab, war nicht am nächsten dran
        const mine = parsed.data.ranking.find((r) => r.seat === seat);
        if (mine && mine.place === 1 && mine.distance !== null) closest += 1;
        break;
      }
      case 'DUEL_RESOLVED':
      case 'REALM_DUEL_RESOLVED': {
        const parsed =
          event.type === 'DUEL_RESOLVED'
            ? matchEventPayloadSchemas.DUEL_RESOLVED.safeParse(event.payload)
            : matchEventPayloadSchemas.REALM_DUEL_RESOLVED.safeParse(event.payload);
        if (!parsed.success) break;
        const { attacker, defender, winner, reason } = parsed.data;
        // Ein freies Feld (Ausbau, O-37) ist kein Duell gegen ein Reich
        if (defender === null || (attacker !== seat && defender !== seat)) break;
        const won =
          (winner === 'ATTACKER' && attacker === seat) ||
          (winner === 'DEFENDER' && defender === seat);
        duels.fought += 1;
        if (won) duels.won += 1;
        if (won && reason === 'ESTIMATE') closest += 1;
        break;
      }
      case 'KINGDOM_ELIMINATED': {
        const parsed = matchEventPayloadSchemas.KINGDOM_ELIMINATED.safeParse(event.payload);
        if (parsed.success && parsed.data.by === seat && parsed.data.seat !== seat) {
          duels.toppled += 1;
        }
        break;
      }
    }
  }
  return { duels, closest };
}

/** Kategorien nach der Reihenfolge in QUESTION_CATEGORIES; unbekannte fallen weg. */
export function categoryRows(
  rows: readonly { category: string; answered: number; correct: number }[],
): PlayerStatsResponse['trivia']['categories'] {
  const known = new Set<string>(QUESTION_CATEGORIES);
  return rows
    .filter((r) => known.has(r.category) && r.answered > 0)
    .map((r) => ({
      category: r.category as QuestionCategory,
      answered: r.answered,
      correct: Math.min(r.correct, r.answered),
    }))
    .sort(
      (a, b) => QUESTION_CATEGORIES.indexOf(a.category) - QUESTION_CATEGORIES.indexOf(b.category),
    );
}

export async function playerStats(db: Db, userId: string, now: Date): Promise<PlayerStatsResponse> {
  const finished = await db
    .selectFrom('matches as m')
    .innerJoin('match_players as me', (join) =>
      join.onRef('me.match_id', '=', 'm.id').on('me.user_id', '=', userId),
    )
    .leftJoin('match_events as e', (join) =>
      join.onRef('e.match_id', '=', 'm.id').on('e.type', 'in', FINISH_EVENTS),
    )
    .select(['m.id', 'm.mode', 'm.created_at', 'm.finished_at', 'me.seat', 'e.payload'])
    .where('m.status', '=', 'FINISHED')
    .execute();
  const matches = tallyMatches(
    finished.map((row) => ({
      id: row.id,
      mode: row.mode,
      seat: row.seat,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      final: row.payload,
    })),
  );

  const seats = new Map<string, number>();
  for (const row of finished) if (row.seat !== null) seats.set(row.id, row.seat);
  const events =
    seats.size === 0
      ? []
      : await db
          .selectFrom('match_events')
          .select(['match_id', 'type', 'payload'])
          .where('match_id', 'in', [...seats.keys()])
          .where('type', 'in', STATS_EVENTS)
          .execute();
  const { duels, closest } = tallyEvents(
    events.map((e) => ({ matchId: e.match_id, type: e.type, payload: e.payload })),
    seats,
  );

  // Eigene Antworten in beendeten Partien, mit Art und Kategorie der Frage
  const answers = db
    .selectFrom('match_answers as a')
    .innerJoin('match_players as me', (join) =>
      join
        .onRef('me.match_id', '=', 'a.match_id')
        .onRef('me.seat', '=', 'a.seat')
        .on('me.user_id', '=', userId),
    )
    .innerJoin('matches as m', 'm.id', 'a.match_id')
    .innerJoin('match_questions as mq', (join) =>
      join.onRef('mq.match_id', '=', 'a.match_id').onRef('mq.seq', '=', 'a.seq'),
    )
    .where('m.status', '=', 'FINISHED');

  const byCategory = await answers
    .innerJoin('question_versions as v', 'v.id', 'mq.version_id')
    .innerJoin('questions as q', 'q.id', 'v.question_id')
    .select((eb) => [
      'q.category',
      eb.fn.countAll<string>().as('answered'),
      eb.fn.count<string>('a.is_correct').filterWhere('a.is_correct', '=', true).as('correct'),
    ])
    .where('mq.kind', '=', 'TRIVIA')
    .where('a.is_correct', 'is not', null)
    .groupBy('q.category')
    .execute();
  const categories = categoryRows(
    byCategory.map((r) => ({
      category: r.category,
      answered: Number(r.answered),
      correct: Number(r.correct),
    })),
  );

  const fastest = await answers
    .select((eb) => eb.fn.min<number | null>('a.effective_ms').as('ms'))
    .where('mq.kind', '=', 'TRIVIA')
    .where('a.status', '=', 'ANSWERED')
    .where('a.is_correct', '=', true)
    .executeTakeFirst();

  const estimates = await answers
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('mq.kind', '=', 'ESTIMATE')
    .where('a.status', '=', 'ANSWERED')
    .executeTakeFirst();
  const estimated = Number(estimates?.n ?? 0);

  return {
    matches,
    duels,
    trivia: {
      answered: categories.reduce((sum, c) => sum + c.answered, 0),
      correct: categories.reduce((sum, c) => sum + c.correct, 0),
      fastestCorrectMs: fastest?.ms ?? null,
      categories,
    },
    // Mehr Treffer als Schätzungen kann es nicht geben; alte Partien ohne Rangliste zählen nicht
    estimates: { answered: estimated, closest: Math.min(closest, estimated) },
    serverTime: now.toISOString(),
  };
}
