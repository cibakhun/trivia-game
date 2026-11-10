import type { Db, Tx } from '@rdw/db';
import {
  createRng,
  isKingdomNameParts,
  isPlayerNameParts,
  kingdomName,
  playerDisplayName,
  suggestKingdomNames,
  suggestPlayerNames,
  type KingdomNameParts,
  type PlayerNameParts,
} from '@rdw/game-core';
import type { ProfileDto } from '@rdw/protocol';
import { randomBytes } from 'node:crypto';
import { gameNow } from '../../infra/clock.ts';
import { ApiError, isUniqueViolation } from '../../infra/errors.ts';

/**
 * Öffentliche Namen (O-10, ADR-044): Spieler- und Reichsnamen werden aus Vorschlägen gewählt,
 * die der Server aus festen Bausteinen bildet. Gewählt werden darf jede gültige Kombination der
 * Bausteine, nicht nur ein gerade gezeigter Vorschlag: Freier Text ist so ausgeschlossen, ohne
 * dass der Server sich Vorschläge merken muss.
 */

export const SUGGESTION_COUNT = 5;

/** Vorschläge müssen nicht nachrechenbar sein; jeder Aufruf zieht neu. */
function freshRng() {
  return createRng(new Uint8Array(randomBytes(16)));
}

export function parsePlayerName(value: unknown): PlayerNameParts {
  if (!isPlayerNameParts(value)) {
    throw new ApiError(422, 'INVALID_NAME', 'Name nicht aus den erlaubten Bausteinen');
  }
  return { adjective: value.adjective, noun: value.noun, number: value.number };
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
    .select(['display_name', 'name_parts'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!row) return { displayName: null, playerName: null };
  const parts = isPlayerNameParts(row.name_parts) ? row.name_parts : null;
  return {
    displayName: row.display_name,
    playerName: parts
      ? { adjective: parts.adjective, noun: parts.noun, number: parts.number }
      : null,
  };
}

/**
 * Setzt den Spielernamen (neu oder geändert). Vergebene Namen ergeben `PLAYER_NAME_TAKEN`; die
 * Prüfung macht der eindeutige Index, so gibt es kein Rennen zwischen Prüfen und Schreiben.
 */
export async function setPlayerName(
  tx: Tx,
  userId: string,
  parts: PlayerNameParts,
): Promise<string> {
  const displayName = playerDisplayName(parts);
  try {
    await tx
      .insertInto('player_profiles')
      .values({
        user_id: userId,
        display_name: displayName,
        name_parts: JSON.stringify(parts),
        created_at: gameNow,
        updated_at: gameNow,
      })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet({
          display_name: displayName,
          name_parts: JSON.stringify(parts),
          updated_at: gameNow,
        }),
      )
      .execute();
  } catch (error) {
    if (isUniqueViolation(error, 'player_profiles_display_name_key')) {
      throw new ApiError(409, 'PLAYER_NAME_TAKEN', 'Spielername ist vergeben', { displayName });
    }
    throw error;
  }
  return displayName;
}

/** Freie Spielernamen: Vorschläge ziehen, vergebene aussortieren, bei Bedarf nachziehen. */
export async function playerNameSuggestions(db: Db): Promise<PlayerNameParts[]> {
  const rng = freshRng();
  const taken = new Set<string>();
  const result: PlayerNameParts[] = [];
  for (let round = 0; round < 3 && result.length < SUGGESTION_COUNT; round++) {
    const candidates = suggestPlayerNames(rng, taken, SUGGESTION_COUNT * 2);
    if (candidates.length === 0) break;
    const names = candidates.map(playerDisplayName);
    const rows = await db
      .selectFrom('player_profiles')
      .select('display_name')
      .where('display_name', 'in', names)
      .execute();
    for (const row of rows) taken.add(row.display_name);
    for (const parts of candidates) {
      const name = playerDisplayName(parts);
      if (taken.has(name) || result.length >= SUGGESTION_COUNT) continue;
      taken.add(name);
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
