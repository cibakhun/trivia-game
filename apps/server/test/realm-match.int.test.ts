import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import {
  MATCH_BOT_PROFILES,
  REALM_FAVORITE_THETA_BONUS,
  matchMap,
  regionNeighbors,
} from '@rdw/game-core';
import {
  matchListResponseSchema,
  matchWatchResponseSchema,
  parseMatchEvent,
  PLAYTEST_REALM_RULES,
  type MatchMapId,
  type MatchView,
  type ParsedMatchEvent,
  type QuestionCategory,
  type RealmBoard,
  type RealmOrderDto,
} from '@rdw/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, runMatchDriverOnce } from '../src/index.ts';
import { ApiError } from '../src/infra/errors.ts';
import { botThinkMs } from '../src/modules/match/bot-think.ts';
import { createLobby, startLobby } from '../src/modules/match/lobby.ts';
import {
  TestClient,
  importFixtureQuestions,
  startTestServer,
  testConfig,
  type TestServer,
} from './helpers.ts';
import { matchKit, type Human } from './match-kit.ts';

/**
 * Partie mit Ausbau über die HTTP-Schnittstelle (MATCH_RULES §11, ADR-058, TEST_PLAN §7):
 * Lieblingskategorien in der Aufstellung, ganze Partien gegen Bots mit Spieltestzeiten, Rüstzeit
 * (verdeckt, Ablehnung, Zeitablauf), Glücksrad und Wiederanlauf nach einem Neustart.
 */

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
  expect(await importFixtureQuestions(server.db)).toBe(40);
  return () => server.close();
});

const {
  driverContext,
  newHuman,
  errorOf,
  key,
  createMatch,
  view,
  joinMatch,
  startMatch,
  pick,
  present,
  answer,
  answerPayload,
  unreadableEvents,
  eventTypes,
} = matchKit(() => server);

const ECONOMY = PLAYTEST_REALM_RULES.economy;
/** Kategorien mit Wissensfragen unter den Testfragen (alle außer GENERAL), wie `QUESTION_CATEGORIES`. */
const WHEEL: QuestionCategory[] = [
  'HISTORY',
  'GEOGRAPHY',
  'SCIENCE',
  'TECHNOLOGY',
  'MATHEMATICS',
  'LITERATURE',
  'ARTS_CULTURE',
  'SPORTS',
  'POLITICS_SOCIETY',
  'NATURE_ANIMALS',
];

function setFavorites(human: Human, matchId: string, categories: readonly string[]) {
  return human.client.post(`/matches/${matchId}/favorites`, {
    headers: key(),
    payload: { categories },
  });
}

function submitOrders(
  human: Human,
  matchId: string,
  orders: readonly RealmOrderDto[],
  idem = randomUUID(),
) {
  return human.client.post(`/matches/${matchId}/orders`, {
    headers: { 'idempotency-key': idem },
    payload: { orders },
  });
}

function boardOf(current: MatchView): RealmBoard {
  const board = current.realm?.board;
  if (!board) throw new Error('Karte der Partie mit Ausbau fehlt');
  return board;
}

/** Alle Ereignisse der Partie, geprüft wie im Client. */
async function events(matchId: string): Promise<ParsedMatchEvent[]> {
  const rows = await server.db
    .selectFrom('match_events')
    .select(['seq', 'type', 'payload', 'at'])
    .where('match_id', '=', matchId)
    .orderBy('seq')
    .execute();
  return rows.flatMap((r) => {
    const parsed = parseMatchEvent({
      seq: r.seq,
      type: r.type,
      payload: r.payload as Record<string, unknown>,
      at: r.at.toISOString(),
    });
    return parsed ? [parsed] : [];
  });
}

function eventsOf<T extends ParsedMatchEvent['type']>(
  all: readonly ParsedMatchEvent[],
  type: T,
): Extract<ParsedMatchEvent, { type: T }>[] {
  return all.filter((e): e is Extract<ParsedMatchEvent, { type: T }> => e.type === type);
}

interface Seat {
  readonly human: Human;
  /** Befehle dieses Spielers in der Rüstzeit; ohne Angabe gibt er eine leere Liste ab. */
  readonly orders?: (current: MatchView) => RealmOrderDto[];
  /** `false`: gibt in der Rüstzeit nichts ab und wartet auf die Frist. */
  readonly submits?: boolean;
}

/**
 * Spielt eine laufende Partie mit Ausbau weiter, bis sie endet oder `until` zutrifft: Die Spieler
 * wählen die erste erlaubte Region, antworten richtig und geben in der Rüstzeit Befehle ab; wartet
 * die Partie auf niemanden, läuft die Spielzeit bis zur Frist und die Ablaufsteuerung weiter.
 * `each` sieht jeden Stand des ersten Spielers.
 */
async function play(
  matchId: string,
  seats: readonly Seat[],
  until: (current: MatchView) => boolean = () => false,
  each: (current: MatchView) => void = () => undefined,
): Promise<MatchView> {
  const ctx = driverContext();
  const observer = seats[0]?.human;
  if (!observer) throw new Error('Keine Spieler');
  for (let i = 0; i < 2000; i++) {
    let acted = false;
    for (const seat of seats) {
      const { human } = seat;
      const current = await view(human, matchId);
      if (human === observer) each(current);
      if (current.match.status !== 'RUNNING' || until(current)) return current;
      const board = boardOf(current);
      const mine = board.turns.find((turn) => turn.seat === current.mySeat);
      if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) {
        const response = await pick(human, matchId, current.legalRegions[0] ?? -1);
        expect(response.statusCode, response.body).toBe(200);
        acted = true;
      } else if (
        current.phase?.kind === 'QUESTION' &&
        current.question?.myStatus === 'NOT_PRESENTED'
      ) {
        const { seq } = current.question;
        const presented = await present(human, matchId, seq);
        expect(presented.statusCode, presented.body).toBe(200);
        const answered = await answer(human, matchId, seq, await answerPayload(matchId, seq));
        expect(answered.statusCode, answered.body).toBe(200);
        acted = true;
      } else if (
        current.phase?.kind === 'PREPARE' &&
        mine?.status === 'NOW' &&
        seat.submits !== false
      ) {
        const response = await submitOrders(human, matchId, seat.orders?.(current) ?? []);
        expect(response.statusCode, response.body).toBe(200);
        acted = true;
      }
    }
    if (!acted) {
      const current = await view(observer, matchId);
      if (current.match.status !== 'RUNNING' || until(current)) return current;
      await advanceGameClock(server.database.pool, (current.phase?.remainingMs ?? 0) + 1);
      await runMatchDriverOnce(server.db, ctx);
    }
  }
  throw new Error('Partie endet nicht');
}

/** Legt eine Testpartie mit Ausbau gegen Bots an und startet sie. */
async function startRealmTest(
  human: Human,
  botStrengths: ('EASY' | 'MEDIUM' | 'HARD')[],
): Promise<string> {
  const matchId = await createMatch(human, {
    kind: 'TEST',
    mode: 'REALM',
    rules: 'PLAYTEST',
    seats: botStrengths.length === 1 ? 2 : 3,
    botStrengths,
  });
  const started = await startMatch(human, matchId);
  expect(started.statusCode, started.body).toBe(200);
  return matchId;
}

const inPrepare = (round: number) => (current: MatchView) =>
  current.phase?.kind === 'PREPARE' && current.realm?.board?.step.round === round;

