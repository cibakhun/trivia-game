import type { Db } from '@rdw/db';
import {
  capitalLivesLeft,
  castleLivesLeft,
  castlesOf,
  currentChooser,
  isRealmSeatAlive,
  legalRegions,
  matchPoints,
  realmCurrentChooser,
  realmIncome,
  realmLegalRegions,
  realmPoints,
  realmRegionsOf,
  realmTurnOrder,
  regionsOf,
  roundOrder,
  turnOrder,
  type MatchState,
  type RealmState,
  type RealmWheel,
} from '@rdw/game-core';
import {
  isRealmRules,
  type MatchBoard,
  type MatchBotStrengthCode,
  type MatchListResponse,
  type MatchQuestionInfo,
  type MatchRealmView,
  type MatchStepView,
  type MatchTurn,
  type MatchView,
  type RealmBoard,
  type RealmOrderDto,
  type RealmStepView,
  type RealmWheelDto,
} from '@rdw/protocol';
import { readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import type { MatchContext } from './context.ts';
import { advanceMatch, isMatchDue } from './driver.ts';
import { botThinkMs } from './bot-think.ts';
import { botName } from './engine.ts';
import { loadWheelCategories, realmRulesOf, rulesOf, validFavorites } from './lobby.ts';
import {
  classicStateOf,
  lastEventSeq,
  loadMatch,
  loadPlayers,
  realmStateOf,
  type MatchPlayerRow,
  type MatchRow,
} from './store.ts';

/**
 * Ansicht einer Partie für einen Teilnehmer (API.md §2.6). Vor der Auflösung einer Frage steht
 * darin nichts über Lösung oder Antworten; Bot-Antworten erscheinen erst in `QUESTION_RESOLVED`.
 */

/** Höchstens so viele Ereignisse je Abruf. */
export const MATCH_EVENTS_PAGE = 200;
/** Beendete Partien in der Liste. */
const FINISHED_IN_LIST = 10;

function stepView(state: MatchState): MatchStepView {
  const { step } = state;
  const base: MatchStepView = {
    kind: step.kind,
    round: null,
    chooser: currentChooser(state),
    attacker: null,
    defender: null,
    region: null,
    finishReason: null,
  };
  switch (step.kind) {
    case 'CAPITAL_PICK':
      return base;
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
      return { ...base, round: step.round };
    case 'CAMPAIGN_TARGET':
      return { ...base, round: step.round, attacker: step.attacker };
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return {
        ...base,
        round: step.round,
        attacker: step.attacker,
        defender: step.defender,
        region: step.region,
      };
    case 'FINISHED':
      return { ...base, round: step.round ?? null, finishReason: step.reason };
  }
}

/**
 * Zugfolge für die Karte. Läuft die Partie nach dem letzten Duell noch (`closing`: Die letzte
 * Auflösung steht, ADR-055), bleibt die Zeile der letzten Runde stehen, alle erledigt; sonst
 * verschwände sie genau im entscheidenden Moment und die Karte spränge. Nach der Abrechnung ist
 * sie leer.
 */
function turnsView(state: MatchState, closing: boolean): MatchTurn[] {
  const { step } = state;
  if (closing && step.kind === 'FINISHED' && step.round !== undefined) {
    return roundOrder(state, step.round).map((seat) => ({ seat, status: 'DONE' }));
  }
  return turnOrder(state);
}

/** `closing`: Die Partie läuft noch (Status RUNNING), siehe `turnsView`. */
export function boardView(state: MatchState, closing = false): MatchBoard {
  return {
    map: state.rules.map,
    regions: state.regions.map((r) => ({
      owner: r.owner,
      value: r.value,
      capitalOf: r.capitalOf,
      fortifications: r.fortifications,
    })),
    seats: state.seats.map((s, seat) => ({
      seat,
      capital: s.capital,
      capitalLivesLeft: capitalLivesLeft(state, seat),
      eliminated: s.eliminatedInDuel !== null,
      points: matchPoints(state, seat),
      regions: regionsOf(state, seat).length,
    })),
    step: stepView(state),
    turns: turnsView(state, closing),
    questions: state.questions,
    duels: state.duels,
  };
}

function wheelView(wheel: RealmWheel): RealmWheelDto {
  return { ...wheel, segments: wheel.segments.map((segment) => ({ ...segment })) };
}

function realmStepView(state: RealmState): RealmStepView {
  const { step } = state;
  const base: RealmStepView = {
    kind: step.kind,
    round: null,
    chooser: realmCurrentChooser(state),
    attacker: null,
    defender: null,
    region: null,
    category: null,
    wheel: null,
    finishReason: null,
  };
  switch (step.kind) {
    case 'START_ESTIMATE':
    case 'CASTLE_PICK':
    case 'VILLAGE_PICK':
      return base;
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
    case 'PREPARE':
      // Die Befehle der Rüstzeit (`step.orders`) bleiben bis zum Aufdecken beim Server
      return { ...base, round: step.round };
    case 'CAMPAIGN_TARGET':
      return { ...base, round: step.round, attacker: step.attacker };
    case 'DUEL_WHEEL':
      return {
        ...base,
        round: step.round,
        attacker: step.attacker,
        defender: step.defender,
        region: step.region,
        wheel: wheelView(step.wheel),
      };
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return {
        ...base,
        round: step.round,
        attacker: step.attacker,
        defender: step.defender,
        region: step.region,
        category: step.category,
        wheel: wheelView(step.wheel),
      };
    case 'FINISHED':
      return { ...base, round: step.round, finishReason: step.reason };
  }
}

/** Eigene Befehle der laufenden Rüstzeit, sobald sie abgegeben sind; sonst `null`. */
function myOrdersOf(state: RealmState, mySeat: number | null): RealmOrderDto[] | null {
  const { step } = state;
  if (step.kind !== 'PREPARE' || mySeat === null || !isRealmSeatAlive(state, mySeat)) return null;
  const orders = step.orders[mySeat];
  return orders ? [...orders] : null;
}

/** Wie `turnsView`: Nach dem letzten Duell bleibt die Zeile der letzten Runde stehen (ADR-055). */
function realmTurnsView(state: RealmState, closing: boolean): MatchTurn[] {
  const { step } = state;
  if (closing && step.kind === 'FINISHED') {
    return step.attackers
      .filter((seat) => isRealmSeatAlive(state, seat))
      .map((seat) => ({ seat, status: 'DONE' }));
  }
  return realmTurnOrder(state);
}

/** Karte der Partie mit Ausbau; `closing` wie bei `boardView`. */
export function realmBoardView(state: RealmState, closing = false): RealmBoard {
  return {
    map: state.rules.map,
    regions: state.regions.map((r, id) => ({
      owner: r.owner,
      value: r.value,
      fortifications: r.fortifications,
      building: r.building,
      castleLivesLeft: castleLivesLeft(state, id),
      startCastleOf: r.startCastleOf,
      armies: r.armies,
    })),
    seats: state.seats.map((s, seat) => {
      const castles = castlesOf(state, seat);
      return {
        seat,
        favorites: [...s.favorites],
        bread: s.bread,
        material: s.material,
        income: realmIncome(state, seat),
        startCastle: s.startCastle,
        castles: castles.length,
        castleLivesLeft: castles.reduce((sum, id) => sum + castleLivesLeft(state, id), 0),
        eliminated: s.eliminatedInDuel !== null,
        points: realmPoints(state, seat),
        regions: realmRegionsOf(state, seat).length,
      };
    }),
    order: [...state.order],
    step: realmStepView(state),
    turns: realmTurnsView(state, closing),
    questions: state.questions,
    duels: state.duels,
  };
}

/**
 * Namen der Bots: „Bot (mittel)“; spielen zwei gleich starke mit, bekommen sie Nummern, damit man
 * sie in Zugfolge und Verlauf unterscheiden kann.
 */
function botNames(players: readonly MatchPlayerRow[]): Map<number, string> {
  const names = new Map<number, string>();
  const bots = players.filter((p) => p.botStrength !== null);
  for (const bot of bots) {
    if (bot.botStrength === null) continue;
    const same = bots.filter((other) => other.botStrength === bot.botStrength);
    names.set(
      bot.joinOrder,
      botName(bot.botStrength, same.length > 1 ? same.indexOf(bot) + 1 : undefined),
    );
  }
  return names;
}

async function questionInfo(
  db: Db,
  match: MatchRow,
  mySeat: number | null,
  now: Date,
): Promise<MatchQuestionInfo | null> {
  if (match.questionSeq === null) return null;
  const question = await db
    .selectFrom('match_questions')
    .select([
      'seq',
      'kind',
      'purpose',
      'seats',
      'time_limit_ms',
      'opened_at',
      'closes_at',
      'resolved_at',
    ])
    .where('match_id', '=', match.id)
    .where('seq', '=', match.questionSeq)
    .executeTakeFirst();
  if (!question) return null;
  const answers = await db
    .selectFrom('match_answers')
    .select(['seat', 'status', 'effective_ms'])
    .where('match_id', '=', match.id)
    .where('seq', '=', question.seq)
    .execute();
  let myStatus: MatchQuestionInfo['myStatus'] = 'NOT_PARTICIPATING';
  if (mySeat !== null && question.seats.includes(mySeat)) {
    const status = answers.find((a) => a.seat === mySeat)?.status;
    myStatus =
      status === 'PRESENTED' || status === 'ANSWERED' || status === 'MISSED'
        ? status
        : 'NOT_PRESENTED';
  }
  const resolved = question.resolved_at !== null;
  const openMs = now.getTime() - question.opened_at.getTime();
  const answered = answers
    .filter((a) => {
      if (a.status === 'ANSWERED') return true;
      if (a.status !== 'GENERATED') return false;
      // Bot: Die Antwort steht fest, zu sehen ist sie erst nach seiner Bedenkzeit
      const thinkMs =
        a.effective_ms ?? botThinkMs(match.id, question.seq, a.seat, question.time_limit_ms);
      return resolved || openMs >= thinkMs;
    })
    .map((a) => a.seat)
    .filter((seat) => question.seats.includes(seat))
    .sort((a, b) => a - b);
  return {
    seq: question.seq,
    kind: question.kind === 'ESTIMATE' ? 'ESTIMATE' : 'TRIVIA',
    purpose:
      question.purpose === 'DUEL_TRIVIA' ||
      question.purpose === 'DUEL_ESTIMATE' ||
      question.purpose === 'START'
        ? question.purpose
        : 'LAND',
    seats: question.seats,
    answered,
    closesAt: question.closes_at.toISOString(),
    resolved,
    myStatus,
  };
}

export async function matchView(
  db: Db,
  ctx: MatchContext,
  params: { readonly userId: string; readonly matchId: string; readonly after: number },
): Promise<MatchView> {
  // Fällige Schritte zuerst nachholen, damit niemand auf die Ablaufsteuerung warten muss
  if (await isMatchDue(db, params.matchId)) await advanceMatch(db, ctx, params.matchId);
  const match = await loadMatch(db, params.matchId);
  const players = match ? await loadPlayers(db, params.matchId) : [];
  const me = players.find((p) => p.userId === params.userId);
  if (!match || !me) throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');

  const userIds = players.flatMap((p) => (p.userId === null ? [] : [p.userId]));
  const profiles = await db
    .selectFrom('player_profiles')
    .select(['user_id', 'display_name'])
    .where('user_id', 'in', userIds)
    .execute();
  const names = new Map(profiles.map((p) => [p.user_id, p.display_name]));
  const bots = botNames(players);
  const events = await db
    .selectFrom('match_events')
    .select(['seq', 'type', 'payload', 'at'])
    .where('match_id', '=', match.id)
    .where('seq', '>', params.after)
    .orderBy('seq')
    .limit(MATCH_EVENTS_PAGE)
    .execute();
  const now = await readGameNow(db);
  const mySeat = me.seat;
  const rules = match.rules ?? rulesOf(match.mode, match.rulesPreset);
  const { timers } = rules;
  const running = match.status === 'RUNNING';
  const picking = running && match.phase === 'PICK' && mySeat !== null;
  let board: MatchBoard | null = null;
  let realm: MatchRealmView | null = null;
  let legal: number[] = [];
  /** In der Aufstellung mit Ausbau: Kategorien, die gerade wählbar sind. */
  let lobbyWheel: { categories: MatchRealmView['categories']; count: number } | null = null;
  if (match.mode === 'REALM') {
    const state = realmStateOf(match);
    const economy = isRealmRules(rules) ? rules.economy : realmRulesOf(match.rulesPreset).economy;
    // Vor dem Start die Kategorien, die gerade genug Fragen haben; danach die der Partie
    const categories = state
      ? [...state.categories]
      : await loadWheelCategories(db, ctx, { userIds, now });
    if (!state) lobbyWheel = { categories, count: economy.favorites };
    realm = {
      categories,
      favoritesCount: economy.favorites,
      campaignRounds: rules.campaign.rounds,
      economy,
      board: state ? realmBoardView(state, running) : null,
      // Nur die eigenen Befehle; wer sonst fertig ist, zeigt `board.turns`
      myOrders: state && running ? myOrdersOf(state, mySeat) : null,
    };
    if (state && picking && realmCurrentChooser(state) === mySeat) legal = realmLegalRegions(state);
  } else {
    const state = classicStateOf(match);
    board = state ? boardView(state, running) : null;
    if (state && picking && currentChooser(state) === mySeat) legal = legalRegions(state);
  }

  return {
    match: {
      id: match.id,
      kind: match.kind,
      mode: match.mode,
      status: match.status,
      inviteCode: match.status === 'LOBBY' ? match.inviteCode : null,
      rulesPreset: match.rulesPreset,
      seats: match.rules?.seats ?? match.testSeats,
      timers: {
        triviaMs: timers.triviaMs,
        estimateMs: timers.estimateMs,
        pickMs: timers.pickMs,
        revealMs: timers.revealMs,
        announceMs: timers.announceMs ?? 0,
        pickShowMs: timers.pickShowMs ?? 0,
      },
      createdAt: match.createdAt.toISOString(),
      startedAt: match.startedAt?.toISOString() ?? null,
      finishedAt: match.finishedAt?.toISOString() ?? null,
    },
    players: players.map((p) => ({
      joinOrder: p.joinOrder,
      seat: p.seat,
      name:
        bots.get(p.joinOrder) ??
        (p.userId !== null ? names.get(p.userId) : undefined) ??
        `Spieler ${p.joinOrder + 1}`,
      isBot: p.botStrength !== null,
      botStrength: p.botStrength,
      isHost: p.userId === match.hostUserId,
      isMe: p.userId === params.userId,
      // In der Aufstellung nur eine Wahl, die gerade gilt; ab dem Start die der Partie
      favorites: lobbyWheel
        ? validFavorites(p.favorites, lobbyWheel.categories, lobbyWheel.count)
        : match.mode === 'REALM' && p.favorites
          ? [...p.favorites]
          : null,
    })),
    mySeat,
    isHost: match.hostUserId === params.userId,
    board,
    realm,
    phase:
      match.phase !== null && match.phaseDeadlineAt !== null
        ? {
            kind: match.phase,
            deadline: match.phaseDeadlineAt.toISOString(),
            remainingMs: Math.max(0, match.phaseDeadlineAt.getTime() - now.getTime()),
          }
        : null,
    legalRegions: legal,
    question: await questionInfo(db, match, mySeat, now),
    events: events.map((e) => ({
      seq: e.seq,
      type: e.type,
      payload: e.payload as Record<string, unknown>,
      at: e.at.toISOString(),
    })),
    lastEventSeq: await lastEventSeq(db, match.id),
    serverTime: now.toISOString(),
  };
}

/** Ereignisse, die eine Partie mit Abrechnung beenden; ihr Inhalt trägt die Plätze. */
const FINISH_EVENTS = ['MATCH_FINISHED', 'REALM_MATCH_FINISHED'] as const;

/** Eigener Platz aus der Abrechnung (`standings` im Ereignis); `null`, wenn er dort fehlt. */
export function placeOf(payload: unknown, seat: number | null): number | null {
  if (seat === null || typeof payload !== 'object' || payload === null) return null;
  const standings = (payload as { standings?: unknown }).standings;
  if (!Array.isArray(standings)) return null;
  for (const entry of standings as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { seat: s, place } = entry as { seat?: unknown; place?: unknown };
    if (s === seat && typeof place === 'number' && Number.isInteger(place) && place >= 1) {
      return Math.min(3, place);
    }
  }
  return null;
}

/** Eigene Wissensfragen je Partie: beantwortet mit Wertung und davon richtig. */
async function triviaCounts(
  db: Db,
  userId: string,
  matchIds: readonly string[] | null,
): Promise<Map<string, { answered: number; correct: number }>> {
  let query = db
    .selectFrom('match_answers as a')
    .innerJoin('match_players as me', (join) =>
      join
        .onRef('me.match_id', '=', 'a.match_id')
        .onRef('me.seat', '=', 'a.seat')
        .on('me.user_id', '=', userId),
    )
    .innerJoin('match_questions as q', (join) =>
      join.onRef('q.match_id', '=', 'a.match_id').onRef('q.seq', '=', 'a.seq'),
    )
    .innerJoin('matches as m', 'm.id', 'a.match_id')
    .select((eb) => [
      'a.match_id',
      eb.fn.countAll<string>().as('answered'),
      eb.fn.count<string>('a.is_correct').filterWhere('a.is_correct', '=', true).as('correct'),
    ])
    .where('q.kind', '=', 'TRIVIA')
    .where('a.is_correct', 'is not', null)
    .groupBy('a.match_id');
  if (matchIds === null) query = query.where('m.status', '=', 'FINISHED');
  else if (matchIds.length === 0) return new Map();
  else query = query.where('a.match_id', 'in', matchIds);
  const rows = await query.execute();
  return new Map(
    rows.map((r) => [r.match_id, { answered: Number(r.answered), correct: Number(r.correct) }]),
  );
}

export async function listMatches(
  db: Db,
  ctx: MatchContext,
  userId: string,
): Promise<MatchListResponse> {
  const rows = await db
    .selectFrom('matches as m')
    .innerJoin('match_players as me', (join) =>
      join.onRef('me.match_id', '=', 'm.id').on('me.user_id', '=', userId),
    )
    .select([
      'm.id',
      'm.kind',
      'm.mode',
      'm.status',
      'm.invite_code',
      'm.host_user_id',
      'm.created_at',
      'm.finished_at',
      'me.seat',
      'me.join_order',
    ])
    .orderBy('m.created_at', 'desc')
    .limit(FINISHED_IN_LIST + 1)
    .execute();
  const ids = rows.map((r) => r.id);
  const players =
    ids.length === 0
      ? []
      : await db
          .selectFrom('match_players as p')
          .leftJoin('player_profiles as pp', 'pp.user_id', 'p.user_id')
          .select(['p.match_id', 'p.join_order', 'p.user_id', 'p.bot_strength', 'pp.display_name'])
          .where('p.match_id', 'in', ids)
          .orderBy('p.join_order')
          .execute();
  const finals =
    ids.length === 0
      ? []
      : await db
          .selectFrom('match_events')
          .select(['match_id', 'payload'])
          .where('match_id', 'in', ids)
          .where('type', 'in', FINISH_EVENTS)
          .execute();
  const finalOf = new Map(finals.map((f) => [f.match_id, f.payload]));
  const trivia = await triviaCounts(db, userId, ids);

  // Eigene Zahlen über alle beendeten Partien (nicht nur die gelisteten)
  const done = await db
    .selectFrom('matches as m')
    .innerJoin('match_players as me', (join) =>
      join.onRef('me.match_id', '=', 'm.id').on('me.user_id', '=', userId),
    )
    .leftJoin('match_events as e', (join) =>
      join.onRef('e.match_id', '=', 'm.id').on('e.type', 'in', FINISH_EVENTS),
    )
    .select(['m.id', 'me.seat', 'e.payload'])
    .where('m.status', '=', 'FINISHED')
    .execute();
  const allTrivia = await triviaCounts(db, userId, null);
  let answered = 0;
  let correct = 0;
  for (const counts of allTrivia.values()) {
    answered += counts.answered;
    correct += counts.correct;
  }

  return {
    matches: rows.map((row) => {
      const others = players.filter((p) => p.match_id === row.id && p.user_id !== userId);
      const bots = botNames(
        players
          .filter((p) => p.match_id === row.id)
          .map((p) => ({
            joinOrder: p.join_order,
            userId: p.user_id,
            botStrength: p.bot_strength as MatchBotStrengthCode | null,
            seat: null,
            favorites: null,
            joinedAt: row.created_at,
          })),
      );
      const counts = trivia.get(row.id);
      return {
        id: row.id,
        kind: row.kind === 'TEST' ? 'TEST' : 'STANDARD',
        mode: row.mode === 'REALM' ? 'REALM' : 'CLASSIC',
        status: row.status as MatchView['match']['status'],
        inviteCode: row.status === 'LOBBY' ? row.invite_code : null,
        players: Math.min(3, Math.max(1, others.length + 1)),
        isHost: row.host_user_id === userId,
        createdAt: row.created_at.toISOString(),
        finishedAt: row.finished_at?.toISOString() ?? null,
        place: row.status === 'FINISHED' ? placeOf(finalOf.get(row.id), row.seat) : null,
        opponents: others.slice(0, 2).map((p) => ({
          name:
            p.bot_strength !== null ? (bots.get(p.join_order) ?? null) : (p.display_name ?? null),
          botStrength: p.bot_strength as MatchBotStrengthCode | null,
        })),
        answered: counts?.answered ?? 0,
        correct: counts?.correct ?? 0,
      };
    }),
    record: {
      played: done.length,
      won: done.filter((d) => placeOf(d.payload, d.seat) === 1).length,
      answered,
      correct,
    },
    testMatchesEnabled: ctx.testMatchesEnabled,
    realmMatchesEnabled: ctx.realmMatchesEnabled,
  };
}
