import type { Db } from '@rdw/db';
import {
  capitalLivesLeft,
  currentChooser,
  legalRegions,
  matchPoints,
  regionsOf,
  turnOrder,
  type MatchState,
} from '@rdw/game-core';
import type {
  MatchBoard,
  MatchListResponse,
  MatchQuestionInfo,
  MatchStepView,
  MatchView,
} from '@rdw/protocol';
import { readGameNow } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import type { MatchContext } from './context.ts';
import { advanceMatch, isMatchDue } from './driver.ts';
import { botName } from './engine.ts';
import { rulesOfPreset } from './lobby.ts';
import {
  lastEventSeq,
  loadMatch,
  loadPlayers,
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
      return { ...base, finishReason: step.reason };
  }
}

export function boardView(state: MatchState): MatchBoard {
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
    turns: turnOrder(state),
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
): Promise<MatchQuestionInfo | null> {
  if (match.questionSeq === null) return null;
  const question = await db
    .selectFrom('match_questions')
    .select(['seq', 'kind', 'purpose', 'seats', 'closes_at', 'resolved_at'])
    .where('match_id', '=', match.id)
    .where('seq', '=', match.questionSeq)
    .executeTakeFirst();
  if (!question) return null;
  let myStatus: MatchQuestionInfo['myStatus'] = 'NOT_PARTICIPATING';
  if (mySeat !== null && question.seats.includes(mySeat)) {
    const answer = await db
      .selectFrom('match_answers')
      .select('status')
      .where('match_id', '=', match.id)
      .where('seq', '=', question.seq)
      .where('seat', '=', mySeat)
      .executeTakeFirst();
    myStatus =
      answer?.status === 'PRESENTED' || answer?.status === 'ANSWERED' || answer?.status === 'MISSED'
        ? answer.status
        : 'NOT_PRESENTED';
  }
  return {
    seq: question.seq,
    kind: question.kind === 'ESTIMATE' ? 'ESTIMATE' : 'TRIVIA',
    purpose:
      question.purpose === 'DUEL_TRIVIA' || question.purpose === 'DUEL_ESTIMATE'
        ? question.purpose
        : 'LAND',
    seats: question.seats,
    closesAt: question.closes_at.toISOString(),
    resolved: question.resolved_at !== null,
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
  const state = match.state;
  const mySeat = me.seat;
  const rules = match.rules ?? rulesOfPreset(match.rulesPreset);
  const { timers } = rules;
  const choosing =
    match.status === 'RUNNING' &&
    match.phase === 'PICK' &&
    state !== null &&
    mySeat !== null &&
    currentChooser(state) === mySeat;

  return {
    match: {
      id: match.id,
      kind: match.kind,
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
    })),
    mySeat,
    isHost: match.hostUserId === params.userId,
    board: state ? boardView(state) : null,
    phase:
      match.phase !== null && match.phaseDeadlineAt !== null
        ? {
            kind: match.phase,
            deadline: match.phaseDeadlineAt.toISOString(),
            remainingMs: Math.max(0, match.phaseDeadlineAt.getTime() - now.getTime()),
          }
        : null,
    legalRegions: choosing ? legalRegions(state) : [],
    question: await questionInfo(db, match, mySeat),
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
    .select((eb) => [
      'm.id',
      'm.kind',
      'm.status',
      'm.invite_code',
      'm.host_user_id',
      'm.created_at',
      eb
        .selectFrom('match_players as p')
        .select((inner) => inner.fn.countAll<string>().as('n'))
        .whereRef('p.match_id', '=', 'm.id')
        .as('players'),
    ])
    .orderBy('m.created_at', 'desc')
    .limit(FINISHED_IN_LIST + 1)
    .execute();
  return {
    matches: rows.map((row) => ({
      id: row.id,
      kind: row.kind === 'TEST' ? 'TEST' : 'STANDARD',
      status: row.status as MatchView['match']['status'],
      inviteCode: row.status === 'LOBBY' ? row.invite_code : null,
      players: Math.min(3, Math.max(1, Number(row.players ?? 1))),
      isHost: row.host_user_id === userId,
      createdAt: row.created_at.toISOString(),
    })),
    testMatchesEnabled: ctx.testMatchesEnabled,
  };
}