describe('Aufstellung mit Ausbau', () => {
  it('Lieblingskategorien: wählbar sind die Kategorien des Glücksrads, das Konto merkt sie sich', async () => {
    const host = await newHuman();
    const matchId = await createMatch(host, { kind: 'STANDARD', mode: 'REALM', rules: 'PLAYTEST' });
    const lobby = await view(host, matchId);
    expect(lobby.match).toMatchObject({ mode: 'REALM', status: 'LOBBY' });
    expect(lobby.board).toBeNull();
    expect(lobby.realm).toMatchObject({
      categories: WHEEL,
      favoritesCount: 4,
      campaignRounds: 5,
      economy: ECONOMY,
      board: null,
      myOrders: null,
    });
    expect(lobby.players[0]?.favorites).toBeNull();
    const list = matchListResponseSchema.parse((await host.client.get('/matches')).json());
    expect(list.realmMatchesEnabled).toBe(true);
    expect(list.matches[0]).toMatchObject({ id: matchId, mode: 'REALM' });

    // Genau vier verschiedene, und nur vom Rad: GENERAL hat keine Wissensfrage
    for (const categories of [
      ['HISTORY', 'SPORTS', 'SCIENCE'],
      ['HISTORY', 'SPORTS', 'SCIENCE', 'GEOGRAPHY', 'LITERATURE'],
      ['HISTORY', 'SPORTS', 'SCIENCE', 'GENERAL'],
    ]) {
      expect(errorOf(await setFavorites(host, matchId, categories))).toMatchObject({
        status: 422,
        code: 'INVALID_FAVORITES',
        details: { count: 4, categories: WHEEL },
      });
    }
    expect(
      errorOf(await setFavorites(host, matchId, ['HISTORY', 'HISTORY', 'SPORTS', 'SCIENCE'])),
    ).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    const mine = ['SPORTS', 'HISTORY', 'TECHNOLOGY', 'NATURE_ANIMALS'];
    const chosen = await setFavorites(host, matchId, mine);
    expect(chosen.statusCode, chosen.body).toBe(200);

    // Wer nicht teilnimmt, sieht und ändert nichts
    const stranger = await newHuman();
    expect(errorOf(await setFavorites(stranger, matchId, mine))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });

    const guest = await newHuman();
    expect((await joinMatch(guest, lobby.match.inviteCode ?? '')).statusCode).toBe(200);
    const seen = await view(guest, matchId);
    expect(seen.players.map((p) => p.favorites)).toEqual([mine, null]);

    const started = await startMatch(host, matchId);
    expect(started.statusCode, started.body).toBe(200);
    const running = await view(host, matchId);
    expect(running.match).toMatchObject({ status: 'RUNNING', seats: 2 });
    expect(running.realm?.categories).toEqual(WHEEL);
    const board = boardOf(running);
    expect(board.map).toBe('KERNMARK');
    // Die eigene Wahl gilt; wer nicht gewählt hat, bekommt vier zufällige vom Rad
    expect(board.seats[running.mySeat ?? -1]?.favorites).toEqual(mine);
    const other = board.seats[1 - (running.mySeat ?? 0)]?.favorites ?? [];
    expect(new Set(other).size).toBe(4);
    expect(other.every((c) => WHEEL.includes(c))).toBe(true);
    expect(running.players.map((p) => p.favorites?.length)).toEqual([4, 4]);
    // Nach dem Start ist die Wahl fest
    expect(errorOf(await setFavorites(host, matchId, mine))).toMatchObject({
      status: 409,
      code: 'MATCH_NOT_IN_LOBBY',
    });

    const all = await events(matchId);
    expect(eventsOf(all, 'MATCH_CREATED')[0]?.payload).toMatchObject({ mode: 'REALM' });
    const start = eventsOf(all, 'MATCH_STARTED')[0]?.payload;
    expect(start).toMatchObject({ mode: 'REALM', seats: 2, categories: WHEEL });
    expect(start?.players.find((p) => p.seat === running.mySeat)?.favorites).toEqual(mine);
    // Die Partie beginnt mit der Startfrage an alle
    expect(running.phase?.kind).toBe('QUESTION');
    expect(running.question).toMatchObject({ seq: 1, kind: 'ESTIMATE', purpose: 'START' });
    expect(board.step).toMatchObject({ kind: 'START_ESTIMATE', chooser: null });
    expect(board.turns.map((t) => t.status)).toEqual(['NOW', 'NOW']);

    // Das Konto hat sich die Wahl gemerkt: Die nächste Aufstellung beginnt damit
    await server.db
      .updateTable('matches')
      .set({ status: 'ABANDONED', phase: null, phase_deadline_at: null, finished_at: new Date() })
      .where('id', '=', matchId)
      .execute();
    const next = await createMatch(host, { kind: 'STANDARD', mode: 'REALM' });
    expect((await view(host, next)).players[0]?.favorites).toEqual(mine);
  });

  it('ohne Ausbau gibt es weder Lieblingskategorien noch Rüstzeit', async () => {
    const human = await newHuman();
    const matchId = await createMatch(human, {
      kind: 'TEST',
      rules: 'PLAYTEST',
      seats: 2,
      botStrengths: ['EASY'],
    });
    const lobby = await view(human, matchId);
    expect(lobby.match.mode).toBe('CLASSIC');
    expect(lobby.realm).toBeNull();
    expect(lobby.players[0]?.favorites).toBeNull();
    expect(
      errorOf(await setFavorites(human, matchId, ['HISTORY', 'SPORTS', 'SCIENCE', 'GEOGRAPHY'])),
    ).toMatchObject({ status: 409, code: 'STEP_NOT_AVAILABLE' });
    expect((await startMatch(human, matchId)).statusCode).toBe(200);
    const running = await view(human, matchId);
    expect(running.realm).toBeNull();
    expect(running.board).not.toBeNull();
    expect(errorOf(await submitOrders(human, matchId, []))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
  });

  it('gesperrt, wo der Server sie nicht anbietet; kein Start ohne genug Kategorien', async () => {
    const human = await newHuman();
    const off = { ...driverContext(), realmMatchesEnabled: false };
    const refused = server.db.transaction().execute((tx) =>
      createLobby(tx, off, {
        userId: human.userId,
        request: { kind: 'STANDARD', mode: 'REALM' },
      }),
    );
    await expect(refused).rejects.toSatisfy(
      (error) => error instanceof ApiError && error.code === 'REALM_MATCHES_DISABLED',
    );

    // Die Testfragen haben je Kategorie höchstens drei Wissensfragen: Bei Bedarf vier bleibt das Rad leer
    const matchId = await createMatch(human, {
      kind: 'TEST',
      mode: 'REALM',
      seats: 2,
      botStrengths: ['EASY'],
    });
    const strict = { ...driverContext(), realmMinCategoryQuestions: 4 };
    const start = server.db
      .transaction()
      .execute((tx) => startLobby(tx, strict, { userId: human.userId, matchId }));
    await expect(start).rejects.toSatisfy(
      (error) =>
        error instanceof ApiError &&
        error.code === 'NOT_ENOUGH_CATEGORIES' &&
        error.details.categories === 0 &&
        error.details.needed === 4,
    );
    expect((await view(human, matchId)).match.status).toBe('LOBBY');
  });
});

