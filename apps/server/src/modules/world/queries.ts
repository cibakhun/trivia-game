import type { Db } from '@rdw/db';
import type { MyInstance, WorldsResponse } from '@rdw/protocol';
import { sql } from 'kysely';
import { loadKingdoms } from '../kingdom/queries.ts';
import { tutorialTargetNear } from './spawn-snapshot.ts';

type WorldMode = WorldsResponse['worlds'][number]['mode'];
type InstanceStatus = MyInstance['status'];

/** Aktive Welten mit ihren beitretbaren Instanzen (API.md §2.2). */
export async function listWorlds(db: Db, userId: string): Promise<WorldsResponse['worlds']> {
  const rows = await db
    .selectFrom('worlds as w')
    .innerJoin('world_instances as i', 'i.world_id', 'w.id')
    .select([
      'w.id as world_id',
      'w.slug',
      'w.mode',
      'w.name_key',
      'i.id as instance_id',
      'i.status',
      'i.capacity',
      'i.starts_at',
      'i.ends_at',
      sql<string | null>`case when i.ends_at is null then null
        else greatest(0, floor(extract(epoch from (i.ends_at - game_now())) * 1000))::bigint end`.as(
        'remaining_ms',
      ),
      (eb) =>
        eb
          .selectFrom('world_participants as p')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('p.instance_id', '=', 'i.id')
          .where('p.status', '=', 'ACTIVE')
          .as('participants'),
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom('world_participants as me')
              .select('me.user_id')
              .whereRef('me.instance_id', '=', 'i.id')
              .where('me.user_id', '=', userId),
          )
          .$castTo<boolean>()
          .as('joined'),
    ])
    .where('w.status', '=', 'ACTIVE')
    .where('i.status', '=', 'RUNNING')
    .orderBy('w.slug')
    .orderBy('i.starts_at')
    .execute();

  const worlds = new Map<string, WorldsResponse['worlds'][number]>();
  for (const row of rows) {
    let world = worlds.get(row.world_id);
    if (!world) {
      world = {
        id: row.world_id,
        slug: row.slug,
        mode: row.mode as WorldMode,
        nameKey: row.name_key,
        instances: [],
      };
      worlds.set(row.world_id, world);
    }
    world.instances.push({
      id: row.instance_id,
      status: row.status as InstanceStatus,
      capacity: row.capacity,
      participants: Number(row.participants ?? 0),
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at?.toISOString() ?? null,
      remainingMs: row.remaining_ms === null ? null : Number(row.remaining_ms),
      joined: row.joined,
    });
  }
  return [...worlds.values()];
}

/**
 * Instanzen, an denen der Spieler teilnimmt, mit aktuellem Reich, Tutorial-Ziel, laufender
 * Herausforderung und Zahl der offenen Belagerungen gegen sein Reich. Fällige Kämpfe löst der
 * Aufrufer vorher auf.
 */
export async function listMyInstances(db: Db, userId: string): Promise<MyInstance[]> {
  const rows = await db
    .selectFrom('world_participants as p')
    .innerJoin('world_instances as i', 'i.id', 'p.instance_id')
    .innerJoin('worlds as w', 'w.id', 'i.world_id')
    .leftJoin('region_state as c', (join) =>
      join.onRef('c.owner_kingdom_id', '=', 'p.current_kingdom_id').on('c.is_capital', '=', true),
    )
    .leftJoin('regions as cr', 'cr.id', 'c.region_id')
    .select([
      'p.instance_id',
      'p.current_kingdom_id',
      'i.world_id',
      'i.status',
      'w.slug',
      'w.mode',
      'cr.q',
      'cr.r',
    ])
    .where('p.user_id', '=', userId)
    .where('p.status', '=', 'ACTIVE')
    .orderBy('p.joined_at')
    .execute();

  const result: MyInstance[] = [];
  for (const row of rows) {
    const kingdom = row.current_kingdom_id
      ? ((await loadKingdoms(db, row.instance_id, [row.current_kingdom_id])).get(
          row.current_kingdom_id,
        ) ?? null)
      : null;
    const tutorial =
      kingdom?.status === 'ACTIVE' && kingdom.regionCount === 1 && row.q !== null && row.r !== null
        ? await tutorialTargetNear(db, row.instance_id, { q: row.q, r: row.r })
        : null;
    const kingdomId = row.current_kingdom_id;
    // Laufende Herausforderung: eigener Angriff in Vorbereitung oder begonnene Verteidigung
    const open = kingdomId
      ? await db
          .selectFrom('sieges as s')
          .innerJoin('quiz_challenges as c', 'c.siege_id', 's.id')
          .select('c.id')
          .where((eb) =>
            eb.or([
              eb.and([
                eb('s.attacker_kingdom_id', '=', kingdomId),
                eb('s.status', '=', 'PREPARING'),
              ]),
              eb.and([
                eb('s.defender_kingdom_id', '=', kingdomId),
                eb('s.status', '=', 'DEFENDING'),
              ]),
            ]),
          )
          .orderBy('s.created_at')
          .executeTakeFirst()
      : undefined;
    const incoming = kingdomId
      ? await db
          .selectFrom('sieges')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('defender_kingdom_id', '=', kingdomId)
          .where('status', 'in', ['AWAITING_DEFENSE', 'DEFENDING'])
          .executeTakeFirstOrThrow()
      : undefined;
    result.push({
      instanceId: row.instance_id,
      worldId: row.world_id,
      worldSlug: row.slug,
      mode: row.mode as WorldMode,
      status: row.status as InstanceStatus,
      kingdom,
      tutorialTargetRegionId: tutorial,
      openChallengeId: open?.id ?? null,
      incomingSieges: Number(incoming?.n ?? 0),
    });
  }
  return result;
}
