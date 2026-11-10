import { newId, type Tx } from '@rdw/db';
import {
  RNG_VERSION,
  chooseStartRegion,
  createRng,
  deriveSeed,
  generateKingdomName,
  kingdomName,
  kingdomRank,
  pickKingdomColor,
  spawnCandidates,
  tutorialTarget,
  type KingdomNameParts,
} from '@rdw/game-core';
import { parseRulesConfig, type JoinResponse, type RulesConfig } from '@rdw/protocol';
import { sql } from 'kysely';
import { gameNow, intervalMs } from '../../infra/clock.ts';
import { ApiError } from '../../infra/errors.ts';
import { loadSpawnSnapshot } from './spawn-snapshot.ts';

/**
 * Beitritt zu einer Welt und Neustart nach Totalverlust (API.md §2.2, WORLD_SYSTEM §4.2,
 * GAME_RULES §3 Punkt 6): Startregion wählen, Reich gründen, Hauptstadt setzen. Läuft in der
 * Transaktion des Idempotenzspeichers.
 *
 * Sperren: zuerst die Instanzzeile (`for update`), damit gleichzeitige Beitritte nacheinander
 * wählen und sich nicht dieselbe Region oder zu nahe Hauptstädte zuteilen. Die Zielregion wird
 * bedingt aktualisiert (noch neutral, keine Belagerung); hat sie inzwischen jemand anderes, endet
 * der Beitritt mit `CONCURRENT_UPDATE` und kann wiederholt werden.
 */

export interface JoinContext {
  readonly userId: string;
  readonly worldId: string;
  readonly rngSecret: Uint8Array;
  readonly rngKeyId: string;
  /** Vom Spieler gewählter Reichsname (geprüfte Bausteine); sonst gezogen (O-10, ADR-044). */
  readonly kingdomName?: KingdomNameParts | undefined;
}

export async function joinWorld(tx: Tx, ctx: JoinContext): Promise<JoinResponse> {
  const world = await tx
    .selectFrom('worlds')
    .select(['id', 'mode'])
    .where('id', '=', ctx.worldId)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirst();
  if (!world) throw new ApiError(404, 'NOT_FOUND', 'Welt nicht gefunden');

  const instance = await tx
    .selectFrom('world_instances as i')
    .innerJoin('world_rules as wr', 'wr.id', 'i.rules_id')
    .select(['i.id', 'i.capacity', 'wr.config'])
    .where('i.world_id', '=', world.id)
    .where('i.status', '=', 'RUNNING')
    .orderBy('i.starts_at', 'desc')
    .orderBy('i.id', 'desc')
    .limit(1)
    .forUpdate('i')
    .executeTakeFirst();
  if (!instance) throw new ApiError(409, 'INSTANCE_NOT_ACTIVE', 'Keine laufende Instanz');
  const instanceId = instance.id;

  const participation = await tx
    .selectFrom('world_participants')
    .select('status')
    .where('instance_id', '=', instanceId)
    .where('user_id', '=', ctx.userId)
    .executeTakeFirst();
  if (participation) {
    throw new ApiError(409, 'ALREADY_JOINED', 'Bereits beigetreten', { instanceId });
  }
  const { participants } = await tx
    .selectFrom('world_participants')
    .select((eb) => eb.fn.countAll<string>().as('participants'))
    .where('instance_id', '=', instanceId)
    .where('status', '=', 'ACTIVE')
    .executeTakeFirstOrThrow();
  if (Number(participants) >= instance.capacity) {
    throw new ApiError(409, 'INSTANCE_FULL', 'Instanz ist voll', { instanceId });
  }
  const rules = parseRulesConfig(instance.config);
  const founded = await foundKingdom(tx, {
    userId: ctx.userId,
    instanceId,
    rules,
    rngSecret: ctx.rngSecret,
    rngKeyId: ctx.rngKeyId,
    source: 'JOIN',
    chosenName: ctx.kingdomName,
  });
  await tx
    .insertInto('world_participants')
    .values({
      instance_id: instanceId,
      user_id: ctx.userId,
      joined_at: gameNow,
      current_kingdom_id: founded.kingdom.id,
      last_active_at: gameNow,
    })
    .execute();
  return founded;
}

export interface RespawnContext {
  readonly userId: string;
  readonly instanceId: string;
  readonly rngSecret: Uint8Array;
  readonly rngKeyId: string;
  readonly kingdomName?: KingdomNameParts | undefined;
}

