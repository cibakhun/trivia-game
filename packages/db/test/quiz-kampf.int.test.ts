import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ESTIMATE_SPREAD,
  DEFAULT_RESPONSE_LOG_SIGMA,
  NPC_BASE_PROFILES,
  garrisonProfile,
  siegeEndState,
  type Outcome,
} from '@rdw/game-core';
import {
  ESTIMATE_SCALE_TYPES,
  LOCALES,
  QUESTION_CATEGORIES,
  QUESTION_KINDS,
  QUESTION_ORIGINS,
  QUESTION_VERSION_STATUSES,
  TRANSLATION_STATUSES,
} from '@rdw/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../src/testing/index.ts';

/**
 * Schema der Migrationen 0005–0007: Fragenbestand mit Freigabe, Kämpfe mit zusammengesetzten
 * Fremdschlüsseln (I13), Antworten (I11), Outbox und NPC-Basisprofile (DATA_MODEL §4.5–4.9, §5).
 */

let db: TestDatabase;
const q = (text: string, values?: unknown[]) =>
  db.pool.query<Record<string, unknown>>(text, values);

/** Erwartet einen PostgreSQL-Fehler mit SQLSTATE und optional dem Namen der Bedingung. */
async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject(constraint ? { code, constraint } : { code });
}

const CHECK = '23514';
const FOREIGN_KEY = '23503';
const UNIQUE = '23505';
const RESTRICT = '23001';

