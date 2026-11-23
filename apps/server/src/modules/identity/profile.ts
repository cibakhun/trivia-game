import type { Db, Tx } from '@rdw/db';
import {
  createRng,
  isKingdomNameParts,
  kingdomName,
  playerDisplayName,
  suggestKingdomNames,
  suggestPlayerNames,
  type KingdomNameParts,
  type PlayerNameParts,
} from '@rdw/game-core';
import {
  normalizeUsername,
  usernameProblem,
  type NameCheckStatus,
  type ProfileDto,
} from '@rdw/protocol';
import { sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { gameNow } from '../../infra/clock.ts';
import { ApiError, isUniqueViolation } from '../../infra/errors.ts';
import { nameAllowed } from './name-filter.ts';

/**
 * Öffentliche Namen. Spieler (ADR-082, löst O-10 für Spielernamen ab): Der Spieler tippt seinen
 * Benutzernamen selbst; er ist Anmeldename und Spielername zugleich. Der Server prüft Regeln,
 * Wortfilter und ob der Name (auch in anderer Schreibweise) schon vergeben ist. Vorschläge aus
 * Bausteinen (ADR-044) gibt es weiter als Ideen. Reichsnamen (Eternal) bleiben aus Bausteinen.
 */

export const SUGGESTION_COUNT = 5;

/** Vorschläge müssen nicht nachrechenbar sein; jeder Aufruf zieht neu. */
function freshRng() {
  return createRng(new Uint8Array(randomBytes(16)));
}

/**
 * Prüft einen getippten Namen auf Regeln und Wortfilter. Das Schema hat ihn schon vereinheitlicht
 * und auf die Regeln geprüft; hier kommt der Wortfilter dazu.
 */
export function assertNameAllowed(name: string): void {
  if (!nameAllowed(name)) {
    throw new ApiError(422, 'NAME_NOT_ALLOWED', 'Dieser Name ist nicht erlaubt');
  }
}

/**
 * Ist der Name (in irgendeiner Schreibweise) schon vergeben, als Spielername oder als
 * Anmeldename eines anderen Kontos? `exceptUserId`: das eigene Konto beim Umbenennen.
 */
export async function nameTaken(
  db: Db | Tx,
  name: string,
  exceptUserId: string | null,
): Promise<boolean> {
  const except = exceptUserId ?? '00000000-0000-0000-0000-000000000000';
  const row = await db
    .selectNoFrom((eb) => [
      eb
        .exists(
          eb
            .selectFrom('player_profiles')
            .select(sql`1`.as('one'))
            .where(sql<boolean>`player_name_key(display_name) = player_name_key(${name})`)
            .where('user_id', '<>', except),
        )
        .as('profile'),
      eb
        .exists(
          eb
            .selectFrom('users')
            .select(sql`1`.as('one'))
            .where('username', 'is not', null)
            .where(sql<boolean>`player_name_key(username::text) = player_name_key(${name})`)
            .where('id', '<>', except),
        )
        .as('login'),
    ])
    .executeTakeFirstOrThrow();
  return Boolean(row.profile) || Boolean(row.login);
}

/** Antwort auf `GET /names/check`: Regeln, Wortfilter, eigener Name, vergeben. */
export async function checkName(
  db: Db,
  raw: string,
  userId: string,
): Promise<{ name: string; status: NameCheckStatus }> {
  const name = normalizeUsername(raw);
  if (usernameProblem(name) !== null) return { name, status: 'INVALID' };
  if (!nameAllowed(name)) return { name, status: 'BLOCKED' };
  const own = await db
    .selectFrom('player_profiles')
    .select('display_name')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (own?.display_name === name) return { name, status: 'MINE' };
  return { name, status: (await nameTaken(db, name, userId)) ? 'TAKEN' : 'FREE' };
}

export function parseKingdomName(value: unknown): KingdomNameParts {
  if (!isKingdomNameParts(value)) {
    throw new ApiError(422, 'INVALID_NAME', 'Name nicht aus den erlaubten Bausteinen');
  }
  return { prefix: value.prefix, suffix: value.suffix };
}

export async function loadProfile(db: Db, userId: string): Promise<ProfileDto> {
  const row = await db
    .selectFrom('player_profiles')
    .select(['display_name'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return { displayName: row?.display_name ?? null };
}

/**
 * Setzt den Spielernamen (neu oder geändert) und bei gesicherten Konten den Anmeldenamen gleich
 * mit (ADR-082: ein Name für beides). Läuft in einer Transaktion. Erst die Prüfung auf andere
 * Schreibweisen, dann schreiben; ein gleichzeitiger Doppelgänger scheitert an den eindeutigen
 * Indizes (`player_profiles_name_key_unique`, `users_username_unique`). Beides ergibt
 * `USERNAME_TAKEN`.
 */
export async function setPlayerName(
  tx: Tx,
  userId: string,
  name: string,
  options: { readonly login: boolean },
): Promise<string> {
  if (await nameTaken(tx, name, userId)) {
    throw new ApiError(409, 'USERNAME_TAKEN', 'Benutzername ist vergeben');
  }
  try {
    if (options.login) {
      await tx.updateTable('users').set({ username: name }).where('id', '=', userId).execute();
    }
    await tx
      .insertInto('player_profiles')
      .values({
        user_id: userId,
        display_name: name,
        name_parts: null,
        created_at: gameNow,
        updated_at: gameNow,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          display_name: name,
          name_parts: null,
          updated_at: gameNow,
        }),
      )
      .execute();
  } catch (error) {
    if (
      isUniqueViolation(error, 'users_username_unique') ||
      isUniqueViolation(error, 'player_profiles_name_key_unique') ||
      isUniqueViolation(error, 'player_profiles_display_name_key')
    ) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'Benutzername ist vergeben');
    }
    throw error;
  }
  return name;
}

