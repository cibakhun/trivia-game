import { newId, type Db } from '@rdw/db';
import { gameNow } from '../../infra/clock.ts';
import { hashToken } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { createSession } from './sessions.ts';

/**
 * Gastkonto (API.md §1): je Bootstrap-Cookie höchstens ein Konto. Eine Wiederholung – etwa weil
 * die Antwort verloren ging – findet das Konto und stellt eine neue Sitzung aus, solange noch
 * keine authentifizierte Anfrage eingegangen ist (`users.last_seen_at` leer).
 */
export async function createOrResumeGuest(
  db: Db,
  bootstrapToken: string,
): Promise<{ userId: string; sessionToken: string; created: boolean }> {
  const bootstrapHash = hashToken(bootstrapToken);
  return db.transaction().execute(async (tx) => {
    const inserted = await tx
      .insertInto('users')
      .values({
        id: newId(),
        is_guest: true,
        guest_bootstrap_hash: bootstrapHash,
        created_at: gameNow,
      })
      .onConflict((oc) =>
        oc.column('guest_bootstrap_hash').where('guest_bootstrap_hash', 'is not', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (inserted) {
      await tx.insertInto('player_settings').values({ user_id: inserted.id }).execute();
      await tx
        .insertInto('player_statistics')
        .values({ user_id: inserted.id, updated_at: gameNow })
        .execute();
      return {
        userId: inserted.id,
        sessionToken: await createSession(tx, inserted.id),
        created: true,
      };
    }
    const existing = await tx
      .selectFrom('users')
      .select(['id', 'last_seen_at', 'deleted_at', 'deletion_requested_at'])
      .where('guest_bootstrap_hash', '=', bootstrapHash)
      .executeTakeFirstOrThrow();
    if (existing.last_seen_at || existing.deleted_at || existing.deletion_requested_at) {
      throw new ApiError(
        409,
        'GUEST_BOOTSTRAP_USED',
        'Gastkonto zu diesem Cookie wird schon benutzt',
      );
    }
    return {
      userId: existing.id,
      sessionToken: await createSession(tx, existing.id),
      created: false,
    };
  });
}
