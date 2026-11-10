import type { Db, Tx } from '@rdw/db';
import { createMatch, createRng, deriveSeed, drawSeatOrder, RNG_VERSION } from '@rdw/game-core';
import {
  DEFAULT_MATCH_RULES,
  HOUR_MS,
  INVITE_CODE_ALPHABET,
  matchRulesForSeats,
  matchRulesSchema,
  PLAYTEST_MATCH_RULES,
  QUESTION_KINDS,
  type MatchBotStrengthCode,
  type MatchCreateRequest,
  type MatchRules,
  type MatchRulesPreset,
} from '@rdw/protocol';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { intervalMs, readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import { loadCandidates } from '../quiz/questions.ts';
import type { MatchContext } from './context.ts';
import { MatchRun, newMatchId } from './engine.ts';
import {
  appendMatchEvents,
  loadMatch,
  loadPlayers,
  openMatchOf,
  saveMatch,
  type MatchRow,
} from './store.ts';

/**
 * Aufstellung einer Partie (MATCH_RULES §3.1, API.md §2.6): anlegen, mit dem Einladungscode
 * beitreten, verlassen, starten. Jedes Konto ist höchstens in einer offenen Partie; Aufstellungen
 * verfallen nach `LOBBY_TTL_MS`.
 */

/** Eine Aufstellung, die so lange nicht gestartet wurde, verfällt [E]. */
export const LOBBY_TTL_MS = 2 * HOUR_MS;
/** Plätze einer normalen Partie höchstens (MATCH_RULES §8). */
const MAX_SEATS = 3;
const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_ATTEMPTS = 10;

export function rulesOfPreset(preset: MatchRulesPreset): MatchRules {
  return preset === 'PLAYTEST' ? PLAYTEST_MATCH_RULES : DEFAULT_MATCH_RULES;
}

function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/** Ordnet Anlegen und Beitreten eines Kontos: höchstens eine offene Partie, auch bei Parallelität. */
async function lockAccount(tx: Tx, userId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`match-account:${userId}`}, 0))`.execute(
    tx,
  );
}

async function ensureNoOpenMatch(tx: Tx, userId: string, except?: string): Promise<void> {
  const open = await openMatchOf(tx, userId);
  if (open !== null && open !== except) {
    throw new ApiError(409, 'ALREADY_IN_MATCH', 'Du bist schon in einer offenen Partie', {
      matchId: open,
    });
  }
}

export async function createLobby(
  tx: Tx,
  ctx: MatchContext,
  params: { readonly userId: string; readonly request: MatchCreateRequest },
): Promise<{ matchId: string }> {
  const { userId, request } = params;
  if (request.kind === 'TEST' && !ctx.testMatchesEnabled) {
    throw new ApiError(403, 'TEST_MATCHES_DISABLED', 'Testpartien gibt es hier nicht');
  }
  await lockAccount(tx, userId);
  await ensureNoOpenMatch(tx, userId);
  const matchId = newMatchId();
  const test = request.kind === 'TEST' ? request : null;
  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
    const inserted = await tx
      .insertInto('matches')
      .values({
        id: matchId,
        kind: request.kind,
        status: 'LOBBY',
        host_user_id: userId,
        invite_code: newInviteCode(),
        rules_preset: request.rules ?? 'DEFAULT',
        test_seats: test?.seats ?? null,
        test_bot_strengths: test ? [...test.botStrengths] : null,
        rng_key_id: ctx.rngKeyId,
        rng_version: RNG_VERSION,
      })
      .onConflict((oc) => oc.column('invite_code').where('status', '=', 'LOBBY').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) {
      await tx
        .insertInto('match_players')
        .values({ match_id: matchId, join_order: 0, user_id: userId })
        .execute();
      await appendMatchEvents(tx, matchId, [
        {
          type: 'MATCH_CREATED',
          payload: {
            kind: request.kind,
            rulesPreset: request.rules ?? 'DEFAULT',
            seats: test?.seats ?? null,
          },
        },
        { type: 'PLAYER_JOINED', payload: { joinOrder: 0 } },
      ]);
      return { matchId };
    }
  }
  throw new Error('Kein freier Einladungscode gefunden');
}

export async function joinLobby(
  tx: Tx,
  params: { readonly userId: string; readonly inviteCode: string },
): Promise<{ matchId: string }> {
  const { userId } = params;
  await lockAccount(tx, userId);
  const target = await tx
    .selectFrom('matches')
    .select('id')
    .where('invite_code', '=', params.inviteCode)
    .where('status', '=', 'LOBBY')
    .executeTakeFirst();
  if (!target)
    throw new ApiError(404, 'INVITE_CODE_UNKNOWN', 'Keine offene Partie mit diesem Code');
  await ensureNoOpenMatch(tx, userId, target.id);
  const match = await loadMatch(tx, target.id, { lock: 'UPDATE' });
  if (!match || match.status !== 'LOBBY') {
    throw new ApiError(409, 'MATCH_NOT_IN_LOBBY', 'Die Partie hat schon begonnen');
  }
  const players = await loadPlayers(tx, match.id);
  if (players.some((p) => p.userId === userId)) return { matchId: match.id }; // schon dabei
  const capacity = match.kind === 'TEST' ? (match.testSeats ?? MAX_SEATS) : MAX_SEATS;
  const used = new Set(players.map((p) => p.joinOrder));
  const joinOrder = [0, 1, 2].find((n) => n < capacity && !used.has(n));
  if (joinOrder === undefined) {
    throw new ApiError(409, 'MATCH_FULL', 'Die Partie ist voll', { seats: capacity });
  }
  await tx
    .insertInto('match_players')
    .values({ match_id: match.id, join_order: joinOrder, user_id: userId })
    .execute();
  await appendMatchEvents(tx, match.id, [{ type: 'PLAYER_JOINED', payload: { joinOrder } }]);
  return { matchId: match.id };
}

/** Verlassen der Aufstellung; verlässt der Gastgeber sie, fällt die Partie aus. */
export async function leaveLobby(
  tx: Tx,
  params: { readonly userId: string; readonly matchId: string },
): Promise<{ matchId: string }> {
  const match = await loadMatch(tx, params.matchId, { lock: 'UPDATE' });
  const players = match ? await loadPlayers(tx, params.matchId) : [];
  const me = players.find((p) => p.userId === params.userId);
  if (!match || !me) throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  if (match.status !== 'LOBBY') {
    throw new ApiError(
      409,
      'MATCH_NOT_IN_LOBBY',
      'Eine laufende Partie lässt sich nicht verlassen',
      {
        status: match.status,
      },
    );
  }
  if (match.hostUserId === params.userId) {
    await closeLobby(tx, match, await readGameNow(tx), 'HOST_LEFT');
  } else {
    await tx
      .deleteFrom('match_players')
      .where('match_id', '=', match.id)
      .where('join_order', '=', me.joinOrder)
      .execute();
    await appendMatchEvents(tx, match.id, [
      { type: 'PLAYER_LEFT', payload: { joinOrder: me.joinOrder } },
    ]);
  }
  return { matchId: match.id };
}

async function closeLobby(tx: Tx, match: MatchRow, now: Date, reason: string): Promise<void> {
  match.status = 'ABANDONED';
  match.finishedAt = now;
  await saveMatch(tx, match);
  await appendMatchEvents(tx, match.id, [{ type: 'MATCH_ABANDONED', payload: { reason } }]);
}

/**
 * Start durch den Gastgeber: Bots füllen in Testpartien die freien Plätze, die Zugreihenfolge
 * wird gelost (Strom `match`, `{match_id}.seats`), dann beginnt die Wahl der ersten Hauptstadt.
 */
export async function startLobby(
  tx: Tx,
  ctx: MatchContext,
  params: { readonly userId: string; readonly matchId: string },
): Promise<{ matchId: string }> {
  const match = await loadMatch(tx, params.matchId, { lock: 'UPDATE' });
  const humans = match ? await loadPlayers(tx, params.matchId) : [];
  if (!match || !humans.some((p) => p.userId === params.userId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  }
  if (match.hostUserId !== params.userId) {
    throw new ApiError(403, 'NOT_HOST', 'Nur der Gastgeber startet die Partie');
  }
  if (match.status !== 'LOBBY') {
    throw new ApiError(409, 'MATCH_NOT_IN_LOBBY', 'Die Partie hat schon begonnen', {
      status: match.status,
    });
  }
  let seats: 2 | 3;
  let bots: MatchBotStrengthCode[] = [];
  if (match.kind === 'TEST') {
    if (!ctx.testMatchesEnabled) {
      throw new ApiError(403, 'TEST_MATCHES_DISABLED', 'Testpartien gibt es hier nicht');
    }
    if (match.testSeats === null || match.testBotStrengths === null) {
      throw new Error('Testpartie ohne Plätze');
    }
    seats = match.testSeats;
    bots = match.testBotStrengths.slice(0, seats - humans.length);
  } else {
    if (humans.length < 2) {
      throw new ApiError(409, 'NOT_ENOUGH_PLAYERS', 'Eine Partie braucht zwei oder drei Spieler', {
        players: humans.length,
      });
    }
    seats = humans.length === 2 ? 2 : 3;
  }
  const now = await readGameNow(tx);
  // Ohne Wissens- und Schätzfragen kann die Partie nicht laufen: lieber gar nicht starten
  const userIds = humans.flatMap((p) => (p.userId === null ? [] : [p.userId]));
  for (const kind of QUESTION_KINDS) {
    const candidates = await loadCandidates(tx, {
      kind,
      userIds,
      allowFixtures: ctx.allowFixtures,
      now,
    });
    if (candidates.length === 0) {
      throw new ApiError(409, 'NO_QUESTION_AVAILABLE', 'Keine passenden Fragen vorhanden', {
        kind,
      });
    }
  }
  if (bots.length > 0) {
    await tx
      .insertInto('match_players')
      .values(
        bots.map((strength, i) => ({
          match_id: match.id,
          join_order: humans.length + i,
          bot_strength: strength,
          joined_at: now,
        })),
      )
      .execute();
  }
  const participants = await loadPlayers(tx, match.id);
  const seatEntity = `${match.id}.seats`;
  const order = drawSeatOrder(
    createRng(await deriveSeed(ctx.rngSecret, 'match', seatEntity)),
    participants.length,
  );
  for (const [seat, index] of order.entries()) {
    const participant = participants[index];
    if (!participant) throw new Error('Zugreihenfolge passt nicht zu den Teilnehmern');
    await tx
      .updateTable('match_players')
      .set({ seat })
      .where('match_id', '=', match.id)
      .where('join_order', '=', participant.joinOrder)
      .execute();
  }
  const rules = matchRulesSchema.parse(matchRulesForSeats(rulesOfPreset(match.rulesPreset), seats));
  match.status = 'RUNNING';
  match.rules = rules;
  match.state = createMatch(rules);
  match.startedAt = now;
  const seated = await loadPlayers(tx, match.id);
  const run = new MatchRun(tx, ctx, match, seated, now);
  run.emit('MATCH_STARTED', {
    seats,
    players: seated.map((p) => ({
      seat: p.seat,
      joinOrder: p.joinOrder,
      bot: p.botStrength,
    })),
    rng: { purpose: 'match', entityId: seatEntity, keyId: ctx.rngKeyId, version: RNG_VERSION },
  });
  await run.enterStep();
  await run.commit();
  return { matchId: match.id };
}

/**
 * Lässt verwaiste Aufstellungen verfallen (Ablaufsteuerung; vor Anlegen und Beitreten auch für das
 * eigene Konto). Liefert die Zahl der beendeten.
 */
export async function expireLobbies(
  db: Db,
  options: { readonly userId?: string; readonly limit?: number } = {},
): Promise<number> {
  let query = db
    .selectFrom('matches as m')
    .select('m.id')
    .where('m.status', '=', 'LOBBY')
    .where(sql<boolean>`m.created_at + ${intervalMs(LOBBY_TTL_MS)} <= game_now()`);
  if (options.userId !== undefined) {
    const userId = options.userId;
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('match_players as p')
          .select('p.match_id')
          .whereRef('p.match_id', '=', 'm.id')
          .where('p.user_id', '=', userId),
      ),
    );
  }
  const due = await query
    .orderBy('m.created_at')
    .limit(options.limit ?? 50)
    .execute();
  let expired = 0;
  for (const { id } of due) {
    await db.transaction().execute(async (tx) => {
      const match = await loadMatch(tx, id, { lock: 'UPDATE_SKIP_LOCKED' });
      if (!match || match.status !== 'LOBBY') return;
      const now = await readGameNow(tx);
      if (match.createdAt.getTime() + LOBBY_TTL_MS > now.getTime()) return;
      await closeLobby(tx, match, now, 'LOBBY_EXPIRED');
      expired++;
    });
  }
  return expired;
}
