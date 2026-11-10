import { attackResponseSchema, type AttackResponse } from '@rdw/protocol';
import { z } from 'zod';

/**
 * Merkt sich die Antwort auf einen Angriff (Gegner, Region) für das Quiz, auch über einen
 * Reload hinweg. Nur Anzeige: Fehlt der Eintrag, zeigt das Quiz einen allgemeinen Text.
 */

const PREFIX = 'rdw.attack.';

const rememberedSchema = z.object({ attack: attackResponseSchema, regionLabel: z.string() });
export type RememberedAttack = z.infer<typeof rememberedSchema>;

export function rememberAttack(attack: AttackResponse, regionLabel: string): void {
  try {
    const entry: RememberedAttack = { attack, regionLabel };
    sessionStorage.setItem(PREFIX + attack.challengeId, JSON.stringify(entry));
  } catch {
    // Speicher nicht verfügbar (privater Modus): nur Anzeige betroffen
  }
}

export function recallAttack(challengeId: string): RememberedAttack | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + challengeId);
    if (!raw) return null;
    const parsed = rememberedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