/**
 * Neustart nach Totalverlust (GAME_RULES §3 Punkt 6): Ist das aktuelle Reich des Spielers
 * gefallen, gründet er sofort ein neues in einer geeigneten Startregion, mit Wiederaufbauschutz
 * (`protection.respawn`). Das gefallene Reich bleibt mit Statistik und Historie erhalten.
 */
export async function respawnKingdom(tx: Tx, ctx: RespawnContext): Promise<JoinResponse> {
  const instance = await tx
    .selectFrom('world_instances as i')
    .innerJoin('world_rules as wr', 'wr.id', 'i.rules_id')
    .select(['i.id', 'i.status', 'wr.config'])
    .where('i.id', '=', ctx.instanceId)
    .forUpdate('i')
    .executeTakeFirst();
  if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Instanz nicht gefunden');
  if (instance.status !== 'RUNNING') {
    throw new ApiError(409, 'INSTANCE_NOT_ACTIVE', 'Instanz läuft nicht');
  }
  const participation = await tx
    .selectFrom('world_participants as p')
    .leftJoin('kingdoms as k', 'k.id', 'p.current_kingdom_id')
    .select(['p.status', 'k.status as kingdom_status'])
    .where('p.instance_id', '=', ctx.instanceId)
    .where('p.user_id', '=', ctx.userId)
    .executeTakeFirst();
  if (participation?.status !== 'ACTIVE') {
    throw new ApiError(404, 'NOT_FOUND', 'Nicht beigetreten');
  }
  if (participation.kingdom_status === 'ACTIVE') {
    throw new ApiError(409, 'KINGDOM_ACTIVE', 'Dein Reich besteht noch');
  }
  const founded = await foundKingdom(tx, {
    userId: ctx.userId,
    instanceId: ctx.instanceId,
    rules: parseRulesConfig(instance.config),
    rngSecret: ctx.rngSecret,
    rngKeyId: ctx.rngKeyId,
    source: 'RESPAWN',
    chosenName: ctx.kingdomName,
  });
  await tx
    .updateTable('world_participants')
    .set({ current_kingdom_id: founded.kingdom.id, last_active_at: gameNow })
    .where('instance_id', '=', ctx.instanceId)
    .where('user_id', '=', ctx.userId)
    .execute();
  return founded;
}

interface FoundParams {
  readonly userId: string;
  readonly instanceId: string;
  readonly rules: RulesConfig;
  readonly rngSecret: Uint8Array;
  readonly rngKeyId: string;
  /** Erster Beitritt (Anfängerschutz) oder Neustart (Wiederaufbauschutz). */
  readonly source: 'JOIN' | 'RESPAWN';
  readonly chosenName: KingdomNameParts | undefined;
}