describe('Ganze Partie mit Ausbau gegen Bots', () => {
  const auditSchema = z.object({ theta: z.number(), strength: z.string() });

  it('zu dritt: Startfrage, Burgen, Dörfer, Landnahme, fünf Runden mit Rüstzeit und Glücksrad', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM', 'HARD']);
    const phases = new Set<string>();
    const steps = new Set<string>();
    const final = await play(
      matchId,
      [
        {
          human,
          // Wer es sich leisten kann, kauft eine Armee in der Startburg
          orders: (current) => {
            const board = boardOf(current);
            const me = board.seats[current.mySeat ?? -1];
            const castle = me?.startCastle ?? null;
            const affordable =
              me !== undefined &&
              castle !== null &&
              board.regions[castle]?.building === 'CASTLE' &&
              (board.regions[castle]?.armies ?? 0) < ECONOMY.armyCap &&
              me.bread >= ECONOMY.costs.army.bread;
            return affordable ? [{ kind: 'RECRUIT', region: castle, count: 1 }] : [];
          },
        },
      ],
      undefined,
      (current) => {
        if (current.phase) phases.add(current.phase.kind);
        const board = current.realm?.board;
        if (!board) return;
        steps.add(board.step.kind);
        expect(current.board).toBeNull();
        // Wer wählt, ist am Zug; in Fragen und in der Rüstzeit wählt niemand
        if (current.phase?.kind === 'PICK') expect(board.step.chooser).not.toBeNull();
        if (current.phase?.kind === 'PREPARE') {
          expect(board.step).toMatchObject({ kind: 'PREPARE', chooser: null, wheel: null });
          expect(current.legalRegions).toEqual([]);
        }
      },
    );
    expect(final.match.status).toBe('FINISHED');
    expect(final.phase).toBeNull();
    expect([...phases].sort()).toEqual(['ANNOUNCE', 'PICK', 'PREPARE', 'QUESTION', 'REVEAL']);
    // Das Glücksrad dreht der Server sofort: Als Schritt sieht man es nie
    expect(steps.has('DUEL_WHEEL')).toBe(false);
    for (const kind of [
      'START_ESTIMATE',
      'CASTLE_PICK',
      'LAND_ESTIMATE',
      'PREPARE',
      'DUEL_TRIVIA',
    ]) {
      expect(steps.has(kind), kind).toBe(true);
    }
    const board = boardOf(final);
    expect(board.step).toMatchObject({ kind: 'FINISHED' });
    expect(board.turns).toEqual([]);

    // Jedes Ereignis passt zum Schema des Clients
    expect(await unreadableEvents(matchId)).toEqual([]);
    const types = await eventTypes(matchId);
    const all = await events(matchId);
    expect(types.slice(0, 3)).toEqual(['MATCH_CREATED', 'PLAYER_JOINED', 'MATCH_STARTED']);
    expect(types.at(-1)).toBe('REALM_MATCH_FINISHED');
    // Die Ereignisse der Partie ohne Ausbau kommen nicht vor
    for (const classic of ['CAPITAL_CHOSEN', 'DUEL_RESOLVED', 'MATCH_FINISHED']) {
      expect(types).not.toContain(classic);
    }
    const count = (type: string) => types.filter((t) => t === type).length;
    expect(count('START_RANKED')).toBe(1);
    expect(count('CASTLE_CHOSEN')).toBe(3);
    expect(count('VILLAGE_CHOSEN')).toBe(3);
    // 24 Felder, 6 für Burgen und Startdörfer; zwei Runden Landnahme vergeben 6, 12 bleiben frei
    expect(count('LAND_RANKED')).toBe(2);
    expect(count('REGION_CLAIMED')).toBe(6);

    // Reihenfolge: Burgen wie die Startfrage, Startdörfer rückwärts (MATCH_RULES §11.1)
    const order = eventsOf(all, 'START_RANKED')[0]?.payload.ranking.map((r) => r.seat) ?? [];
    expect(board.order).toEqual(order);
    expect(eventsOf(all, 'CASTLE_CHOSEN').map((e) => e.payload.seat)).toEqual(order);
    expect(eventsOf(all, 'VILLAGE_CHOSEN').map((e) => e.payload.seat)).toEqual(
      [...order].reverse(),
    );
    expect(eventsOf(all, 'CASTLE_CHOSEN').every((e) => e.payload.armies === 3)).toBe(true);

    // Runden: Einkommen, dann Rüstzeit, dann wird aufgedeckt, dann die Angriffe
    const finished = eventsOf(all, 'REALM_MATCH_FINISHED')[0]?.payload;
    const rounds = count('INCOME');
    expect(rounds).toBeGreaterThanOrEqual(1);
    expect(rounds).toBeLessThanOrEqual(5);
    if (finished?.reason === 'ROUNDS_COMPLETE') expect(rounds).toBe(5);
    for (const income of eventsOf(all, 'INCOME')) {
      const { round } = income.payload;
      const revealed = eventsOf(all, 'ORDERS_REVEALED').filter((e) => e.payload.round === round);
      const submitted = eventsOf(all, 'ORDERS_SUBMITTED').filter((e) => e.payload.round === round);
      expect(revealed.length, `Runde ${round}`).toBe(income.payload.income.length);
      // Abgegeben wird vor dem Aufdecken, und erst danach wird angegriffen
      const firstReveal = Math.min(...revealed.map((e) => e.seq));
      expect(submitted.every((e) => e.seq > income.seq && e.seq < firstReveal)).toBe(true);
      const attacks = eventsOf(all, 'TARGET_CHOSEN').filter((e) => e.payload.round === round);
      expect(attacks.every((e) => e.seq > Math.max(...revealed.map((r) => r.seq)))).toBe(true);
    }
    // Der Mensch hat Armeen gekauft: Das steht im Aufgedeckten
    const mine = eventsOf(all, 'ORDERS_REVEALED').filter((e) => e.payload.seat === final.mySeat);
    expect(mine.some((e) => e.payload.summary.recruited === 1)).toBe(true);

    // Glücksrad: jedes Duell hat sein Rad, die Kategorie steht darauf, die Frage kommt aus ihr
    const targets = eventsOf(all, 'TARGET_CHOSEN');
    const spins = eventsOf(all, 'WHEEL_SPUN');
    const duels = eventsOf(all, 'REALM_DUEL_RESOLVED');
    expect(targets.length).toBeGreaterThan(0);
    expect(spins.length).toBe(targets.length);
    expect(duels.length).toBe(targets.length);
    expect(duels.map((e) => e.payload.duel)).toEqual(duels.map((_, i) => i + 1));
    const trivia = eventsOf(all, 'QUESTION_OPENED').filter(
      (e) => e.payload.purpose === 'DUEL_TRIVIA',
    );
    expect(trivia.length).toBe(targets.length);
    // Freie Felder (O-37): ohne Verteidiger, nur der Angreifer wird gefragt, kein Stechen. Frei
    // bleibt am Ende, was niemand genommen hat
    const estimates = eventsOf(all, 'QUESTION_OPENED').filter(
      (e) => e.payload.purpose === 'DUEL_ESTIMATE',
    );
    let taken = 0;
    for (const [i, duel] of duels.entries()) {
      const target = targets[i]?.payload;
      const opened = trivia[i];
      if (!target || !opened) throw new Error('Duell unvollständig');
      const question = opened.payload;
      expect(duel.payload.defender).toBe(target.defender);
      if (target.defender === null) {
        expect(target.wheel?.defenderLots).toBe(0);
        expect(question.seats).toEqual([target.attacker]);
        expect(['CLAIMED', 'UNCLAIMED']).toContain(duel.payload.effect);
        expect(duel.payload).toMatchObject({ reason: 'TRIVIA', armyLost: null });
        expect(estimates.some((e) => e.seq > opened.seq && e.seq < duel.seq)).toBe(false);
        if (duel.payload.effect === 'CLAIMED') taken += 1;
      } else {
        expect([...question.seats].sort()).toEqual([target.attacker, target.defender].sort());
        expect(['CLAIMED', 'UNCLAIMED']).not.toContain(duel.payload.effect);
      }
    }
    expect(board.regions.filter((r) => r.owner === null)).toHaveLength(12 - taken);
    const asked = await server.db
      .selectFrom('match_questions as mq')
      .innerJoin('question_versions as v', 'v.id', 'mq.version_id')
      .innerJoin('questions as q', 'q.id', 'v.question_id')
      .select(['mq.seq', 'mq.purpose', 'q.category', 'q.id'])
      .where('mq.match_id', '=', matchId)
      .orderBy('mq.seq')
      .execute();
    const categoryOf = new Map(asked.map((row) => [row.seq, row.category]));
    for (const [i, target] of targets.entries()) {
      const wheel = target.payload.wheel;
      const spin = spins[i]?.payload;
      const question = trivia[i]?.payload;
      if (!wheel || !spin || !question) throw new Error('Glücksrad unvollständig');
      expect(spins[i]?.seq).toBe(target.seq + 1);
      expect(wheel.segments.map((s) => s.category)).toEqual(WHEEL);
      expect(wheel.total).toBe(wheel.segments.reduce((sum, s) => sum + s.weight, 0));
      expect(WHEEL).toContain(spin.category);
      expect(question.category).toBe(spin.category);
      expect(duels[i]?.payload.category).toBe(spin.category);
      // Kategorien ohne ungestellte Frage werden nicht gezogen, solange es andere gibt
      if (spin.exhausted.length < WHEEL.length) {
        expect(spin.exhausted).not.toContain(spin.category);
        expect(categoryOf.get(question.seq)).toBe(spin.category);
      }
    }
    // Keine Wissensfrage kommt zweimal, solange es ungestellte gibt
    const triviaIds = asked.filter((row) => row.purpose === 'DUEL_TRIVIA').map((row) => row.id);
    if (triviaIds.length <= 25) expect(new Set(triviaIds).size).toBe(triviaIds.length);
    expect(asked[0]).toMatchObject({ seq: 1, purpose: 'START' });

    // Bots antworten in ihren Lieblingskategorien besser, sonst und bei Schätzfragen wie üblich
    const seats = board.seats;
    const botAnswers = await server.db
      .selectFrom('match_answers as a')
      .innerJoin('match_questions as mq', (join) =>
        join.onRef('mq.match_id', '=', 'a.match_id').onRef('mq.seq', '=', 'a.seq'),
      )
      .select(['a.seq', 'a.seat', 'a.audit', 'mq.purpose'])
      .where('a.match_id', '=', matchId)
      .where('a.status', '=', 'GENERATED')
      .execute();
    expect(botAnswers.length).toBeGreaterThan(0);
    const wheelCategory = new Map(trivia.map((e) => [e.payload.seq, e.payload.category]));
    let boosted = 0;
    for (const row of botAnswers) {
      const audit = auditSchema.parse(row.audit);
      const base = MATCH_BOT_PROFILES[audit.strength as keyof typeof MATCH_BOT_PROFILES].theta;
      const category = wheelCategory.get(row.seq);
      const favorite =
        row.purpose === 'DUEL_TRIVIA' &&
        category !== undefined &&
        (seats[row.seat]?.favorites ?? []).includes(category);
      expect(audit.theta, `Frage ${row.seq}, Sitz ${row.seat}`).toBeCloseTo(
        favorite ? base + REALM_FAVORITE_THETA_BONUS : base,
      );
      if (favorite) boosted += 1;
    }
    expect(boosted).toBeGreaterThan(0);

    // Abrechnung: Plätze nach Punkten, Burgleben statt Hauptstadtleben; Testpartien zählen nicht
    expect(finished?.standings.map((s) => s.place)[0]).toBe(1);
    expect(finished?.standings.map((s) => s.points)).toEqual(
      [...(finished?.standings ?? [])].map((s) => s.points).sort((a, b) => b - a),
    );
    for (const standing of finished?.standings ?? []) {
      expect(board.seats[standing.seat]).toMatchObject({
        points: standing.points,
        regions: standing.regions,
        castleLivesLeft: standing.castleLives,
        eliminated: standing.eliminated,
      });
    }
    const statistics = await server.db
      .selectFrom('player_statistics')
      .select(['matches_played', 'matches_won'])
      .where('user_id', '=', human.userId)
      .executeTakeFirstOrThrow();
    expect(statistics).toEqual({ matches_played: 0, matches_won: 0 });
  });

  it('zu zweit auf der Kernmark; nach dem letzten Duell bleibt die Zugfolge stehen (ADR-055)', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['EASY']);
    let closing: MatchView | null = null;
    const final = await play(matchId, [{ human }], undefined, (current) => {
      const board = current.realm?.board;
      if (current.match.status === 'RUNNING' && board?.step.kind === 'FINISHED') closing = current;
    });
    expect(final.match).toMatchObject({ status: 'FINISHED', seats: 2 });
    const board = boardOf(final);
    expect(board.map).toBe('KERNMARK');
    expect(board.regions).toHaveLength(16);
    expect(await unreadableEvents(matchId)).toEqual([]);
    const types = await eventTypes(matchId);
    // 16 Felder, 4 für Burgen und Startdörfer; zwei Runden Landnahme vergeben 6, 6 bleiben frei
    expect(types.filter((t) => t === 'LAND_RANKED')).toHaveLength(2);
    expect(types.filter((t) => t === 'REGION_CLAIMED')).toHaveLength(6);
    // Die letzte Auflösung steht noch, während die Zustandsmaschine schon fertig ist
    const last = closing as MatchView | null;
    expect(last?.phase?.kind).toBe('REVEAL');
    const turns = last?.realm?.board?.turns ?? [];
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((turn) => turn.status === 'DONE')).toBe(true);
    expect(last?.question).toMatchObject({ resolved: true });
  });
});

