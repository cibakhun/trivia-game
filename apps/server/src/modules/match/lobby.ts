import type { Db, Tx } from '@rdw/db';
import {
  chooseRealmFavoritesForBot,
  createMatch,
  createRealm,
  createRng,
  deriveSeed,
  drawSeatOrder,
  RNG_VERSION,
} from '@rdw/game-core';
import {
  DEFAULT_MATCH_RULES,
  DEFAULT_REALM_RULES,
  HOUR_MS,
  INVITE_CODE_ALPHABET,
  isRealmRules,
  matchRulesForSeats,
  matchRulesSchema,
  PLAYTEST_MATCH_RULES,
  PLAYTEST_REALM_RULES,
  QUESTION_CATEGORIES,
  QUESTION_KINDS,
  type MatchBotStrengthCode,
  type MatchCreateRequest,
  type MatchMode,
  type MatchRules,
  type MatchRulesPreset,
  type QuestionCategory,
  type RealmRules,
} from '@rdw/protocol';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { intervalMs, readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import { loadCandidates } from '../quiz/questions.ts';
import type { MatchContext } from './context.ts';
import { newMatchId } from './engine.ts';
import { openRun } from './runs.ts';
import {
  appendMatchEvents,
  loadMatch,
  loadPlayers,
  openMatchOf,
  saveMatch,
  type MatchPlayerRow,
  type MatchRow,
} from './store.ts';

/**
 * Aufstellung einer Partie (MATCH_RULES §3.1 und §11.1, API.md §2.6): anlegen, mit dem
 * Einladungscode beitreten, freie Plätze mit Bots besetzen, Lieblingskategorien wählen (mit
 * Ausbau), verlassen, starten. Jedes Konto ist höchstens in einer offenen Partie; Aufstellungen
 * verfallen nach `LOBBY_TTL_MS`.
 */

/** Eine Aufstellung, die so lange nicht gestartet wurde, verfällt [E]. */
export const LOBBY_TTL_MS = 2 * HOUR_MS;
/** Plätze einer normalen Partie höchstens (MATCH_RULES §8). */
const MAX_SEATS = 3;
const JOIN_ORDERS = [0, 1, 2] as const;

/** Freie Plätze der Aufstellung, aufsteigend. */
function freeJoinOrders(players: readonly MatchPlayerRow[], capacity: number): number[] {
  const used = new Set(players.map((p) => p.joinOrder));
  return JOIN_ORDERS.filter((n) => n < capacity && !used.has(n));
}
const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_ATTEMPTS = 10;

/** Regeln einer Spielart mit Standard- oder Spieltestzeiten, für drei Spieler. */
export function rulesOf(mode: MatchMode, preset: MatchRulesPreset): MatchRules {
  return mode === 'REALM' ? realmRulesOf(preset) : classicRulesOf(preset);
}

function classicRulesOf(preset: MatchRulesPreset): MatchRules {
  return preset === 'PLAYTEST' ? PLAYTEST_MATCH_RULES : DEFAULT_MATCH_RULES;
}

export function realmRulesOf(preset: MatchRulesPreset): RealmRules {
  return preset === 'PLAYTEST' ? PLAYTEST_REALM_RULES : DEFAULT_REALM_RULES;
}

/**
 * Kategorien des Glücksrads (MATCH_RULES §11.6): die mit mindestens
 * `realmMinCategoryQuestions` Wissensfragen, die sich diesen Spielern stellen lassen, in der
 * Reihenfolge von `QUESTION_CATEGORIES`. Nur sie sind als Lieblingskategorien wählbar.
 */
export async function loadWheelCategories(
  db: Db | Tx,
  ctx: MatchContext,
  params: { readonly userIds: readonly string[]; readonly now: Date },
): Promise<QuestionCategory[]> {
  const candidates = await loadCandidates(db, {
    kind: 'TRIVIA',
    userIds: params.userIds,
    allowFixtures: ctx.allowFixtures,
    now: params.now,
  });
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  return QUESTION_CATEGORIES.filter((c) => (counts.get(c) ?? 0) >= ctx.realmMinCategoryQuestions);
}

/**
 * Die gespeicherte Wahl eines Platzes, wenn sie gilt: genau `count` verschiedene Kategorien des
 * Glücksrads. Sonst `null`; dieser Platz bekommt beim Start zufällige.
 */
export function validFavorites(
  stored: readonly QuestionCategory[] | null,
  categories: readonly QuestionCategory[],
  count: number,
): QuestionCategory[] | null {
  if (stored === null || stored.length !== count || new Set(stored).size !== count) return null;
  return stored.every((c) => categories.includes(c)) ? [...stored] : null;
}

/** Lieblingskategorien, die sich das Konto aus der letzten Partie gemerkt hat. */
async function rememberedFavorites(tx: Tx, userId: string): Promise<string[] | null> {
  const row = await tx
    .selectFrom('player_settings')
    .select('match_favorites')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.match_favorites ?? null;
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
  const mode = request.mode ?? 'CLASSIC';
  if (mode === 'REALM' && !ctx.realmMatchesEnabled) {
    throw new ApiError(403, 'REALM_MATCHES_DISABLED', 'Partien mit Ausbau gibt es hier noch nicht');
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
        mode,
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
        .values({
          match_id: matchId,
          join_order: 0,
          user_id: userId,
          favorites: mode === 'REALM' ? await rememberedFavorites(tx, userId) : null,
        })
        .execute();
      await appendMatchEvents(tx, matchId, [
        {
          type: 'MATCH_CREATED',
          payload: {
            kind: request.kind,
            rulesPreset: request.rules ?? 'DEFAULT',
            seats: test?.seats ?? null,
            mode,
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
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  let joinOrder = freeJoinOrders(players, capacity)[0];
  if (joinOrder === undefined) {
    // Menschen gehen vor: Ist kein Platz frei, weicht der Bot auf dem hintersten Platz (ADR-052)
    const bot = players.findLast((p) => p.botStrength !== null);
    if (!bot) throw new ApiError(409, 'MATCH_FULL', 'Die Partie ist voll', { seats: capacity });
    await tx
      .deleteFrom('match_players')
      .where('match_id', '=', match.id)
      .where('join_order', '=', bot.joinOrder)
      .execute();
    events.push({
      type: 'PLAYER_LEFT',
      payload: { joinOrder: bot.joinOrder, bot: bot.botStrength },
    });
    joinOrder = bot.joinOrder;
  }
  await tx
    .insertInto('match_players')
    .values({
      match_id: match.id,
      join_order: joinOrder,
      user_id: userId,
      favorites: match.mode === 'REALM' ? await rememberedFavorites(tx, userId) : null,
    })
    .execute();
  events.push({ type: 'PLAYER_JOINED', payload: { joinOrder } });
  await appendMatchEvents(tx, match.id, events);
  return { matchId: match.id };
}

/**
 * Der Gastgeber setzt in der Aufstellung einer normalen Partie einen Bot auf einen freien Platz,
 * ändert dessen Stärke oder macht den Platz mit `strength: null` wieder frei (ADR-052). Plätze
 * von Menschen bleiben unberührt; in Testpartien füllen Bots die Plätze beim Start von selbst.
 */
export async function setSeatBot(
  tx: Tx,
  params: {
    readonly userId: string;
    readonly matchId: string;
    readonly joinOrder: number;
    readonly strength: MatchBotStrengthCode | null;
  },
): Promise<{ matchId: string }> {
  const { joinOrder, strength } = params;
  const match = await loadMatch(tx, params.matchId, { lock: 'UPDATE' });
  const players = match ? await loadPlayers(tx, params.matchId) : [];
  if (!match || !players.some((p) => p.userId === params.userId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  }
  if (match.hostUserId !== params.userId) {
    throw new ApiError(403, 'NOT_HOST', 'Nur der Gastgeber besetzt Plätze mit Bots');
  }
  if (match.status !== 'LOBBY') {
    throw new ApiError(409, 'MATCH_NOT_IN_LOBBY', 'Die Partie hat schon begonnen', {
      status: match.status,
    });
  }
  const current = players.find((p) => p.joinOrder === joinOrder);
  if (match.kind !== 'STANDARD' || joinOrder >= MAX_SEATS || (current && current.userId !== null)) {
    throw new ApiError(
      409,
      'SEAT_NOT_AVAILABLE',
      'Dieser Platz lässt sich nicht mit einem Bot besetzen',
      {
        joinOrder,
      },
    );
  }
  if ((current?.botStrength ?? null) === strength) return { matchId: match.id }; // schon so
  if (current) {
    await tx
      .deleteFrom('match_players')
      .where('match_id', '=', match.id)
      .where('join_order', '=', joinOrder)
      .execute();
  }
  if (strength !== null) {
    await tx
      .insertInto('match_players')
      .values({ match_id: match.id, join_order: joinOrder, bot_strength: strength })
      .execute();
  }
  await appendMatchEvents(tx, match.id, [
    strength !== null
      ? { type: 'PLAYER_JOINED', payload: { joinOrder, bot: strength } }
      : { type: 'PLAYER_LEFT', payload: { joinOrder, bot: current?.botStrength ?? null } },
  ]);
  return { matchId: match.id };
}

/**
 * Eigene Lieblingskategorien in der Aufstellung einer Partie mit Ausbau (MATCH_RULES §11.1): genau
 * `economy.favorites` verschiedene Kategorien des Glücksrads. Das Konto merkt sie sich für die
 * nächste Aufstellung.
 */
export async function setFavorites(
  tx: Tx,
  ctx: MatchContext,
  params: {
    readonly userId: string;
    readonly matchId: string;
    readonly categories: readonly QuestionCategory[];
  },
): Promise<{ matchId: string }> {
  const match = await loadMatch(tx, params.matchId, { lock: 'UPDATE' });
  const players = match ? await loadPlayers(tx, params.matchId) : [];
  const me = players.find((p) => p.userId === params.userId);
  if (!match || !me) throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  if (match.status !== 'LOBBY') {
    throw new ApiError(409, 'MATCH_NOT_IN_LOBBY', 'Die Partie hat schon begonnen', {
      status: match.status,
    });
  }
  if (match.mode !== 'REALM') {
    throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Diese Partie hat keine Lieblingskategorien');
  }
  const count = realmRulesOf(match.rulesPreset).economy.favorites;
  const categories = await loadWheelCategories(tx, ctx, {
    userIds: players.flatMap((p) => (p.userId === null ? [] : [p.userId])),
    now: await readGameNow(tx),
  });
  const favorites = validFavorites(params.categories, categories, count);
  if (favorites === null) {
    throw new ApiError(
      422,
      'INVALID_FAVORITES',
      `Wähle genau ${count} verschiedene Kategorien des Glücksrads`,
      { count, categories },
    );
  }
  await tx
    .updateTable('match_players')
    .set({ favorites })
    .where('match_id', '=', match.id)
    .where('join_order', '=', me.joinOrder)
    .execute();
  await tx
    .updateTable('player_settings')
    .set({ match_favorites: favorites })
    .where('user_id', '=', params.userId)
    .execute();
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
 * Start durch den Gastgeber: In Testpartien füllen Bots die freien Plätze, in normalen spielen die
 * Bots mit, die der Gastgeber gesetzt hat (ADR-052). Die Spielerzahl bestimmt Karte und
 * Landnahme (`matchRulesForSeats`), die Zugreihenfolge wird gelost (Strom `match`,
 * `{match_id}.seats`), dann beginnt die Wahl der ersten Hauptstadt.
 *
 * Mit Ausbau (MATCH_RULES §11.1) legt der Start außerdem das Glücksrad fest (Kategorien mit genug
 * Wissensfragen) und die Lieblingskategorien je Sitz: die in der Aufstellung gewählten, sonst
 * zufällige (Bots und wer nicht gewählt hat; Strom `match`, `{match_id}.favorites.j{Platz}`). Dann
 * beginnt die Startfrage.
 */
export async function startLobby(
  tx: Tx,
  ctx: MatchContext,
  params: { readonly userId: string; readonly matchId: string },
): Promise<{ matchId: string }> {
  const match = await loadMatch(tx, params.matchId, { lock: 'UPDATE' });
  const joined = match ? await loadPlayers(tx, params.matchId) : [];
  const humans = joined.filter((p) => p.userId !== null);
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
  // Bots, die erst der Start auf freie Plätze setzt (Testpartie)
  let bots: { joinOrder: number; strength: MatchBotStrengthCode }[] = [];
  if (match.kind === 'TEST') {
    if (!ctx.testMatchesEnabled) {
      throw new ApiError(403, 'TEST_MATCHES_DISABLED', 'Testpartien gibt es hier nicht');
    }
    if (match.testSeats === null || match.testBotStrengths === null) {
      throw new Error('Testpartie ohne Plätze');
    }
    seats = match.testSeats;
    const free = freeJoinOrders(joined, MAX_SEATS);
    bots = match.testBotStrengths.slice(0, seats - joined.length).flatMap((strength, i) => {
      const joinOrder = free[i];
      return joinOrder === undefined ? [] : [{ joinOrder, strength }];
    });
  } else {
    // Mitspieler sind Menschen und die Bots, die der Gastgeber gesetzt hat
    if (joined.length < 2) {
      throw new ApiError(409, 'NOT_ENOUGH_PLAYERS', 'Eine Partie braucht zwei oder drei Spieler', {
        players: joined.length,
      });
    }
    seats = joined.length === 2 ? 2 : 3;
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
        bots.map(({ joinOrder, strength }) => ({
          match_id: match.id,
          join_order: joinOrder,
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
  const rules = matchRulesSchema.parse(
    matchRulesForSeats(rulesOf(match.mode, match.rulesPreset), seats),
  );
  let realm: { categories: QuestionCategory[]; favorites: Map<number, QuestionCategory[]> } | null =
    null;
  if (match.mode === 'REALM') {
    if (!ctx.realmMatchesEnabled) {
      throw new ApiError(
        403,
        'REALM_MATCHES_DISABLED',
        'Partien mit Ausbau gibt es hier noch nicht',
      );
    }
    if (!isRealmRules(rules)) throw new Error('Partie mit Ausbau ohne Regeln des Ausbaus');
    const count = rules.economy.favorites;
    const categories = await loadWheelCategories(tx, ctx, { userIds, now });
    if (categories.length < count) {
      throw new ApiError(
        409,
        'NOT_ENOUGH_CATEGORIES',
        'Für das Glücksrad gibt es noch zu wenige Kategorien mit genug Fragen',
        {
          categories: categories.length,
          needed: count,
          minQuestions: ctx.realmMinCategoryQuestions,
        },
      );
    }
    const favorites = new Map<number, QuestionCategory[]>();
    for (const p of await loadPlayers(tx, match.id)) {
      if (p.seat === null) throw new Error('Teilnehmer ohne Sitz');
      let chosen = validFavorites(p.favorites, categories, count);
      if (chosen === null) {
        const entityId = `${match.id}.favorites.j${p.joinOrder}`;
        chosen = chooseRealmFavoritesForBot(
          categories,
          count,
          createRng(await deriveSeed(ctx.rngSecret, 'match', entityId)),
        );
      }
      await tx
        .updateTable('match_players')
        .set({ favorites: chosen })
        .where('match_id', '=', match.id)
        .where('join_order', '=', p.joinOrder)
        .execute();
      favorites.set(p.seat, chosen);
    }
    realm = { categories, favorites };
    match.state = createRealm(rules, {
      categories,
      favorites: Array.from({ length: seats }, (_, seat) => favorites.get(seat) ?? []),
    });
  } else {
    match.state = createMatch(rules);
  }
  match.status = 'RUNNING';
  match.rules = rules;
  match.startedAt = now;
  const seated = await loadPlayers(tx, match.id);
  const run = openRun(tx, ctx, match, seated, now);
  run.emit('MATCH_STARTED', {
    seats,
    players: seated.map((p) => ({
      seat: p.seat,
      joinOrder: p.joinOrder,
      bot: p.botStrength,
      ...(realm && p.seat !== null ? { favorites: realm.favorites.get(p.seat) ?? [] } : {}),
    })),
    mode: match.mode,
    ...(realm ? { categories: realm.categories } : {}),
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