async function insert(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await q(
    `insert into ${table} (${cols.map((c) => `"${c}"`).join(', ')})
     values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
}

/** Werte einer Spaltenprüfung `spalte in ('A', 'B', …)` aus dem Katalog. */
async function checkValues(table: string, column: string): Promise<string[]> {
  const { rows } = await q(
    `select pg_get_constraintdef(c.oid) as def
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'c' and c.conrelid = $1::regclass and a.attname = $2
       and array_length(c.conkey, 1) = 1`,
    [table, column],
  );
  expect(rows).toHaveLength(1);
  const def = String(rows[0]?.def);
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1] ?? '').sort();
}

beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

// ---------------------------------------------------------------------------------------------
// Fragen (0005)
// ---------------------------------------------------------------------------------------------

interface QuestionSetup {
  readonly kind?: 'TRIVIA' | 'ESTIMATE';
  readonly fixture?: boolean;
  readonly options?: number;
  readonly correct?: number;
  readonly translation?: 'DRAFT' | 'REVIEWED' | 'APPROVED' | null;
  readonly factReview?: boolean;
  readonly languageReview?: boolean;
}

interface CreatedQuestion {
  readonly questionId: string;
  readonly versionId: string;
}

let questionCounter = 0;

async function createQuestion(setup: QuestionSetup = {}): Promise<CreatedQuestion> {
  const kind = setup.kind ?? 'TRIVIA';
  const questionId = randomUUID();
  const versionId = randomUUID();
  questionCounter += 1;
  await insert('questions', {
    id: questionId,
    key: `testfrage-${questionCounter}`,
    kind,
    category: 'GENERAL',
    origin: 'EDITORIAL',
    is_fixture: setup.fixture ?? false,
  });
  await insert('question_versions', {
    id: versionId,
    question_id: questionId,
    version: 1,
    kind,
    difficulty: 2,
    sources: JSON.stringify([{ title: 'Testquelle', url: 'https://example.org' }]),
    content_hash: 'b'.repeat(64),
    ...(kind === 'ESTIMATE'
      ? {
          answer_value: 100,
          answer_precision: 0,
          answer_unit: 'm',
          input_min: 0,
          input_max: 1000,
          estimate_scale_type: 'LINEAR',
          estimate_scale: 10,
        }
      : {}),
  });
  if (kind === 'TRIVIA') {
    const count = setup.options ?? 4;
    const correct = setup.correct ?? 1;
    for (let i = 0; i < count; i += 1) {
      await insert('question_options', {
        version_id: versionId,
        option_key: String.fromCharCode(97 + i),
        is_correct: i < correct,
      });
    }
  }
  const translation = setup.translation === undefined ? 'APPROVED' : setup.translation;
  if (translation !== null) {
    await insert('question_translations', {
      version_id: versionId,
      locale: 'de',
      prompt: 'Wie lautet die richtige Antwort?',
      option_texts: kind === 'TRIVIA' ? JSON.stringify({ a: 'A', b: 'B', c: 'C', d: 'D' }) : null,
      status: translation,
    });
  }
  if (setup.factReview ?? true) {
    await insert('question_reviews', {
      id: randomUUID(),
      version_id: versionId,
      kind: 'FACT',
      reviewer_name: 'Redaktion',
      reviewed_on: '2026-11-01',
    });
  }
  if (setup.languageReview ?? true) {
    await insert('question_reviews', {
      id: randomUUID(),
      version_id: versionId,
      kind: 'LANGUAGE',
      locale: 'de',
      reviewer_name: 'Redaktion',
      reviewed_on: '2026-11-01',
    });
  }
  return { questionId, versionId };
}

const approve = (versionId: string) =>
  q(`update question_versions set status = 'APPROVED' where id = $1`, [versionId]);

describe('Fragen: Wertelisten wie in @rdw/protocol', () => {
  it.each([
    ['questions', 'category', QUESTION_CATEGORIES],
    ['questions', 'kind', QUESTION_KINDS],
    ['questions', 'origin', QUESTION_ORIGINS],
    ['question_versions', 'status', QUESTION_VERSION_STATUSES],
    ['question_versions', 'estimate_scale_type', ESTIMATE_SCALE_TYPES],
    ['question_translations', 'status', TRANSLATION_STATUSES],
    ['question_translations', 'locale', LOCALES],
  ] as const)('%s.%s', async (table, column, expected) => {
    expect(await checkValues(table, column)).toEqual([...expected].sort());
  });
});

describe('Fragen: Freigabe (Brief §5.6)', () => {
  it('gibt eine vollständig geprüfte Version frei; der Zeitpunkt kommt aus der Datenbank', async () => {
    const { versionId } = await createQuestion();
    await q(
      `update question_versions set status = 'APPROVED', approved_at = '2000-01-01' where id = $1`,
      [versionId],
    );
    const { rows } = await q(
      `select status, approved_at > game_now() - interval '1 minute' as fresh
       from question_versions where id = $1`,
      [versionId],
    );
    expect(rows[0]).toEqual({ status: 'APPROVED', fresh: true });
  });

  it('gibt auch eine Schätzfrage frei (ohne Optionen)', async () => {
    const { versionId } = await createQuestion({ kind: 'ESTIMATE' });
    await approve(versionId);
  });

  it.each([
    ['Testfrage', { fixture: true }, /Testfragen werden nie freigegeben/],
    ['ohne Faktenprüfung', { factReview: false }, /Faktenprüfung/],
    ['ohne Sprachprüfung', { languageReview: false }, /geprüfte Sprache de/],
    ['Übersetzung nur REVIEWED', { translation: 'REVIEWED' }, /geprüfte Sprache de/],
    ['ohne Fragetext', { translation: null }, /ohne Fragetext/],
    ['nur drei Optionen', { options: 3 }, /mindestens 4 Optionen/],
    ['keine richtige Option', { correct: 0 }, /genau eine richtige/],
  ] as const)('verweigert die Freigabe: %s', async (_name, setup, message) => {
    const { versionId } = await createQuestion(setup);
    await expect(approve(versionId)).rejects.toThrow(message);
    await expectPgError(approve(versionId), CHECK);
  });

  it('lässt keine zweite richtige Option zu', async () => {
    await expectPgError(createQuestion({ correct: 2 }), UNIQUE, 'question_options_one_correct');
  });

  it('lässt keine Version direkt als APPROVED entstehen', async () => {
    const { questionId } = await createQuestion();
    await expectPgError(
      insert('question_versions', {
        id: randomUUID(),
        question_id: questionId,
        version: 2,
        kind: 'TRIVIA',
        difficulty: 2,
        sources: '[]',
        content_hash: 'c'.repeat(64),
        status: 'APPROVED',
      }),
      CHECK,
    );
  });
});

describe('Fragen: Unveränderlichkeit (I12)', () => {
  it('sperrt freigegebene Versionen samt Optionen, Übersetzungen und Prüfungen', async () => {
    const { versionId } = await createQuestion();
    await approve(versionId);
    await expectPgError(
      q(`update question_versions set difficulty = 3 where id = $1`, [versionId]),
      RESTRICT,
    );
    await expectPgError(q(`delete from question_versions where id = $1`, [versionId]), RESTRICT);
    await expectPgError(
      insert('question_options', { version_id: versionId, option_key: 'e', is_correct: false }),
      RESTRICT,
    );
    await expectPgError(
      q(`update question_options set is_correct = not is_correct where version_id = $1`, [
        versionId,
      ]),
      RESTRICT,
    );
    await expectPgError(
      q(
        `update question_translations set prompt = 'Ein ganz anderer Text?' where version_id = $1`,
        [versionId],
      ),
      RESTRICT,
    );
    await expectPgError(
      q(`delete from question_reviews where version_id = $1`, [versionId]),
      RESTRICT,
    );
    await expectPgError(q(`truncate question_options`), RESTRICT);
    await expectPgError(q(`truncate question_reviews`), RESTRICT);
  });

  it('erlaubt nur den Rückzug APPROVED → RETIRED, ohne weitere Änderung', async () => {
    const { versionId } = await createQuestion();
    await approve(versionId);
    await expectPgError(
      q(`update question_versions set status = 'RETIRED', difficulty = 4 where id = $1`, [
        versionId,
      ]),
      RESTRICT,
    );
    await q(`update question_versions set status = 'RETIRED' where id = $1`, [versionId]);
    await expectPgError(approve(versionId), RESTRICT);
    const { rows } = await q(
      `select approved_at is not null as kept from question_versions where id = $1`,
      [versionId],
    );
    expect(rows[0]).toEqual({ kept: true });
  });

  it('erlaubt Änderungen an Entwürfen', async () => {
    const { versionId } = await createQuestion();
    await q(`update question_versions set difficulty = 3 where id = $1`, [versionId]);
    await q(`delete from question_reviews where version_id = $1 and kind = 'LANGUAGE'`, [
      versionId,
    ]);
  });
});

describe('Fragen: aktiver Pool', () => {
  it('aktiviert nur mit freigegebener aktueller Version', async () => {
    const draft = await createQuestion();
    await q(`update questions set current_version_id = $1 where id = $2`, [
      draft.versionId,
      draft.questionId,
    ]);
    await expectPgError(
      q(`update questions set status = 'ACTIVE' where id = $1`, [draft.questionId]),
      CHECK,
    );
    await expectPgError(
      q(`update questions set status = 'ACTIVE', current_version_id = null where id = $1`, [
        draft.questionId,
      ]),
      CHECK,
    );

    const ready = await createQuestion();
    await approve(ready.versionId);
    await q(`update questions set current_version_id = $1, status = 'ACTIVE' where id = $2`, [
      ready.versionId,
      ready.questionId,
    ]);
    // eine aktive Frage verliert ihre Version nicht durch Rückzug
    await expectPgError(
      q(`update question_versions set status = 'RETIRED' where id = $1`, [ready.versionId]),
      RESTRICT,
    );
    // und wird nicht nachträglich zur Testfrage
    await expectPgError(
      q(`update questions set is_fixture = true where id = $1`, [ready.questionId]),
      CHECK,
      'questions_fixture_never_active',
    );
  });

  it('current_version_id zeigt nur auf eine Version derselben Frage', async () => {
    const a = await createQuestion();
    const b = await createQuestion();
    await expectPgError(
      q(`update questions set current_version_id = $1 where id = $2`, [b.versionId, a.questionId]),
      FOREIGN_KEY,
      'questions_current_version_fk',
    );
  });

  it('Art und Felder der Version passen zur Frage', async () => {
    const { questionId } = await createQuestion();
    const base = {
      question_id: questionId,
      difficulty: 2,
      sources: '[]',
      content_hash: 'd'.repeat(64),
    };
    await expectPgError(
      insert('question_versions', {
        ...base,
        id: randomUUID(),
        version: 2,
        kind: 'ESTIMATE',
        answer_value: 5,
        answer_precision: 0,
        answer_unit: 'm',
        input_min: 0,
        input_max: 10,
        estimate_scale_type: 'LINEAR',
        estimate_scale: 1,
      }),
      FOREIGN_KEY,
      'question_versions_question_fk',
    );
    await expectPgError(
      insert('question_versions', {
        ...base,
        id: randomUUID(),
        version: 2,
        kind: 'TRIVIA',
        answer_value: 5,
      }),
      CHECK,
      'question_versions_kind_fields',
    );
    const estimate = await createQuestion({ kind: 'ESTIMATE' });
    await expectPgError(
      q(`update question_versions set answer_value = 5000 where id = $1`, [estimate.versionId]),
      CHECK,
      'question_versions_kind_fields',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Kämpfe (0006)
// ---------------------------------------------------------------------------------------------

interface World {
  readonly instanceId: string;
  readonly kingdomId: string;
  readonly otherKingdomId: string;
  readonly userId: string;
  readonly regionIds: readonly string[];
}

async function insertUser(): Promise<string> {
  const id = randomUUID();
  await insert('users', { id, is_guest: true });
  return id;
}

let regionCounter = 0;

async function createWorld(): Promise<World> {
  const worldId = randomUUID();
  const rulesId = randomUUID();
  const instanceId = randomUUID();
  await insert('worlds', {
    id: worldId,
    slug: `welt-${worldId.slice(0, 8)}`,
    mode: 'ETERNAL',
    name_key: 'world.eternal',
  });
  await insert('world_rules', {
    id: rulesId,
    world_id: worldId,
    version: 1,
    config: '{}',
    config_hash: 'a'.repeat(64),
  });
  await insert('world_instances', {
    id: instanceId,
    world_id: worldId,
    rules_id: rulesId,
    map_seed: 1,
    capacity: 100,
    starts_at: new Date(),
  });
  const userId = await insertUser();
  const otherUserId = await insertUser();
  const kingdomId = randomUUID();
  const otherKingdomId = randomUUID();
  for (const [id, owner] of [
    [kingdomId, userId],
    [otherKingdomId, otherUserId],
  ] as const) {
    await insert('kingdoms', {
      id,
      instance_id: instanceId,
      kind: 'PLAYER',
      owner_user_id: owner,
      name_parts: '{}',
      color: 1,
    });
  }
  const regionIds: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    regionCounter += 1;
    const { rows } = await q(
      `insert into regions (instance_id, q, r, chunk_x, chunk_y, biome, tier)
       values ($1, $2::int, 0, floor($2::int / 16.0), 0, 0, 0) returning id`,
      [instanceId, regionCounter],
    );
    const regionId = String(rows[0]?.id);
    regionIds.push(regionId);
    await q(
      `insert into region_state (region_id, instance_id, chunk_x, chunk_y)
       select id, instance_id, chunk_x, chunk_y from regions where id = $1`,
      [regionId],
    );
  }
  return { instanceId, kingdomId, otherKingdomId, userId, regionIds };
}

let worldA: World;
let worldB: World;

function region(world: World, index: number): string {
  const id = world.regionIds[index];
  if (id === undefined) throw new Error(`Region ${index} fehlt`);
  return id;
}

async function insertSiege(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await insert('sieges', {
    id,
    instance_id: worldA.instanceId,
    mode: 'PVE',
    target_region_id: region(worldA, 0),
    attacker_kingdom_id: worldA.kingdomId,
    defender_kind: 'NEUTRAL',
    status: 'PREPARING',
    rules_snapshot: '{}',
    idempotency_key: randomUUID(),
    ...overrides,
  });
  return id;
}

const resolved = (status: string, outcome: string, reason: string) => ({
  status,
  outcome,
  outcome_reason: reason,
  resolved_at: new Date(),
});

describe('Kämpfe: Belagerungen', () => {
  beforeAll(async () => {
    worldA = await createWorld();
    worldB = await createWorld();
  });

  it('nimmt eine PvE-Belagerung gegen eine neutrale Region an und löst sie auf', async () => {
    const id = await insertSiege();
    await q(
      `update sieges set status = 'ATTACKER_WON', outcome = 'ATTACKER', outcome_reason = 'TRIVIA',
         resolved_at = game_now() where id = $1`,
      [id],
    );
  });

  it('verbietet Verweise über Instanzgrenzen (I13)', async () => {
    await expectPgError(
      insertSiege({ target_region_id: region(worldB, 0) }),
      FOREIGN_KEY,
      'sieges_target_fk',
    );
    await expectPgError(
      insertSiege({ attacker_kingdom_id: worldB.kingdomId }),
      FOREIGN_KEY,
      'sieges_attacker_fk',
    );
    await expectPgError(
      insertSiege({
        mode: 'PVP',
        defender_kind: 'PLAYER',
        defender_kingdom_id: worldB.otherKingdomId,
      }),
      FOREIGN_KEY,
      'sieges_defender_fk',
    );
    await expectPgError(
      q(`update region_state set owner_kingdom_id = $1 where region_id = $2`, [
        worldB.kingdomId,
        region(worldA, 2),
      ]),
      FOREIGN_KEY,
      'region_state_owner_fk',
    );
    await expectPgError(
      insert('region_history', {
        region_id: region(worldA, 2),
        instance_id: worldA.instanceId,
        to_kingdom_id: worldB.kingdomId,
        cause: 'ADMIN',
      }),
      FOREIGN_KEY,
      'region_history_to_kingdom_fk',
    );
    await expectPgError(
      insert('region_history', {
        region_id: region(worldB, 2),
        instance_id: worldA.instanceId,
        cause: 'ADMIN',
      }),
      FOREIGN_KEY,
      'region_history_region_fk',
    );
  });

  it('prüft Fristen (I10), Modus und Verteidiger', async () => {
    const t = Date.now();
    await expectPgError(insertSiege({ opened_at: new Date(t) }), CHECK, 'sieges_deadlines');
    await expectPgError(
      insertSiege({
        mode: 'PVP',
        defender_kind: 'PLAYER',
        defender_kingdom_id: worldA.otherKingdomId,
        opened_at: new Date(t),
        base_deadline_at: new Date(t + 2000),
        deadline_at: new Date(t + 1000),
        max_deadline_at: new Date(t + 3000),
      }),
      CHECK,
      'sieges_deadlines',
    );
    await expectPgError(insertSiege({ mode: 'PVP' }), CHECK, 'sieges_mode_defender');
    await expectPgError(
      insertSiege({ defender_kingdom_id: worldA.otherKingdomId }),
      CHECK,
      'sieges_neutral_without_kingdom',
    );
    await expectPgError(
      insertSiege({
        mode: 'PVP',
        defender_kind: 'PLAYER',
        defender_kingdom_id: worldA.kingdomId,
      }),
      CHECK,
      'sieges_not_self',
    );
  });

  it('verlangt Ergebnisfelder genau in Endzuständen', async () => {
    await expectPgError(insertSiege({ status: 'ATTACKER_WON' }), CHECK, 'sieges_terminal_fields');
    await expectPgError(insertSiege({ resolved_at: new Date() }), CHECK, 'sieges_terminal_fields');
    await expectPgError(
      insertSiege(resolved('DEFENDER_WON', 'ATTACKER', 'ESTIMATE')),
      CHECK,
      'sieges_outcome_matches_status',
    );
  });

  it('nimmt jeden Ausgang von resolveDuel samt Ergebniszeile an', async () => {
    const outcomes: Outcome[] = [
      { winner: 'ATTACKER', reason: 'TIMEOUT' },
      { winner: 'ATTACKER', reason: 'TRIVIA' },
      { winner: 'ATTACKER', reason: 'ESTIMATE' },
      { winner: 'ATTACKER', reason: 'SPEED' },
      { winner: 'DEFENDER', reason: 'ATTACKER_GATE' },
      { winner: 'DEFENDER', reason: 'ESTIMATE' },
      { winner: 'DEFENDER', reason: 'SPEED' },
      { winner: 'DEFENDER', reason: 'FULL_TIE' },
      { winner: 'NONE', reason: 'ATTACKER_GATE' },
    ];
    for (const outcome of outcomes) {
      const id = await insertSiege({
        mode: 'PVP',
        defender_kind: 'PLAYER',
        defender_kingdom_id: worldA.otherKingdomId,
        ...resolved(siegeEndState(outcome), outcome.winner, outcome.reason),
      });
      await insert('battle_results', {
        siege_id: id,
        winner_role: outcome.winner === 'NONE' ? null : outcome.winner,
        reason: outcome.reason,
        attacker_summary: '{}',
        defender_summary: '{}',
        core_version: 'test',
      });
    }
  });

  it('erlaubt höchstens eine aktive Belagerung je Region (I2)', async () => {
    const target = region(worldA, 1);
    const first = await insertSiege({ target_region_id: target });
    await expectPgError(
      insertSiege({ target_region_id: target }),
      UNIQUE,
      'sieges_one_active_per_region',
    );
    await q(
      `update sieges set status = 'CANCELLED', outcome = 'NONE', outcome_reason = 'CANCELLED',
         resolved_at = game_now() where id = $1`,
      [first],
    );
    await insertSiege({ target_region_id: target });
  });

  it('region_state.active_siege_id zeigt nur auf eine Belagerung dieser Region (I3)', async () => {
    const siegeOnZero = await insertSiege({
      target_region_id: region(worldA, 0),
      ...resolved('CANCELLED', 'NONE', 'CANCELLED'),
    });
    await expectPgError(
      q(`update region_state set active_siege_id = $1 where region_id = $2`, [
        siegeOnZero,
        region(worldA, 2),
      ]),
      FOREIGN_KEY,
      'region_state_active_siege_fk',
    );
  });

  it('macht Ergebnisse unveränderlich und das Kampfprotokoll nur anhängbar', async () => {
    const id = await insertSiege({
      target_region_id: region(worldA, 2),
      ...resolved('ATTACK_FAILED', 'NONE', 'ATTACKER_GATE'),
    });
    await insert('battle_results', {
      siege_id: id,
      reason: 'ATTACKER_GATE',
      attacker_summary: '{}',
      defender_summary: '{}',
      core_version: 'test',
    });
    await expectPgError(
      q(`update battle_results set defense_points = 5 where siege_id = $1`, [id]),
      RESTRICT,
    );
    await expectPgError(q(`delete from battle_results where siege_id = $1`, [id]), RESTRICT);
    await insert('battle_events', { siege_id: id, seq: 1, type: 'SIEGE_RESOLVED' });
    await expectPgError(
      q(`update battle_events set payload = '{"x": 1}' where siege_id = $1`, [id]),
      RESTRICT,
    );
    await expectPgError(
      insert('battle_events', { siege_id: id, seq: 1, type: 'SIEGE_RESOLVED' }),
      UNIQUE,
    );
    await expectPgError(
      insert('battle_events', { siege_id: id, seq: 2, type: 'siege.resolved' }),
      CHECK,
    );
  });
});

describe('Kämpfe: Teilnehmer, Herausforderung und Antworten (I11)', () => {
  let world: World;
  let siegeId: string;
  let otherSiegeId: string;
  let humanId: string;
  let npcId: string;
  let challengeId: string;
  let triviaVersionId: string;
  let estimateVersionId: string;

  beforeAll(async () => {
    world = await createWorld();
    siegeId = randomUUID();
    otherSiegeId = randomUUID();
    for (const [id, target] of [
      [siegeId, region(world, 0)],
      [otherSiegeId, region(world, 1)],
    ] as const) {
      await insert('sieges', {
        id,
        instance_id: world.instanceId,
        mode: 'PVE',
        target_region_id: target,
        attacker_kingdom_id: world.kingdomId,
        defender_kind: 'NEUTRAL',
        status: 'RESOLVING',
        rules_snapshot: '{}',
        idempotency_key: randomUUID(),
      });
    }
    humanId = randomUUID();
    npcId = randomUUID();
    await insert('siege_participants', {
      id: humanId,
      siege_id: siegeId,
      role: 'ATTACKER',
      user_id: world.userId,
      locale: 'de',
    });
    await insert('siege_participants', {
      id: npcId,
      siege_id: siegeId,
      role: 'DEFENDER',
      npc_profile_id: '00000000-0000-4000-8000-000000000001',
    });
    triviaVersionId = (await createQuestion()).versionId;
    estimateVersionId = (await createQuestion({ kind: 'ESTIMATE' })).versionId;
    challengeId = randomUUID();
    await insert('quiz_challenges', {
      id: challengeId,
      siege_id: siegeId,
      target_difficulty: 0,
      rng_key_id: 'test',
      rng_version: 1,
    });
    await insert('quiz_challenge_steps', {
      challenge_id: challengeId,
      step_index: 0,
      kind: 'TRIVIA',
      version_id: triviaVersionId,
      time_limit_ms: 20000,
    });
    await insert('quiz_challenge_steps', {
      challenge_id: challengeId,
      step_index: 1,
      kind: 'ESTIMATE',
      version_id: estimateVersionId,
      time_limit_ms: 30000,
    });
  });

  it('verlangt genau einen Akteur je Seite: Mensch mit Sprache oder NPC ohne', async () => {
    await expectPgError(
      insert('siege_participants', {
        id: randomUUID(),
        siege_id: otherSiegeId,
        role: 'ATTACKER',
        user_id: world.userId,
      }),
      CHECK,
      'siege_participants_actor',
    );
    await expectPgError(
      insert('siege_participants', {
        id: randomUUID(),
        siege_id: otherSiegeId,
        role: 'DEFENDER',
        npc_profile_id: '00000000-0000-4000-8000-000000000001',
        locale: 'de',
      }),
      CHECK,
      'siege_participants_actor',
    );
    await expectPgError(
      insert('siege_participants', {
        id: randomUUID(),
        siege_id: siegeId,
        role: 'ATTACKER',
        user_id: world.userId,
        locale: 'de',
      }),
      UNIQUE,
    );
  });

  it('hält die Reihenfolge der Schritte und die Fragenart fest', async () => {
    const other = randomUUID();
    await insert('quiz_challenges', {
      id: other,
      siege_id: otherSiegeId,
      target_difficulty: 0,
      rng_key_id: 'test',
      rng_version: 1,
    });
    await expectPgError(
      insert('quiz_challenge_steps', {
        challenge_id: other,
        step_index: 0,
        kind: 'ESTIMATE',
        version_id: estimateVersionId,
        time_limit_ms: 20000,
      }),
      CHECK,
      'quiz_challenge_steps_order',
    );
    await expectPgError(
      insert('quiz_challenge_steps', {
        challenge_id: other,
        step_index: 0,
        kind: 'TRIVIA',
        version_id: estimateVersionId,
        time_limit_ms: 20000,
      }),
      FOREIGN_KEY,
      'quiz_challenge_steps_version_fk',
    );
  });

  it('nimmt NPC-Antworten nur mit Audit und ohne Präsentation an', async () => {
    const npcAnswer = {
      challenge_id: challengeId,
      siege_id: siegeId,
      participant_id: npcId,
      step_index: 0,
      answer_option_key: 'a',
      is_correct: true,
      status: 'GENERATED',
    };
    await expectPgError(
      insert('quiz_answers', { ...npcAnswer, id: randomUUID() }),
      CHECK,
      'quiz_answers_presentation',
    );
    const id = randomUUID();
    await insert('quiz_answers', {
      ...npcAnswer,
      id,
      audit: JSON.stringify({ theta: -2.5, b: -1.2 }),
    });
    await expectPgError(
      q(`update quiz_answers set is_correct = false where id = $1`, [id]),
      RESTRICT,
    );
    await expectPgError(q(`delete from quiz_answers where id = $1`, [id]), RESTRICT);
  });

  it('lässt eine präsentierte Frage genau einmal beantworten', async () => {
    const id = randomUUID();
    const presentedAt = new Date();
    await insert('quiz_answers', {
      id,
      challenge_id: challengeId,
      siege_id: siegeId,
      participant_id: humanId,
      step_index: 0,
      locale: 'de',
      presentation: JSON.stringify({ order: ['b', 'a', 'd', 'c'] }),
      presented_at: presentedAt,
      answer_deadline_at: new Date(presentedAt.getTime() + 21000),
      status: 'PRESENTED',
    });
    await expectPgError(
      q(`update quiz_answers set presented_at = presented_at - interval '1 second' where id = $1`, [
        id,
      ]),
      RESTRICT,
    );
    await q(
      `update quiz_answers set status = 'ANSWERED', received_at = game_now(), answer_option_key = 'a',
         is_correct = true, effective_ms = 4000 where id = $1`,
      [id],
    );
    await expectPgError(
      q(`update quiz_answers set answer_option_key = 'b' where id = $1`, [id]),
      RESTRICT,
    );
    await expectPgError(q(`truncate quiz_answers`), RESTRICT);
  });

  it('verbindet Antworten nur mit Teilnehmern desselben Kampfes', async () => {
    await expectPgError(
      insert('quiz_answers', {
        id: randomUUID(),
        challenge_id: challengeId,
        siege_id: otherSiegeId,
        participant_id: humanId,
        step_index: 1,
        status: 'GENERATED',
        audit: '{}',
      }),
      FOREIGN_KEY,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Betrieb und NPC-Profile (0007)
// ---------------------------------------------------------------------------------------------

describe('Outbox world_events', () => {
  it('ist nur anhängbar und prüft Typ und Chunk', async () => {
    const world = await createWorld();
    await insert('world_events', {
      instance_id: world.instanceId,
      seq: 1,
      chunk_x: 0,
      chunk_y: 0,
      type: 'region.conquered',
      payload: JSON.stringify({ regionId: region(world, 0) }),
    });
    await expectPgError(
      q(`update world_events set payload = '{}' where instance_id = $1`, [world.instanceId]),
      RESTRICT,
    );
    await expectPgError(q(`truncate world_events`), RESTRICT);
    await expectPgError(
      insert('world_events', { instance_id: world.instanceId, seq: 1, type: 'region.changed' }),
      UNIQUE,
    );
    await expectPgError(
      insert('world_events', { instance_id: world.instanceId, seq: 2, type: 'RegionChanged' }),
      CHECK,
    );
    await expectPgError(
      insert('world_events', {
        instance_id: world.instanceId,
        seq: 2,
        chunk_x: 1,
        type: 'region.changed',
      }),
      CHECK,
    );
    // DELETE bleibt für die Aufbewahrung erlaubt
    await q(`delete from world_events where instance_id = $1`, [world.instanceId]);
  });
});

describe('NPC-Basisprofile', () => {
  interface ProfileRow {
    code: string;
    theta: number;
    median: number;
    sigma: number;
    spread: unknown;
  }

  async function profiles(): Promise<Map<string, ProfileRow>> {
    const { rows } = await q(
      `select code, skill_theta::float8 as theta, exp(rt_log_mu)::float8 as median,
              rt_log_sigma::float8 as sigma, estimate_spread as spread
       from npc_profiles where version = 1`,
    );
    return new Map(rows.map((r) => [String(r.code), r as unknown as ProfileRow]));
  }

  function expectProfile(row: ProfileRow | undefined, theta: number, median: number): void {
    expect(row).toBeDefined();
    expect(row?.theta).toBeCloseTo(theta, 10);
    expect(row?.median).toBeCloseTo(median, 6);
    expect(row?.sigma).toBe(DEFAULT_RESPONSE_LOG_SIGMA);
    expect(row?.spread).toEqual(DEFAULT_ESTIMATE_SPREAD);
  }

  it('entsprechen NPC_BASE_PROFILES und garrisonProfile in @rdw/game-core', async () => {
    const rows = await profiles();
    expect(rows.size).toBe(Object.keys(NPC_BASE_PROFILES).length + 11);
    for (const [code, profile] of Object.entries(NPC_BASE_PROFILES)) {
      expectProfile(rows.get(code), profile.theta, profile.estimateMedianMs);
    }
    for (let tier = 0; tier <= 10; tier += 1) {
      const profile = garrisonProfile(tier);
      expectProfile(
        rows.get(`GARRISON_T${String(tier).padStart(2, '0')}`),
        profile.theta,
        profile.estimateMedianMs,
      );
      expect(profile.responseLogSigma).toBe(DEFAULT_RESPONSE_LOG_SIGMA);
    }
  });

  it('sind unveränderlich', async () => {
    await expectPgError(q(`update npc_profiles set skill_theta = 0`), RESTRICT);
  });
});