const myAttack = (current: MatchView) =>
  current.phase?.kind === 'PICK' &&
  current.realm?.board?.step.kind === 'CAMPAIGN_TARGET' &&
  current.legalRegions.length > 0;

/** Nachbarfelder auf der Karte der Partie. */
function neighborsOf(board: RealmBoard, region: number): readonly number[] {
  return regionNeighbors(matchMap(board.map as MatchMapId), region);
}

/**
 * Befehle für die Rüstzeit: Von jedem eigenen Feld mit mehr als einer Armee zieht je eine auf jedes
 * eigene Nachbarfeld ohne Armee, das an fremdes oder freies Land grenzt. So steht nach ein, zwei
 * Runden an jeder Grenze eine Armee, und dort lässt sich angreifen (ADR-064).
 */
function toTheBorder(current: MatchView): RealmOrderDto[] {
  const board = boardOf(current);
  const mySeat = current.mySeat ?? -1;
  const left = board.regions.map((r) => (r.owner === mySeat ? r.armies : 0));
  const arriving = new Set<number>();
  const orders: RealmOrderDto[] = [];
  board.regions.forEach((from, id) => {
    if (from.owner !== mySeat) return;
    for (const to of neighborsOf(board, id)) {
      const target = board.regions[to];
      if ((left[id] ?? 0) < 2) break;
      if (!target || target.owner !== mySeat || target.armies > 0 || arriving.has(to)) continue;
      if (!neighborsOf(board, to).some((n) => board.regions[n]?.owner !== mySeat)) continue;
      orders.push({ kind: 'MOVE', from: id, to, count: 1 });
      left[id] = (left[id] ?? 0) - 1;
      arriving.add(to);
    }
  });
  return orders;
}

describe('Angriff auf ein freies Feld (O-37, ADR-062)', () => {
  /**
   * Spielt bis zu einem eigenen Angriff, bei dem ein freies Feld am eigenen Land liegt, greift es
   * an und beantwortet die Wissensfrage richtig oder falsch. Zurück kommt der Stand in der
   * Auflösung. Seit ADR-064 muss eine eigene Armee neben dem Ziel stehen: Der Spieler zieht seine
   * Armeen deshalb in jeder Rüstzeit an die Grenze (`toTheBorder`). Wo die Felder liegen, lost die
   * Partie aus: Liegt in fünf Angriffen kein freies Feld in Reichweite, beginnt eine neue Partie
   * (höchstens drei), damit der Test nicht am Zufall scheitert.
   */
  async function claim(correct: boolean) {
    for (let match = 0; match < 3; match++) {
      const found = await claimIn(correct);
      if (found) return found;
    }
    throw new Error('In drei Partien lag bei keinem Angriff ein freies Feld in Reichweite');
  }

  async function claimIn(correct: boolean) {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['EASY']);
    for (let attack = 0; attack < 5; attack++) {
      const turn = await play(matchId, [{ human, orders: toTheBorder }], myAttack);
      // Die Partie ist vorbei, bevor ein freies Feld in Reichweite lag (ein Angriff fiel aus)
      if (turn.match.status !== 'RUNNING') return null;
      const mySeat = turn.mySeat ?? -1;
      const before = boardOf(turn);
      const target = turn.legalRegions.find((id) => before.regions[id]?.owner === null);
      if (target === undefined) {
        // Kein freies Feld am eigenen Land: gewöhnlich angreifen und beim nächsten Mal schauen
        const response = await pick(human, matchId, turn.legalRegions[0] ?? -1);
        expect(response.statusCode, response.body).toBe(200);
        continue;
      }
      expect((await pick(human, matchId, target)).statusCode).toBe(200);
      const asked = await play(
        matchId,
        [{ human }],
        (current) => current.phase?.kind === 'QUESTION' && current.question !== null,
      );
      const seq = asked.question?.seq ?? -1;
      expect((await present(human, matchId, seq)).statusCode).toBe(200);
      const answered = await answer(
        human,
        matchId,
        seq,
        await answerPayload(matchId, seq, correct),
      );
      expect(answered.statusCode, answered.body).toBe(200);
      const after = await view(human, matchId);
      return { human, matchId, mySeat, target, before, asked, after, all: await events(matchId) };
    }
    return null;
  }

  it('die Wissensfrage geht an den Angreifer allein; richtig beantwortet gehört das Feld ihm', async () => {
    const { matchId, mySeat, target, before, asked, after, all } = await claim(true);
    // Ansage: kein Verteidiger, das Rad trägt nur die eigenen und die freien Lose
    const chosen = eventsOf(all, 'TARGET_CHOSEN').at(-1)?.payload;
    expect(chosen).toMatchObject({ attacker: mySeat, defender: null, region: target });
    expect(chosen?.wheel).toMatchObject({ defenderLots: 0, freeLots: ECONOMY.lots.free });
    expect(chosen?.wheel?.segments.every((s) => s.defender === 0)).toBe(true);
    // Frage: nur mein Sitz, der Schritt nennt keinen Verteidiger
    expect(asked.question).toMatchObject({
      kind: 'TRIVIA',
      purpose: 'DUEL_TRIVIA',
      seats: [mySeat],
      myStatus: 'NOT_PRESENTED',
    });
    expect(boardOf(asked).step).toMatchObject({
      kind: 'DUEL_TRIVIA',
      attacker: mySeat,
      defender: null,
      region: target,
    });
    const row = await server.db
      .selectFrom('match_questions')
      .select(['seats', 'purpose'])
      .where('match_id', '=', matchId)
      .where('seq', '=', asked.question?.seq ?? -1)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ seats: [mySeat], purpose: 'DUEL_TRIVIA' });
    // Mit der Antwort ist die Frage entschieden: Niemand sonst muss antworten
    expect(after.phase?.kind).toBe('REVEAL');
    const duel = eventsOf(all, 'REALM_DUEL_RESOLVED').at(-1)?.payload;
    expect(duel).toMatchObject({
      attacker: mySeat,
      defender: null,
      region: target,
      winner: 'ATTACKER',
      reason: 'TRIVIA',
      effect: 'CLAIMED',
      building: 'NONE',
      castleLivesLeft: null,
      regionValue: 100,
      armyLost: null,
    });
    expect(boardOf(after).regions[target]).toMatchObject({
      owner: mySeat,
      building: 'NONE',
      armies: 0,
      value: 100,
    });
    const me = (board: RealmBoard) => board.seats[mySeat];
    expect(me(boardOf(after))?.regions).toBe((me(before)?.regions ?? 0) + 1);
    expect(me(boardOf(after))?.points).toBe((me(before)?.points ?? 0) + 100);
    // Kein Stechen: Nach der Auflösung geht es mit dem nächsten Angriff oder der nächsten Runde weiter
    expect(await unreadableEvents(matchId)).toEqual([]);
  });

  it('falsch beantwortet bleibt das Feld frei, und niemand verliert etwas', async () => {
    const { human, matchId, mySeat, target, before, after, all } = await claim(false);
    const duel = eventsOf(all, 'REALM_DUEL_RESOLVED').at(-1)?.payload;
    expect(duel).toMatchObject({
      attacker: mySeat,
      defender: null,
      region: target,
      winner: 'NONE',
      reason: 'TRIVIA',
      effect: 'UNCLAIMED',
      regionValue: 100,
      armyLost: null,
    });
    const board = boardOf(after);
    expect(board.regions[target]).toEqual(before.regions[target]);
    expect(board.regions.map((r) => [r.owner, r.armies, r.value])).toEqual(
      before.regions.map((r) => [r.owner, r.armies, r.value]),
    );
    expect(board.seats[mySeat]).toMatchObject({
      regions: before.seats[mySeat]?.regions,
      points: before.seats[mySeat]?.points,
    });
    // Die Partie läuft danach regulär zu Ende
    const final = await play(matchId, [{ human }]);
    expect(final.match.status).toBe('FINISHED');
    expect(await unreadableEvents(matchId)).toEqual([]);
  });

  it('eine Frage an einen einzelnen Sitz lässt die Datenbank nur als Wissensfrage eines Duells zu', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['EASY']);
    const single = server.db
      .updateTable('match_questions')
      .set({ seats: [0] })
      .where('match_id', '=', matchId)
      .where('purpose', '=', 'START')
      .execute();
    await expect(single).rejects.toThrow(/match_questions_seats_check/);
  });
});