/** Gründet das nächste Reich des Spielers; die Teilnahme schreibt der Aufrufer. */
async function foundKingdom(tx: Tx, ctx: FoundParams): Promise<JoinResponse> {
  const { instanceId, rules } = ctx;
  // n-tes Reich des Spielers in dieser Instanz
  const { previous } = await tx
    .selectFrom('kingdoms')
    .select((eb) => eb.fn.coalesce(eb.fn.max('generation'), eb.lit(0)).as('previous'))
    .where('instance_id', '=', instanceId)
    .where('owner_user_id', '=', ctx.userId)
    .executeTakeFirstOrThrow();
  const generation = Number(previous) + 1;

  const snapshot = await loadSpawnSnapshot(tx, instanceId);
  const candidates = spawnCandidates(snapshot.regions, snapshot.kingdoms);
  // Zufallsstrom „spawn“ je Spieler, Instanz und Reichsgeneration: Gleichstand, Name, Farbe
  const entityId = `${instanceId}.${ctx.userId}.${generation}`;
  const rng = createRng(await deriveSeed(ctx.rngSecret, 'spawn', entityId));
  const chosen = chooseStartRegion(candidates, rng);
  if (!chosen)
    throw new ApiError(409, 'NO_START_REGION', 'Keine freie Startregion', { instanceId });
  const start = snapshot.regions.find((region) => region.id === chosen.id);
  if (!start) throw new Error('Startregion fehlt im Schnappschuss');
  // Gezogen wird immer, damit die Folge des Zufallsstroms (Farbe) nicht von der Wahl abhängt.
  const drawn = generateKingdomName(rng, snapshot.names);
  const name = ctx.chosenName ?? drawn;
  const color = pickKingdomColor(rng, snapshot.colorUsage);

  const kingdomId = newId();
  const respawn = ctx.source === 'RESPAWN';
  const protection = respawn ? rules.protection.respawn : rules.protection.newPlayer.duration;
  const protectionReason = respawn ? 'RESPAWN' : 'NEWBIE';
  const kingdom = await tx
    .insertInto('kingdoms')
    .values({
      id: kingdomId,
      instance_id: instanceId,
      kind: 'PLAYER',
      owner_user_id: ctx.userId,
      name_parts: JSON.stringify(name),
      color,
      region_count: 1,
      protected_until: protection > 0 ? sql<Date>`game_now() + ${intervalMs(protection)}` : null,
      protection_reason: protection > 0 ? protectionReason : null,
      generation,
      founded_at: gameNow,
    })
    .returning(['protected_until'])
    .executeTakeFirstOrThrow();
  const claimed = await tx
    .updateTable('region_state')
    .set({
      owner_kingdom_id: kingdomId,
      is_capital: true,
      owned_since: gameNow,
      version: sql<string>`version + 1`,
      updated_at: gameNow,
    })
    .where('region_id', '=', start.id)
    .where('instance_id', '=', instanceId)
    .where('owner_kingdom_id', 'is', null)
    .where('active_siege_id', 'is', null)
    .executeTakeFirst();
  if (claimed.numUpdatedRows !== 1n) {
    throw new ApiError(
      409,
      'CONCURRENT_UPDATE',
      'Startregion wurde gerade vergeben, bitte wiederholen',
    );
  }
  await tx
    .insertInto('kingdom_statistics')
    .values({ kingdom_id: kingdomId, max_regions: 1, updated_at: gameNow })
    .execute();
  // Prüfspur der Wahl (ARCHITECTURE §9): Schlüssel, Verfahren, Kandidaten
  const best = candidates.find((c) => c.region.id === start.id);
  await tx
    .insertInto('kingdom_history')
    .values({
      kingdom_id: kingdomId,
      kind: 'FOUNDED',
      payload: JSON.stringify({
        source: ctx.source,
        generation,
        capitalRegionId: start.id,
        spawn: {
          candidates: candidates.length,
          score: best?.score ?? null,
          rngPurpose: 'spawn',
          rngEntityId: entityId,
          rngKeyId: ctx.rngKeyId,
          rngVersion: RNG_VERSION,
        },
      }),
      at: gameNow,
    })
    .execute();
  await tx
    .insertInto('region_history')
    .values({
      region_id: start.id,
      instance_id: instanceId,
      from_kingdom_id: null,
      to_kingdom_id: kingdomId,
      cause: 'START_CLAIM',
      at: gameNow,
    })
    .execute();
  const rank = kingdomRank(1);
  await tx
    .insertInto('world_events')
    .values([
      {
        instance_id: instanceId,
        chunk_x: start.chunkX,
        chunk_y: start.chunkY,
        type: 'region.changed',
        payload: JSON.stringify({
          regionId: start.id,
          ownerKingdomId: kingdomId,
          isCapital: true,
          protectedUntil: null,
          underSiege: false,
        }),
        created_at: gameNow,
      },
      {
        instance_id: instanceId,
        chunk_x: start.chunkX,
        chunk_y: start.chunkY,
        type: 'kingdom.changed',
        payload: JSON.stringify({
          kingdomId,
          regionCount: 1,
          rank,
          capitalRegionId: start.id,
        }),
        created_at: gameNow,
      },
    ])
    .execute();

  const { now } = await tx.selectNoFrom(gameNow.as('now')).executeTakeFirstOrThrow();
  return {
    instanceId,
    kingdom: {
      id: kingdomId,
      kind: 'PLAYER',
      name: kingdomName(name),
      nameParts: { prefix: name.prefix, suffix: name.suffix },
      color,
      status: 'ACTIVE',
      regionCount: 1,
      rank,
      archetype: null,
      capitalRegionId: start.id,
      protectedUntil: kingdom.protected_until?.toISOString() ?? null,
      protectionReason: kingdom.protected_until ? protectionReason : null,
    },
    capitalRegionId: start.id,
    // Nachbarn aus dem Schnappschuss: Die Startregion selbst ist kein Nachbar.
    tutorialTargetRegionId: tutorialTarget(snapshot.regions, start)?.id ?? null,
    serverTime: now.toISOString(),
  };
}
