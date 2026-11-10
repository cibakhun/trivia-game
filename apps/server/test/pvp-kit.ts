import { randomUUID } from 'node:crypto';
import { areNeighbors } from '@rdw/game-core';
import {
  PLAYTEST_RULES,
  answerResponseSchema,
  attackResponseSchema,
  joinResponseSchema,
  type AnswerResponse,
  type AttackResponse,
  type JoinResponse,
  type RulesConfig,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { expect } from 'vitest';
import { z } from 'zod';
import type { CreatedWorld } from '../src/index.ts';
import { TestClient, createTestWorld, type TestServer } from './helpers.ts';

/**
 * Aufbau für PvP-Tests über die HTTP-Schnittstelle: Spieler beitreten lassen, Regionen direkt
 * übertragen, Angriff und Verteidigung spielen. Richtige Antworten liest der Aufbau wie ein Prüfer
 * aus der Datenbank.
 */

export const PLAYTEST = PLAYTEST_RULES as RulesConfig;

export interface Player {
  readonly client: TestClient;
  readonly userId: string;
  readonly joined: JoinResponse;
}

const presentationSchema = z.object({
  options: z.array(z.object({ token: z.string(), key: z.string() })),
});

export type Role = 'ATTACKER' | 'DEFENDER';

export interface Play {
  readonly trivia: boolean;
  readonly exactEstimate: boolean;
}

export interface Pair {
  readonly attacker: Player;
  readonly defender: Player;
  /** Region des Verteidigers neben der Hauptstadt des Angreifers (keine Hauptstadt). */
  readonly target: string;
  readonly instanceId: string;
}

/** PvP-Helfer für den Testserver, den `getServer` liefert (er entsteht erst in `beforeAll`). */
export function createPvpKit(getServer: () => TestServer) {
  async function newPlayer(world: CreatedWorld): Promise<Player> {
    const client = new TestClient(getServer().app);
    const userId = await client.signUpGuest();
    const response = await client.join(world.worldId);
    expect(response.statusCode, response.body).toBe(201);
    return { client, userId, joined: joinResponseSchema.parse(response.json()) };
  }

  function attack(player: Player, targetRegionId: string) {
    return player.client.post(`/instances/${player.joined.instanceId}/attacks`, {
      headers: { 'idempotency-key': randomUUID() },
      payload: { targetRegionId },
    });
  }

  async function startAttack(player: Player, targetRegionId: string): Promise<AttackResponse> {
    const response = await attack(player, targetRegionId);
    expect(response.statusCode, response.body).toBe(201);
    return attackResponseSchema.parse(response.json());
  }

  function answer(
    player: Player,
    challengeId: string,
    step: number,
    body: Record<string, unknown>,
  ) {
    return player.client.post(`/challenges/${challengeId}/steps/${step}/answer`, {
      headers: { 'idempotency-key': randomUUID() },
      payload: body,
    });
  }

  /** Token einer richtigen bzw. falschen Option aus der Präsentation einer Seite. */
  async function optionToken(challengeId: string, role: Role, correct: boolean): Promise<string> {
    const row = await getServer()
      .db.selectFrom('quiz_answers as a')
      .innerJoin('siege_participants as p', 'p.id', 'a.participant_id')
      .innerJoin('quiz_challenge_steps as s', (join) =>
        join
          .onRef('s.challenge_id', '=', 'a.challenge_id')
          .onRef('s.step_index', '=', 'a.step_index'),
      )
      .select(['a.presentation', 's.version_id'])
      .where('a.challenge_id', '=', challengeId)
      .where('a.step_index', '=', 0)
      .where('p.role', '=', role)
      .executeTakeFirstOrThrow();
    const keys = await getServer()
      .db.selectFrom('question_options')
      .select(['option_key', 'is_correct'])
      .where('version_id', '=', row.version_id)
      .execute();
    const wanted = new Set(keys.filter((k) => k.is_correct === correct).map((k) => k.option_key));
    const option = presentationSchema
      .parse(row.presentation)
      .options.find((o) => wanted.has(o.key));
    if (!option) throw new Error('Option fehlt');
    return option.token;
  }

  /** Schätzung als deutsche Eingabe: exakt oder um eine Einheit daneben. */
  async function estimateInput(challengeId: string, exact: boolean): Promise<string> {
    const row = await getServer()
      .db.selectFrom('quiz_challenge_steps as s')
      .innerJoin('question_versions as v', 'v.id', 's.version_id')
      .select(['v.answer_value', 'v.input_max'])
      .where('s.challenge_id', '=', challengeId)
      .where('s.step_index', '=', 1)
      .executeTakeFirstOrThrow();
    if (row.answer_value === null) throw new Error('Schätzwert fehlt');
    if (exact) return row.answer_value.replace('.', ',');
    const value = Number(row.answer_value);
    const max = row.input_max === null ? Number.POSITIVE_INFINITY : Number(row.input_max);
    const off = value + 1 <= max ? value + 1 : value - 1;
    return String(off).replace('.', ',');
  }

  /** Angreifer beantwortet im PvP immer beide Fragen; danach ist die Belagerung eröffnet. */
  async function playAttacker(player: Player, challengeId: string, play: Play) {
    const presented = await player.client.post(`/challenges/${challengeId}/steps/0/present`);
    expect(presented.statusCode, presented.body).toBe(200);
    const first = answerResponseSchema.parse(
      (
        await answer(player, challengeId, 0, {
          optionToken: await optionToken(challengeId, 'ATTACKER', play.trivia),
          clientElapsedMs: 0,
        })
      ).json(),
    );
    // Im PvP kommt die Schätzfrage immer, ohne Hinweis, ob sie zählt ([O-19] A)
    expect(first.next?.kind).toBe('ESTIMATE');
    expect(first.resolution).toBeNull();
    const second = await answer(player, challengeId, 1, {
      rawInput: await estimateInput(challengeId, play.exactEstimate),
      locale: 'de',
      clientElapsedMs: 0,
    });
    expect(second.statusCode, second.body).toBe(200);
    const done = answerResponseSchema.parse(second.json());
    expect(done.next).toBeNull();
    expect(done.resolution).toBeNull();
    return done;
  }

  function startDefense(player: Player, siegeId: string) {
    return player.client.post(`/sieges/${siegeId}/defense`);
  }

  /** Verteidiger: Schritt 0 kam mit dem Verteidigungsbeginn, Schritt 1 mit der Antwort. */
  async function playDefender(
    player: Player,
    challengeId: string,
    play: Play,
  ): Promise<AnswerResponse> {
    const first = answerResponseSchema.parse(
      (
        await answer(player, challengeId, 0, {
          optionToken: await optionToken(challengeId, 'DEFENDER', play.trivia),
          clientElapsedMs: 0,
        })
      ).json(),
    );
    expect(first.next?.kind).toBe('ESTIMATE');
    expect(first.resolution).toBeNull();
    const second = await answer(player, challengeId, 1, {
      rawInput: await estimateInput(challengeId, play.exactEstimate),
      locale: 'de',
      clientElapsedMs: 0,
    });
    expect(second.statusCode, second.body).toBe(200);
    return answerResponseSchema.parse(second.json());
  }

  async function regionsOf(instanceId: string) {
    return getServer()
      .db.selectFrom('regions as r')
      .innerJoin('region_state as s', 's.region_id', 'r.id')
      .select([
        'r.id',
        'r.q',
        'r.r',
        's.owner_kingdom_id',
        's.is_capital',
        's.active_siege_id',
        sql<boolean>`coalesce(s.protected_until > game_now(), false)`.as('protected'),
      ])
      .where('r.instance_id', '=', instanceId)
      .orderBy('r.id')
      .execute();
  }

  /** Neutrale, freie Nachbarregion einer Region. */
  async function neutralNextTo(instanceId: string, regionId: string): Promise<string> {
    const regions = await regionsOf(instanceId);
    const center = regions.find((r) => r.id === regionId);
    if (!center) throw new Error('Region fehlt');
    const target = regions.find(
      (r) =>
        r.owner_kingdom_id === null &&
        r.active_siege_id === null &&
        !r.protected &&
        areNeighbors(center, r),
    );
    if (!target) throw new Error('Keine neutrale Nachbarregion');
    return target.id;
  }

  /** Überträgt eine Region direkt in der Datenbank (Testaufbau) und hält die Regionszahlen gleich. */
  async function transferRegion(regionId: string, toKingdomId: string): Promise<void> {
    await getServer()
      .db.transaction()
      .execute(async (tx) => {
        const state = await tx
          .selectFrom('region_state')
          .select('owner_kingdom_id')
          .where('region_id', '=', regionId)
          .executeTakeFirstOrThrow();
        if (state.owner_kingdom_id) {
          await tx
            .updateTable('kingdoms')
            .set({ region_count: sql<number>`region_count - 1` })
            .where('id', '=', state.owner_kingdom_id)
            .execute();
        }
        await tx
          .updateTable('kingdoms')
          .set({ region_count: sql<number>`region_count + 1` })
          .where('id', '=', toKingdomId)
          .execute();
        await tx
          .updateTable('region_state')
          .set({
            owner_kingdom_id: toKingdomId,
            is_capital: false,
            owned_since: sql<Date>`game_now()`,
            protected_until: null,
            protection_reason: null,
          })
          .where('region_id', '=', regionId)
          .execute();
      });
  }

  async function clearProtection(kingdomId: string): Promise<void> {
    await getServer()
      .db.updateTable('kingdoms')
      .set({ protected_until: null, protection_reason: null })
      .where('id', '=', kingdomId)
      .execute();
  }

  /** Zwei Spieler in einer Welt; der Verteidiger besitzt eine Nachbarregion des Angreifers. */
  async function pvpPair(
    options: { rules?: RulesConfig; keepAttackerProtection?: boolean } = {},
  ): Promise<Pair> {
    const world = await createTestWorld(getServer().db, { rules: options.rules ?? PLAYTEST });
    const attacker = await newPlayer(world);
    const defender = await newPlayer(world);
    const instanceId = attacker.joined.instanceId;
    const target = await neutralNextTo(instanceId, attacker.joined.capitalRegionId);
    await transferRegion(target, defender.joined.kingdom.id);
    await clearProtection(defender.joined.kingdom.id);
    if (!options.keepAttackerProtection) await clearProtection(attacker.joined.kingdom.id);
    return { attacker, defender, target, instanceId };
  }

  return {
    newPlayer,
    attack,
    startAttack,
    answer,
    optionToken,
    estimateInput,
    playAttacker,
    startDefense,
    playDefender,
    regionsOf,
    neutralNextTo,
    transferRegion,
    clearProtection,
    pvpPair,
  };
}