describe('Angriff nur mit Armee (ADR-064)', () => {
  interface StoredState {
    readonly regions: readonly { readonly owner: number | null; readonly armies: number }[];
    readonly step: { readonly orders?: readonly (readonly unknown[] | null)[] };
  }

  /**
   * Stellt die Armeen direkt im gespeicherten Zustand um, mitten in der Rüstzeit: `armiesAt` nennt
   * je eigenes Feld der genannten Sitze die neue Zahl, alle anderen Felder dieser Sitze haben
   * danach keine. Schon abgegebene Befehle dieser Sitze (die der Bots) werden geleert, damit keiner
   * Armeen zieht, die es nicht mehr gibt.
   */
  async function setArmies(
    matchId: string,
    seats: readonly number[],
    armiesAt: Readonly<Record<number, number>> = {},
  ): Promise<void> {
    const row = await server.db
      .selectFrom('matches')
      .select('state')
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    const state = row.state as unknown as StoredState;
    const regions = state.regions.map((r, id) =>
      r.owner !== null && seats.includes(r.owner) ? { ...r, armies: armiesAt[id] ?? 0 } : r,
    );
    const orders = state.step.orders?.map((list, seat) =>
      list !== null && seats.includes(seat) ? [] : list,
    );
    const step = orders ? { ...state.step, orders } : state.step;
    await server.db
      .updateTable('matches')
      .set({ state: JSON.stringify({ ...state, regions, step }) })
      .where('id', '=', matchId)
      .execute();
  }

  it('wählbar ist nur, was neben einer eigenen Armee liegt; ein anderes Feld an der Grenze lehnt der Server ab', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const mySeat = prepare.mySeat ?? -1;
    const start = boardOf(prepare);
    const mine = (id: number) => start.regions[id]?.owner === mySeat;
    const border = start.regions.flatMap((r, id) =>
      r.owner !== mySeat && neighborsOf(start, id).some(mine) ? [id] : [],
    );
    // Eine einzige Armee auf ein eigenes Feld an der Grenze; möglichst eines, das nicht die ganze
    // Grenze erreicht, damit ein Feld an der Grenze ohne Armee daneben bleibt
    const posts = start.regions.flatMap((r, id) =>
      r.owner === mySeat && neighborsOf(start, id).some((n) => !mine(n)) ? [id] : [],
    );
    const reachOf = (post: number) => border.filter((id) => neighborsOf(start, id).includes(post));
    const post = posts.find((id) => reachOf(id).length < border.length) ?? posts[0] ?? -1;
    await setArmies(matchId, [mySeat], { [post]: 1 });

    const turn = await play(matchId, [{ human }], myAttack);
    expect(boardOf(turn).step).toMatchObject({ kind: 'CAMPAIGN_TARGET', round: 1 });
    const now = boardOf(turn);
    // Der Bot kann davor ein Feld genommen oder erobert haben: gemessen am Stand von jetzt
    const reach = now.regions.flatMap((r, id) =>
      r.owner !== mySeat && neighborsOf(now, id).includes(post) ? [id] : [],
    );
    expect(now.regions[post]).toMatchObject({ owner: mySeat, armies: 1 });
    expect([...turn.legalRegions].sort((a, b) => a - b)).toEqual(reach);
    const unreached = now.regions.findIndex(
      (r, id) =>
        r.owner !== mySeat &&
        !reach.includes(id) &&
        neighborsOf(now, id).some((n) => now.regions[n]?.owner === mySeat),
    );
    // Ohne ein solches Feld prüfte der Test die Ablehnung nicht: Dann soll er scheitern statt bestehen
    expect(unreached, 'Feld an der Grenze ohne eigene Armee daneben').toBeGreaterThanOrEqual(0);
    const refused = await pick(human, matchId, unreached);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(errorOf(refused).code).toBe('INVALID_REGION');
    const picked = await pick(human, matchId, reach[0] ?? -1);
    expect(picked.statusCode, picked.body).toBe(200);
    expect(eventsOf(await events(matchId), 'ATTACK_SKIPPED')).toEqual([]);
  });

  it('wer keine Armee neben einem Ziel hat, setzt aus; die anderen greifen an', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const mySeat = prepare.mySeat ?? -1;
    await setArmies(matchId, [mySeat]);
    expect(
      boardOf(await view(human, matchId)).regions.some((r) => r.owner === mySeat && r.armies > 0),
    ).toBe(false);

    let myPicks = 0;
    const next = await play(matchId, [{ human }], inPrepare(2), (current) => {
      if (current.phase?.kind === 'PICK' && current.legalRegions.length > 0) myPicks += 1;
    });
    expect(next.phase?.kind).toBe('PREPARE');
    expect(myPicks).toBe(0);
    const all = await events(matchId);
    expect(eventsOf(all, 'ATTACK_SKIPPED').filter((e) => e.payload.attacker === mySeat)).toEqual([
      expect.objectContaining({ payload: { round: 1, attacker: mySeat } }),
    ]);
    // Ich habe in Runde 1 kein Ziel gewählt; wer angriff, war der Bot
    const attackers = eventsOf(all, 'TARGET_CHOSEN').map((e) => e.payload.attacker);
    expect(attackers).not.toContain(mySeat);
    // Der Ausfall steht nach dem Aufdecken und vor dem Einkommen der nächsten Runde
    const types = all.map((e) => e.type);
    const skippedAt = all.findIndex(
      (e) => e.type === 'ATTACK_SKIPPED' && e.payload.attacker === mySeat,
    );
    expect(types.lastIndexOf('ORDERS_REVEALED', skippedAt)).toBeGreaterThan(-1);
    expect(types.indexOf('INCOME', skippedAt)).toBeGreaterThan(skippedAt);
    expect(await unreadableEvents(matchId)).toEqual([]);
  });

  it('hat niemand ein Ziel, folgt auf das Aufdecken gleich die nächste Rüstzeit, nach der letzten die Abrechnung', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM']);
    const rounds = PLAYTEST_REALM_RULES.campaign.rounds;
    for (let round = 1; round <= rounds; round++) {
      const prepare = await play(matchId, [{ human }], inPrepare(round));
      expect(boardOf(prepare).step).toMatchObject({ kind: 'PREPARE', round });
      await setArmies(matchId, [0, 1]);
      const submitted = await submitOrders(human, matchId, []);
      expect(submitted.statusCode, submitted.body).toBe(200);
      // Das Aufgedeckte steht als Ansage; die Zustandsmaschine ist schon in der nächsten Runde
      const shown = await view(human, matchId);
      expect(shown.phase?.kind).toBe('ANNOUNCE');
      expect(boardOf(shown).step).toMatchObject(
        round < rounds ? { kind: 'PREPARE', round: round + 1 } : { kind: 'FINISHED' },
      );
      const tail = (await events(matchId)).slice(-4).map((e) => e.type);
      expect(tail.slice(0, 3)).toEqual(['ORDERS_REVEALED', 'ATTACK_SKIPPED', 'ATTACK_SKIPPED']);
      expect(tail[3]).toBe(round < rounds ? 'INCOME' : 'REALM_MATCH_FINISHED');
    }
    const final = await play(matchId, [{ human }]);
    expect(final.match.status).toBe('FINISHED');
    const all = await events(matchId);
    expect(eventsOf(all, 'ATTACK_SKIPPED')).toHaveLength(2 * rounds);
    expect(eventsOf(all, 'TARGET_CHOSEN')).toEqual([]);
    expect(eventsOf(all, 'REALM_DUEL_RESOLVED')).toEqual([]);
    expect(eventsOf(all, 'REALM_MATCH_FINISHED').at(-1)?.payload.reason).toBe('ROUNDS_COMPLETE');
    expect(boardOf(final).duels).toBe(0);
    expect(await unreadableEvents(matchId)).toEqual([]);
  });

  it('sind nur noch Bots im Spiel und alle fallen aus, läuft jede Runde mit ihren Befehlen weiter', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM', 'MEDIUM']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const mySeat = prepare.mySeat ?? -1;
    const bots = [0, 1, 2].filter((seat) => seat !== mySeat);
    const heir = bots[0] ?? -1;
    // Mein Reich ist gefallen und gehört einem Bot; niemand hat Armeen, und keiner kann welche kaufen
    const row = await server.db
      .selectFrom('matches')
      .select('state')
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    const state = row.state as unknown as {
      readonly regions: readonly { readonly owner: number | null }[];
      readonly seats: readonly object[];
      readonly rules: { readonly economy: { readonly costs: object } };
      readonly step: object;
    };
    const fallen = {
      ...state,
      regions: state.regions.map((r) => ({
        ...r,
        owner: r.owner === mySeat ? heir : r.owner,
        armies: 0,
      })),
      seats: state.seats.map((s, seat) =>
        seat === mySeat ? { ...s, eliminatedInDuel: 0, eliminatedBy: heir } : s,
      ),
      rules: {
        ...state.rules,
        economy: {
          ...state.rules.economy,
          costs: { ...state.rules.economy.costs, army: { bread: 9999, material: 9999 } },
        },
      },
      step: { ...state.step, orders: [[], [], []] },
    };
    await server.db
      .updateTable('matches')
      .set({ state: JSON.stringify(fallen) })
      .where('id', '=', matchId)
      .execute();

    const final = await play(matchId, [{ human }]);
    expect(final.match.status).toBe('FINISHED');
    const rounds = PLAYTEST_REALM_RULES.campaign.rounds;
    const all = await events(matchId);
    // In jeder Runde fallen genau die beiden Bots aus, Runde für Runde
    const twice = Array.from({ length: rounds }, (_, i) => [i + 1, i + 1]).flat();
    const skipped = eventsOf(all, 'ATTACK_SKIPPED');
    expect(skipped.map((e) => e.payload.round)).toEqual(twice);
    for (let round = 1; round <= rounds; round++) {
      const seats = skipped.filter((e) => e.payload.round === round).map((e) => e.payload.attacker);
      expect([...seats].sort((a, b) => a - b)).toEqual(bots);
    }
    expect(eventsOf(all, 'TARGET_CHOSEN')).toEqual([]);
    // Ab Runde 2 geben beide Bots in jeder Runde ab; keine Rüstzeit läuft leer bis zur Frist
    for (let round = 2; round <= rounds; round++) {
      const submitted = eventsOf(all, 'ORDERS_SUBMITTED')
        .filter((e) => e.payload.round === round)
        .map((e) => e.payload.seat);
      expect([...submitted].sort((a, b) => a - b)).toEqual(bots);
    }
    expect(eventsOf(all, 'PREPARE_CLOSED').map((e) => e.payload.round)).toEqual([1]);
    expect([...new Set(eventsOf(all, 'ORDERS_REVEALED').map((e) => e.payload.round))]).toEqual(
      Array.from({ length: rounds }, (_, i) => i + 1),
    );
    expect(await unreadableEvents(matchId)).toEqual([]);
  });
});