/**
 * Ideen für einen Namen (ADR-082): Namen aus Bausteinen, die als Benutzername passen (etwa
 * höchstens 20 Zeichen) und in keiner Schreibweise vergeben sind; bei Bedarf wird nachgezogen.
 */
export async function playerNameSuggestions(db: Db): Promise<PlayerNameParts[]> {
  const rng = freshRng();
  const seen = new Set<string>();
  const result: PlayerNameParts[] = [];
  for (let round = 0; round < 3 && result.length < SUGGESTION_COUNT; round++) {
    const candidates = suggestPlayerNames(rng, seen, SUGGESTION_COUNT * 2).filter((parts) => {
      const name = playerDisplayName(parts);
      return usernameProblem(name) === null && nameAllowed(name);
    });
    for (const parts of candidates) seen.add(playerDisplayName(parts));
    if (candidates.length === 0) continue;
    const names = candidates.map(playerDisplayName);
    const rows = await sql<{ name: string }>`
      select n.name from unnest(${names}::text[]) as n(name)
      where exists (select 1 from player_profiles p
                    where player_name_key(p.display_name) = player_name_key(n.name))
         or exists (select 1 from users u
                    where u.username is not null
                      and player_name_key(u.username::text) = player_name_key(n.name))`.execute(db);
    const taken = new Set(rows.rows.map((row) => row.name));
    for (const parts of candidates) {
      const name = playerDisplayName(parts);
      if (taken.has(name) || result.length >= SUGGESTION_COUNT) continue;
      result.push(parts);
    }
  }
  return result;
}

/** Reichsnamen, die in der Instanz noch nicht vorkommen (Eindeutigkeit ist kein Muss). */
export async function kingdomNameSuggestions(
  db: Db,
  instanceId: string,
): Promise<KingdomNameParts[]> {
  const rows = await db
    .selectFrom('kingdoms')
    .select('name_parts')
    .where('instance_id', '=', instanceId)
    .execute();
  const taken = new Set<string>();
  for (const row of rows) {
    if (isKingdomNameParts(row.name_parts)) taken.add(kingdomName(row.name_parts));
  }
  return suggestKingdomNames(freshRng(), taken, SUGGESTION_COUNT);
}
