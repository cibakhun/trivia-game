import type { Db } from '@rdw/db';
import {
  chunkListSchema,
  entityIdSchema,
  regionIdSchema,
  type ChunkRef,
  type KingdomResponse,
  type MapStateResponse,
  type MapStaticResponse,
  type RegionDetailResponse,
} from '@rdw/protocol';
import type { FastifyInstance } from 'fastify';
import { sql, type ExpressionBuilder } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../context.ts';
import { readGameNow } from '../../infra/clock.ts';
import { sha256Hex } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { parseInput } from '../../infra/validation.ts';
import { eligibilityDto, loadAttackSituation } from '../combat/situation.ts';
import { settleOpenSiegesOfUser } from '../combat/sweeper.ts';
import { requireAuth } from '../identity/auth-hook.ts';
import { loadKingdomProfile, loadKingdoms } from '../kingdom/queries.ts';

/**
 * Karte (API.md §2.2, WORLD_SYSTEM §3.3): statische Chunk-Daten (unveränderlich, per ETag
 * cachebar), dynamischer Zustand mit Ereignisstand, Regions- und Reichsdetails. Kartendaten sind
 * für alle angemeldeten Spieler sichtbar, auch ohne Teilnahme.
 */

const instanceParams = z.object({ instanceId: entityIdSchema });
const chunkQuery = z.object({ chunks: chunkListSchema });

/** Bedingung „liegt in einem der Chunks“; nutzt die Indizes auf (instance_id, chunk_x, chunk_y). */
function inChunks(
  eb: ExpressionBuilder<{ c: { chunk_x: number; chunk_y: number } }, 'c'>,
  chunks: readonly ChunkRef[],
) {
  return eb.or(
    chunks.map((chunk) =>
      eb.and([eb('c.chunk_x', '=', chunk.chunkX), eb('c.chunk_y', '=', chunk.chunkY)]),
    ),
  );
}

function chunkKey(x: number, y: number): string {
  return `${x}:${y}`;
}

async function requireInstance(db: Db, instanceId: string) {
  const instance = await db
    .selectFrom('world_instances')
    .select(['id', 'mapgen_version'])
    .where('id', '=', instanceId)
    .executeTakeFirst();
  if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Instanz nicht gefunden');
  return instance;
}