describe('Fragen, an denen nur Bots gefragt sind (O-43)', () => {
  it('bleiben offen, bis die Bedenkzeit der Bots um ist; so lange liest auch ein gefallenes Reich mit', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM', 'MEDIUM']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const mySeat = prepare.mySeat ?? -1;
    const heir = [0, 1, 2].find((seat) => seat !== mySeat) ?? -1;
    // Mein Reich ist gefallen und gehört einem Bot: Von jetzt an sind an jeder Frage nur Bots
    // gefragt. Auf jedem Feld steht eine Armee, damit jeder Bot ein Ziel hat (ADR-064).
    const row = await server.db
      .selectFrom('matches')
      .select('state')
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    const state = row.state as unknown as {
      readonly regions: readonly { readonly owner: number | null }[];
      readonly seats: readonly object[];
      readonly step: object;
    };
    const fallen = {
      ...state,
      regions: state.regions.map((r) => ({
        ...r,
        owner: r.owner === mySeat ? heir : r.owner,
        armies: r.owner === null ? 0 : 1,
      })),
      seats: state.seats.map((s, seat) =>
        seat === mySeat ? { ...s, eliminatedInDuel: 0, eliminatedBy: heir } : s,
      ),
      step: { ...state.step, orders: [[], [], []] },
    };
    await server.db
      .updateTable('matches')
      .set({ state: JSON.stringify(fallen) })
      .where('id', '=', matchId)
      .execute();

    const opened = await play(
      matchId,
      [{ human }],
      (current) => current.phase?.kind === 'QUESTION',
    );
    const question = opened.question;
    if (!question || opened.phase?.kind !== 'QUESTION') throw new Error('Keine Frage erreicht');
    expect(question).toMatchObject({ resolved: false, myStatus: 'NOT_PARTICIPATING' });
    expect(question.seats).not.toContain(mySeat);
    const { timers } = opened.match;
    const limit = question.kind === 'TRIVIA' ? timers.triviaMs : timers.estimateMs;
    const bots = await server.db
      .selectFrom('match_answers')
      .select(['seat', 'effective_ms'])
      .where('match_id', '=', matchId)
      .where('seq', '=', question.seq)
      .where('status', '=', 'GENERATED')
      .orderBy('seat')
      .execute();
    const seats = bots.map((bot) => bot.seat);
    expect(seats).toEqual([...question.seats].sort((a, b) => a - b));
    // Dieselbe Zeit, nach der die Ansicht einen Bot als fertig zeigt
    const think = bots.map(
      (bot) => bot.effective_ms ?? botThinkMs(matchId, question.seq, bot.seat, limit),
    );
    const slowest = Math.min(limit, Math.max(...think));
    // Die Phase endet mit dem langsamsten Bot, nicht erst mit dem Zeitlimit der Frage
    expect(opened.phase.remainingMs).toBeGreaterThan(0);
    expect(opened.phase.remainingMs).toBeLessThanOrEqual(slowest);

    // So lange liest der Mensch mit, und die Ablaufsteuerung löst nichts vor der Zeit auf
    const url = `/matches/${matchId}/questions/${question.seq}/watch`;
    const watched = await human.client.get(url);
    expect(watched.statusCode, watched.body).toBe(200);
    const read = matchWatchResponseSchema.parse(watched.json()).question;
    expect(read.seq).toBe(question.seq);
    // Die Restzeit auf der Karte zum Mitlesen zählt bis zum Ende der Frage, nicht bis zum Zeitlimit
    expect(read.timeLimitMs).toBe(limit);
    expect(read.remainingMs).toBeGreaterThan(0);
    expect(read.remainingMs).toBeLessThanOrEqual(slowest);
    const ctx = driverContext();
    await runMatchDriverOnce(server.db, ctx);
    expect((await view(human, matchId)).question).toMatchObject({
      seq: question.seq,
      resolved: false,
    });

    // Mit dem langsamsten Bot ist die Frage aufgelöst, und die Auflösung steht
    await advanceGameClock(server.database.pool, slowest + 1);
    await runMatchDriverOnce(server.db, ctx);
    const done = await view(human, matchId);
    expect(done.question).toMatchObject({ seq: question.seq, resolved: true, answered: seats });
    expect(done.phase?.kind).toBe('REVEAL');
    expect(errorOf(await human.client.get(url))).toMatchObject({
      status: 409,
      code: 'STEP_EXPIRED',
    });

    // Die Partie läuft ohne den Menschen zu Ende, jede Frage dieser Art wie diese
    const final = await play(matchId, [{ human }]);
    expect(final.match.status).toBe('FINISHED');
    expect(await unreadableEvents(matchId)).toEqual([]);
  });
});

