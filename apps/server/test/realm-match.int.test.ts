import { randomUUID } from 'node:crypto';
import { advanceGameClock } from '@rdw/db/testing';
import { MATCH_BOT_PROFILES, REALM_FAVORITE_THETA_BONUS } from '@rdw/game-core';
import {
  matchListResponseSchema,
  parseMatchEvent,
  PLAYTEST_REALM_RULES,
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
    expect(board.regions.every((r) => r.owner !== null)).toBe(true);

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
    // 24 Felder, 6 für Burgen und Startdörfer: 18 in der Landnahme
    expect(count('REGION_CLAIMED')).toBe(18);

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
    // Die 25 Wissensfragen der Testdaten reichen nicht für jede Kategorie: Das Rad weicht aus
    expect(spins.some((e) => e.payload.exhausted.length > 0)).toBe(true);
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
    // 16 Felder, 4 für Burgen und Startdörfer: 12 in der Landnahme
    expect(types.filter((t) => t === 'REGION_CLAIMED')).toHaveLength(12);
    // Die letzte Auflösung steht noch, während die Zustandsmaschine schon fertig ist
    const last = closing as MatchView | null;
    expect(last?.phase?.kind).toBe('REVEAL');
    const turns = last?.realm?.board?.turns ?? [];
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((turn) => turn.status === 'DONE')).toBe(true);
    expect(last?.question).toMatchObject({ resolved: true });
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
    expect(me.bread + me.material).toBe(2 + 2 + 2 + (me.regions - 2));
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
    const { advanced } = await runMatchDriverOnce(server.db, driverContext());
    expect(advanced).toBe(1);
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