export function mapRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/instances/:instanceId/map/static', async (request, reply) => {
    requireAuth(request);
    const { instanceId } = parseInput(instanceParams, request.params);
    const { chunks } = parseInput(chunkQuery, request.query);
    const instance = await requireInstance(ctx.db, instanceId);
    const rows = await ctx.db
      .selectFrom('regions as c')
      .select(['c.id', 'c.q', 'c.r', 'c.chunk_x', 'c.chunk_y', 'c.biome', 'c.tier'])
      .where('c.instance_id', '=', instanceId)
      .where((eb) => inChunks(eb, chunks))
      .orderBy('c.r')
      .orderBy('c.q')
      .execute();
    const byChunk = new Map(
      chunks.map((chunk) => [
        chunkKey(chunk.chunkX, chunk.chunkY),
        { ...chunk, regions: [] as MapStaticResponse['chunks'][number]['regions'] },
      ]),
    );
    for (const row of rows) {
      byChunk.get(chunkKey(row.chunk_x, row.chunk_y))?.regions.push({
        id: row.id,
        q: row.q,
        r: row.r,
        biome: row.biome,
        tier: row.tier,
      });
    }
    const body: MapStaticResponse = {
      instanceId,
      mapgenVersion: instance.mapgen_version,
      chunks: [...byChunk.values()],
    };
    const etag = `"${sha256Hex(JSON.stringify(body)).slice(0, 32)}"`;
    // Erzeugte Chunks ändern sich nie (regions_immutable); ein leerer Chunk kann mit einem
    // neuen Ring noch entstehen und wird deshalb nicht dauerhaft zwischengespeichert.
    const complete = body.chunks.every((chunk) => chunk.regions.length > 0);
    reply.header(
      'cache-control',
      complete ? 'private, max-age=31536000, immutable' : 'private, no-cache',
    );
    reply.header('etag', etag);
    if (request.headers['if-none-match'] === etag) return reply.status(304).send();
    return body;
  });

  app.get('/instances/:instanceId/map/state', async (request): Promise<MapStateResponse> => {
    requireAuth(request);
    const { instanceId } = parseInput(instanceParams, request.params);
    const { chunks } = parseInput(chunkQuery, request.query);
    // Ein Schnappschuss für Ereignisstand und Zustand: Der Client setzt danach mit seq fort.
    return ctx.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (tx) => {
        const instance = await tx
          .selectFrom('world_instances')
          .select(['event_seq', sql<Date>`game_now()`.as('now')])
          .where('id', '=', instanceId)
          .executeTakeFirst();
        if (!instance) throw new ApiError(404, 'NOT_FOUND', 'Instanz nicht gefunden');
        const rows = await tx
          .selectFrom('region_state as c')
          .select([
            'c.region_id',
            'c.chunk_x',
            'c.chunk_y',
            'c.owner_kingdom_id',
            'c.is_capital',
            sql<Date | null>`case when c.protected_until > game_now() then c.protected_until end`.as(
              'protected_until',
            ),
            sql<boolean>`c.active_siege_id is not null`.as('under_siege'),
          ])
          .where('c.instance_id', '=', instanceId)
          .where((eb) => inChunks(eb, chunks))
          .orderBy('c.region_id')
          .execute();
        const byChunk = new Map(
          chunks.map((chunk) => [
            chunkKey(chunk.chunkX, chunk.chunkY),
            { ...chunk, regions: [] as MapStateResponse['chunks'][number]['regions'] },
          ]),
        );
        const owners = new Set<string>();
        for (const row of rows) {
          if (row.owner_kingdom_id) owners.add(row.owner_kingdom_id);
          byChunk.get(chunkKey(row.chunk_x, row.chunk_y))?.regions.push({
            id: row.region_id,
            ownerKingdomId: row.owner_kingdom_id,
            isCapital: row.is_capital,
            protectedUntil: row.protected_until?.toISOString() ?? null,
            underSiege: row.under_siege,
          });
        }
        const kingdoms = await loadKingdoms(tx, instanceId, [...owners]);
        return {
          instanceId,
          seq: instance.event_seq,
          chunks: [...byChunk.values()],
          kingdoms: [...kingdoms.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
          serverTime: instance.now.toISOString(),
        };
      });
  });

  app.get(
    '/instances/:instanceId/regions/:regionId',
    async (request): Promise<RegionDetailResponse> => {
      const auth = requireAuth(request);
      const { instanceId, regionId } = parseInput(
        instanceParams.extend({ regionId: regionIdSchema }),
        request.params,
      );
      // Fällige eigene Kämpfe zuerst auflösen, damit Belagerung und Berechtigung stimmen.
      await settleOpenSiegesOfUser(ctx.db, auth.userId);
      const row = await ctx.db
        .selectFrom('regions as r')
        .innerJoin('region_state as s', 's.region_id', 'r.id')
        .select([
          'r.id',
          'r.q',
          'r.r',
          'r.chunk_x',
          'r.chunk_y',
          'r.biome',
          'r.tier',
          's.owner_kingdom_id',
          's.is_capital',
          's.owned_since',
          sql<Date | null>`case when s.protected_until > game_now() then s.protected_until end`.as(
            'protected_until',
          ),
          sql<
            string | null
          >`case when s.protected_until > game_now() then s.protection_reason end`.as(
            'protection_reason',
          ),
          sql<boolean>`s.active_siege_id is not null`.as('under_siege'),
        ])
        .where('r.id', '=', regionId)
        .where('r.instance_id', '=', instanceId)
        .executeTakeFirst();
      if (!row) throw new ApiError(404, 'NOT_FOUND', 'Region nicht gefunden');
      const owner = row.owner_kingdom_id
        ? ((await loadKingdoms(ctx.db, instanceId, [row.owner_kingdom_id])).get(
            row.owner_kingdom_id,
          ) ?? null)
        : null;
      const situation = await loadAttackSituation(ctx.db, {
        instanceId,
        userId: auth.userId,
        regionId,
      });
      return {
        region: {
          id: row.id,
          q: row.q,
          r: row.r,
          chunkX: row.chunk_x,
          chunkY: row.chunk_y,
          biome: row.biome,
          tier: row.tier,
          ownerKingdomId: row.owner_kingdom_id,
          isCapital: row.is_capital,
          ownedSince: row.owned_since?.toISOString() ?? null,
          protectedUntil: row.protected_until?.toISOString() ?? null,
          protectionReason:
            row.protection_reason === 'CONQUEST' || row.protection_reason === 'ADMIN'
              ? row.protection_reason
              : null,
          underSiege: row.under_siege,
        },
        owner,
        attack: eligibilityDto(situation.eligibility),
        serverTime: situation.now.toISOString(),
      };
    },
  );

  app.get(
    '/instances/:instanceId/kingdoms/:kingdomId',
    async (request): Promise<KingdomResponse> => {
      requireAuth(request);
      const { instanceId, kingdomId } = parseInput(
        instanceParams.extend({ kingdomId: entityIdSchema }),
        request.params,
      );
      const kingdom = await loadKingdomProfile(ctx.db, instanceId, kingdomId);
      if (!kingdom) throw new ApiError(404, 'NOT_FOUND', 'Reich nicht gefunden');
      const now = await readGameNow(ctx.db);
      return { kingdom, serverTime: now.toISOString() };
    },
  );
}