describe('Glücksrad und Fragenbestand', () => {
  it('zieht nur Kategorien mit ungestellter Frage; sind alle leer, gilt das ganze Rad', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM']);
    await play(matchId, [{ human }], inPrepare(1));

    // Bestand festlegen, bevor das erste Rad dreht: In dieser Partie gilt jede Wissensfrage als
    // gestellt, bis auf eine einzige. Welche Kategorie leer wird, hängt so nicht am Zufall.
    const KEPT: QuestionCategory = 'SPORTS';
    const versions = await server.db
      .selectFrom('question_versions as v')
      .innerJoin('questions as q', 'q.id', 'v.question_id')
      .select(['v.id', 'v.question_id', 'q.category'])
      .where('v.kind', '=', 'TRIVIA')
      .where('v.status', '<>', 'RETIRED')
      .orderBy('v.id')
      .execute();
    const questions = [...new Map(versions.map((row) => [row.question_id, row])).values()];
    const kept = questions.find((row) => row.category === KEPT);
    if (!kept) throw new Error(`Testfragen ohne Wissensfrage in ${KEPT}`);
    const openedAt = new Date();
    const SPENT_SEQ = 1000;
    await server.db
      .insertInto('match_questions')
      .values(
        questions
          .filter((row) => row !== kept)
          .map((row, i) => ({
            match_id: matchId,
            seq: SPENT_SEQ + i,
            kind: 'TRIVIA',
            purpose: 'DUEL_TRIVIA',
            version_id: row.id,
            seats: [0, 1],
            presentation: '{}',
            time_limit_ms: 1000,
            opened_at: openedAt,
            closes_at: new Date(openedAt.getTime() + 1000),
            resolved_at: openedAt,
          })),
      )
      .execute();

    const final = await play(matchId, [{ human }]);
    expect(final.match.status).toBe('FINISHED');
    expect(await unreadableEvents(matchId)).toEqual([]);
    const spins = eventsOf(await events(matchId), 'WHEEL_SPUN').map((e) => e.payload);
    const asked = await server.db
      .selectFrom('match_questions as mq')
      .innerJoin('question_versions as v', 'v.id', 'mq.version_id')
      .innerJoin('questions as q', 'q.id', 'v.question_id')
      .select(['mq.seq', 'q.category', 'q.id'])
      .where('mq.match_id', '=', matchId)
      .where('mq.purpose', '=', 'DUEL_TRIVIA')
      .where('mq.seq', '<', SPENT_SEQ)
      .orderBy('mq.seq')
      .execute();
    // Zu zweit greift in der ersten Runde jeder einmal an: mindestens zwei Duelle
    expect(spins.length).toBeGreaterThanOrEqual(2);
    expect(asked.length).toBe(spins.length);

    // Erstes Rad: Nur eine Kategorie hat noch eine ungestellte Frage, alle anderen fallen weg
    expect(spins[0]?.round).toBe(1);
    expect(spins[0]?.category).toBe(KEPT);
    expect(spins[0]?.exhausted).toEqual(WHEEL.filter((c) => c !== KEPT));
    expect(asked[0]).toMatchObject({ id: kept.question_id, category: KEPT });
    // Danach ist jede Kategorie leer: Das ganze Rad gilt, die Frage wiederholt sich in der
    // Kategorie, die das Rad zeigt
    for (const [i, spin] of spins.entries()) {
      if (i === 0) continue;
      expect(spin.exhausted, `Rad ${i + 1}`).toEqual(WHEEL);
      expect(WHEEL).toContain(spin.category);
      expect(asked[i]?.category, `Rad ${i + 1}`).toBe(spin.category);
    }
  });
});

describe('Rüstzeit', () => {
  it('Bots sind sofort fertig; Befehle werden geprüft, bleiben verdeckt und wirken beim Aufdecken', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const mySeat = prepare.mySeat ?? -1;
    const botSeat = 1 - mySeat;
    const before = boardOf(prepare);
    expect(prepare.phase?.kind).toBe('PREPARE');
    expect(prepare.phase?.remainingMs).toBeLessThanOrEqual(ECONOMY.timers.prepareMs + 500);
    expect(prepare.phase?.remainingMs).toBeGreaterThan(ECONOMY.timers.prepareMs - 1000);
    expect(prepare.realm?.myOrders).toBeNull();
    // Der Bot hat abgegeben, der Mensch noch nicht
    expect(before.turns).toContainEqual({ seat: botSeat, status: 'DONE' });
    expect(before.turns).toContainEqual({ seat: mySeat, status: 'NOW' });
    const early = await events(matchId);
    expect(eventsOf(early, 'ORDERS_SUBMITTED').map((e) => e.payload)).toEqual([
      { round: 1, seat: botSeat },
    ]);
    expect(eventsOf(early, 'ORDERS_REVEALED')).toEqual([]);
    // Einkommen der ersten Runde: Burg, Startdorf und je Feld der Landnahme eins
    const income = eventsOf(early, 'INCOME')[0]?.payload.income.find((i) => i.seat === mySeat);
    const me = before.seats[mySeat];
    if (!me || !income) throw new Error('Sitz fehlt');
    expect(me.regions).toBeGreaterThanOrEqual(2);
    expect({ bread: me.bread, material: me.material }).toEqual({
      bread: income.bread,
      material: income.material,
    });
    expect(me.income).toEqual({ bread: income.bread, material: income.material });
    expect(me.bread + me.material).toBe(2 + 2 + ECONOMY.yields.village + (me.regions - 2));
    const castle = me.startCastle ?? -1;
    expect(before.regions[castle]).toMatchObject({
      owner: mySeat,
      building: 'CASTLE',
      castleLivesLeft: 3,
      startCastleOf: mySeat,
      armies: 3,
    });

    // In der Rüstzeit wird nicht gewählt
    expect(errorOf(await pick(human, matchId, 0))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
    // Abgelehnte Befehle nennen Grund und Stelle; nichts davon bleibt
    const foreign = before.regions.findIndex((r) => r.owner === botSeat);
    const plain = before.regions.findIndex((r) => r.owner === mySeat && r.building === 'NONE');
    const refusals: [RealmOrderDto[], string, number][] = [
      [[{ kind: 'BUILD', region: foreign }], 'NOT_OWN_REGION', 0],
      [[{ kind: 'RECRUIT', region: plain, count: 1 }], 'NOT_A_CASTLE', 0],
      [
        [
          { kind: 'RECRUIT', region: castle, count: 1 },
          { kind: 'RECRUIT', region: castle, count: 900 },
        ],
        'TOO_EXPENSIVE',
        1,
      ],
      [[{ kind: 'MOVE', from: castle, to: castle, count: 1 }], 'NOT_NEIGHBORS', 0],
      [[{ kind: 'BUILD', region: castle }], 'MAX_LEVEL', 0],
    ];
    for (const [orders, reason, index] of refusals) {
      expect(errorOf(await submitOrders(human, matchId, orders)), reason).toMatchObject({
        status: 422,
        code: 'INVALID_ORDERS',
        details: { reason, index },
      });
    }
    expect((await view(human, matchId)).realm?.myOrders).toBeNull();
    expect(
      errorOf(
        await human.client.post(`/matches/${matchId}/orders`, {
          headers: key(),
          payload: { orders: [{ kind: 'ATTACK', region: 1 }] },
        }),
      ),
    ).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });

    // Gültige Befehle: eine Armee kaufen. Der Mensch ist der Letzte, also wird aufgedeckt
    const orders: RealmOrderDto[] = [{ kind: 'RECRUIT', region: castle, count: 1 }];
    const idem = randomUUID();
    const sent = await submitOrders(human, matchId, orders, idem);
    expect(sent.statusCode, sent.body).toBe(200);
    // Dieselbe Anfrage noch einmal: dieselbe Antwort, keine zweite Wirkung
    const again = await submitOrders(human, matchId, orders, idem);
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotency-replayed']).toBe('true');
    const revealed = await view(human, matchId);
    expect(revealed.phase?.kind).toBe('ANNOUNCE');
    expect(revealed.phase?.remainingMs).toBeLessThanOrEqual(ECONOMY.timers.ordersRevealMs);
    expect(revealed.realm?.myOrders).toBeNull();
    const after = boardOf(revealed);
    expect(after.step).toMatchObject({ kind: 'CAMPAIGN_TARGET', round: 1 });
    expect(after.regions[castle]?.armies).toBe(4);
    expect(after.seats[mySeat]?.bread).toBe(me.bread - ECONOMY.costs.army.bread);
    const late = await events(matchId);
    expect(eventsOf(late, 'ORDERS_SUBMITTED').map((e) => e.payload.seat)).toEqual([
      botSeat,
      mySeat,
    ]);
    const reveals = eventsOf(late, 'ORDERS_REVEALED');
    expect(reveals.map((e) => e.payload.seat).sort()).toEqual([0, 1]);
    expect(reveals.find((e) => e.payload.seat === mySeat)?.payload).toMatchObject({
      round: 1,
      orders,
      summary: { built: [], recruited: 1, moved: 0, traded: 0 },
      bread: me.bread - ECONOMY.costs.army.bread,
      material: me.material,
    });
    expect(eventsOf(late, 'PREPARE_CLOSED')).toEqual([]);
    // Nach dem Aufdecken ist die Rüstzeit vorbei
    expect(errorOf(await submitOrders(human, matchId, []))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
  });

  it('nach Ablauf der Frist deckt der Server auf: Wer nichts abgegeben hat, tut nichts', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['EASY']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const mySeat = prepare.mySeat ?? -1;
    const before = boardOf(prepare).seats[mySeat];
    // Kurz vor der Frist läuft die Rüstzeit noch
    await advanceGameClock(server.database.pool, (prepare.phase?.remainingMs ?? 0) - 200);
    await runMatchDriverOnce(server.db, driverContext());
    expect((await view(human, matchId)).phase?.kind).toBe('PREPARE');
    await advanceGameClock(server.database.pool, 201);
    // Der Lauf arbeitet jede fällige Partie der Datenbank ab; geprüft wird nur diese
    await runMatchDriverOnce(server.db, driverContext());
    const closed = await view(human, matchId);
    expect(closed.phase?.kind).toBe('ANNOUNCE');
    expect(boardOf(closed).seats[mySeat]).toMatchObject({
      bread: before?.bread,
      material: before?.material,
    });
    const all = await events(matchId);
    expect(eventsOf(all, 'PREPARE_CLOSED').map((e) => e.payload)).toEqual([
      { round: 1, missing: [mySeat] },
    ]);
    expect(
      eventsOf(all, 'ORDERS_REVEALED').find((e) => e.payload.seat === mySeat)?.payload,
    ).toMatchObject({
      orders: [],
      summary: { built: [], recruited: 0, moved: 0, traded: 0 },
    });
    // Zu spät abgegebene Befehle kommen nicht mehr an
    expect(errorOf(await submitOrders(human, matchId, []))).toMatchObject({
      status: 409,
      code: 'STEP_NOT_AVAILABLE',
    });
    // Die Partie läuft weiter, auch wenn der Mensch nie etwas abgibt
    const final = await play(matchId, [{ human, submits: false }]);
    expect(final.match.status).toBe('FINISHED');
    expect(await unreadableEvents(matchId)).toEqual([]);
    const types = await eventTypes(matchId);
    expect(types.filter((t) => t === 'PREPARE_CLOSED').length).toBe(
      types.filter((t) => t === 'INCOME').length,
    );
  });

  it('zwei Menschen: Wer fertig ist, wartet; die Befehle des anderen sieht vorher niemand', async () => {
    const host = await newHuman();
    const guest = await newHuman();
    const matchId = await createMatch(host, { kind: 'STANDARD', mode: 'REALM', rules: 'PLAYTEST' });
    const code = (await view(host, matchId)).match.inviteCode ?? '';
    expect((await joinMatch(guest, code)).statusCode).toBe(200);
    expect((await startMatch(host, matchId)).statusCode).toBe(200);
    const seats = [{ human: host }, { human: guest }];
    const prepare = await play(matchId, seats, inPrepare(1));
    expect(boardOf(prepare).turns.map((t) => t.status)).toEqual(['NOW', 'NOW']);
    const hostSeat = prepare.mySeat ?? -1;
    const castle = boardOf(prepare).seats[hostSeat]?.startCastle ?? -1;
    const orders: RealmOrderDto[] = [{ kind: 'RECRUIT', region: castle, count: 1 }];
    expect((await submitOrders(host, matchId, orders)).statusCode).toBe(200);

    // Der Gastgeber ist fertig und sieht seine Befehle; die Rüstzeit läuft für den Gast weiter
    const waiting = await view(host, matchId);
    expect(waiting.phase?.kind).toBe('PREPARE');
    expect(waiting.realm?.myOrders).toEqual(orders);
    expect(boardOf(waiting).turns).toContainEqual({ seat: hostSeat, status: 'DONE' });
    expect(boardOf(waiting).regions[castle]?.armies).toBe(3);
    // Der Gast erfährt nur, dass der Gastgeber fertig ist
    const other = await view(guest, matchId);
    expect(other.realm?.myOrders).toBeNull();
    expect(boardOf(other).turns).toContainEqual({ seat: hostSeat, status: 'DONE' });
    expect(boardOf(other).regions[castle]?.armies).toBe(3);
    expect(JSON.stringify(other)).not.toContain('RECRUIT');
    expect(other.events.filter((e) => e.type === 'ORDERS_REVEALED')).toEqual([]);
    expect(other.events.filter((e) => e.type === 'ORDERS_SUBMITTED').map((e) => e.payload)).toEqual(
      [{ round: 1, seat: hostSeat }],
    );
    // Solange jemand fehlt, lassen sich die eigenen Befehle noch ersetzen
    expect((await submitOrders(host, matchId, [])).statusCode).toBe(200);
    expect((await view(host, matchId)).realm?.myOrders).toEqual([]);
    expect((await submitOrders(host, matchId, orders)).statusCode).toBe(200);

    // Der Gast gibt ab: Jetzt wird aufgedeckt, beide sehen beides
    expect((await submitOrders(guest, matchId, [])).statusCode).toBe(200);
    const revealed = await view(guest, matchId);
    expect(revealed.phase?.kind).toBe('ANNOUNCE');
    expect(boardOf(revealed).regions[castle]?.armies).toBe(4);
    const all = await events(matchId);
    expect(
      eventsOf(all, 'ORDERS_REVEALED').find((e) => e.payload.seat === hostSeat)?.payload.orders,
    ).toEqual(orders);
    // Eine Partie nur aus Menschen zählt in der Statistik
    const final = await play(matchId, seats);
    expect(final.match.status).toBe('FINISHED');
    const played = await server.db
      .selectFrom('player_statistics')
      .select(['matches_played', 'matches_won'])
      .where('user_id', 'in', [host.userId, guest.userId])
      .execute();
    expect(played.map((row) => row.matches_played)).toEqual([1, 1]);
    expect(played.reduce((sum, row) => sum + row.matches_won, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('Wiederanlauf mit Ausbau', () => {
  it('eine neue Serverinstanz macht in der Rüstzeit weiter und deckt nach der Frist auf', async () => {
    const human = await newHuman();
    const matchId = await startRealmTest(human, ['MEDIUM']);
    const prepare = await play(matchId, [{ human }], inPrepare(1));
    const stored = await server.db
      .selectFrom('matches')
      .select(['mode', 'phase', 'phase_deadline_at', 'state'])
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({ mode: 'REALM', phase: 'PREPARE' });
    expect(stored.phase_deadline_at).not.toBeNull();

    // „Neustart“: neue Anwendung auf derselben Datenbank, ohne Zustand im Speicher
    const restarted = await buildApp({
      db: server.db,
      config: testConfig(server.database.url),
      logger: false,
    });
    try {
      const again: Human = { client: new TestClient(restarted), userId: human.userId };
      for (const [name, value] of human.client.cookies) again.client.cookies.set(name, value);
      const resumed = await view(again, matchId);
      expect(resumed.phase).toMatchObject({ kind: 'PREPARE', deadline: prepare.phase?.deadline });
      expect(boardOf(resumed)).toEqual(boardOf(prepare));
      // Die Frist verstreicht, während niemand zusieht; der nächste Abruf holt das Aufdecken nach
      await advanceGameClock(server.database.pool, resumed.phase?.remainingMs ?? 0);
      const closed = await view(again, matchId);
      expect(closed.phase?.kind).toBe('ANNOUNCE');
      expect(closed.events.map((e) => e.type)).toContain('PREPARE_CLOSED');
      // Weiter bis zur nächsten Rüstzeit, dort abgeben, dann zu Ende
      const next = await play(
        matchId,
        [{ human: again, submits: false }],
        (current) => current.match.status !== 'RUNNING' || inPrepare(2)(current),
      );
      if (next.match.status === 'RUNNING') {
        expect((await submitOrders(again, matchId, [])).statusCode).toBe(200);
      }
      const final = await play(matchId, [{ human: again }]);
      expect(final.match.status).toBe('FINISHED');
      expect(await unreadableEvents(matchId)).toEqual([]);
    } finally {
      await restarted.close();
    }
  });
});
