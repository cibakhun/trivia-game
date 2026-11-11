import type { MatchEventOf, ParsedMatchEvent } from '@rdw/protocol';
import type { SoundCue } from '../audio/sound.ts';
import type { MatchScreenState } from './match-model.ts';

/**
 * Welche Klänge neue Ereignisse auslösen (docs/ART_DIRECTION.md §5). Reine Zuordnung, damit sie
 * testbar ist; abgespielt wird in `useMatchSounds`. Nichts beim ersten Aufbau der Seite und nichts
 * während einer laufenden Frage außer der eigenen Antwort (ARCHITECTURE §15).
 *
 * Sieg oder Niederlage klingen erst, wenn die Abrechnung erscheint (ADR-055): `MATCH_FINISHED`
 * steht schon im Verlauf, während die letzte Auflösung noch gezeigt wird.
 */

export interface TimedCue {
  readonly cue: SoundCue;
  readonly delayMs: number;
}

const EFFECT_DELAY_MS = 550;

export function cuesFor(
  before: { readonly state: MatchScreenState; readonly lastSeq: number } | null,
  next: { readonly state: MatchScreenState; readonly lastSeq: number },
  fresh: readonly ParsedMatchEvent[],
  mySeat: number | null,
  /** Endstand aus `MATCH_FINISHED`, sobald es ihn gibt. */
  standings: MatchEventOf<'MATCH_FINISHED'>['payload']['standings'] | null = null,
): TimedCue[] {
  if (!before || next.state === 'question') return [];
  const cues: TimedCue[] = [];
  let delay = 0;
  for (const event of fresh) {
    switch (event.type) {
      case 'CAPITAL_CHOSEN':
      case 'REGION_CLAIMED':
      case 'AUTO_PICKED':
        cues.push({ cue: 'pick', delayMs: 0 });
        break;
      case 'QUESTION_RESOLVED': {
        const mine = event.payload.answers.find((a) => a.seat === mySeat);
        if (mine) {
          cues.push({ cue: mine.correct ? 'correct' : 'wrong', delayMs: 0 });
          delay = EFFECT_DELAY_MS;
        }
        break;
      }
      case 'DUEL_RESOLVED': {
        const cue: SoundCue =
          event.payload.effect === 'FORTIFIED'
            ? 'defend'
            : event.payload.effect === 'CONQUERED'
              ? 'conquer'
              : 'capitalHit';
        cues.push({ cue, delayMs: delay });
        delay += EFFECT_DELAY_MS;
        break;
      }
      case 'KINGDOM_ELIMINATED':
        cues.push({ cue: 'fall', delayMs: delay + 300 });
        delay += EFFECT_DELAY_MS;
        break;
      case 'MATCH_FINISHED':
      case 'MATCH_CREATED':
      case 'PLAYER_JOINED':
      case 'PLAYER_LEFT':
      case 'MATCH_STARTED':
      case 'MATCH_ABANDONED':
      case 'QUESTION_OPENED':
      case 'LAND_RANKED':
      case 'TARGET_CHOSEN':
        break;
      // Partie mit Ausbau (MATCH_RULES §11): Töne kommen mit ihrer Ansicht im nächsten Schritt
      case 'START_RANKED':
      case 'CASTLE_CHOSEN':
      case 'VILLAGE_CHOSEN':
      case 'INCOME':
      case 'ORDERS_SUBMITTED':
      case 'PREPARE_CLOSED':
      case 'ORDERS_REVEALED':
      case 'WHEEL_SPUN':
      case 'REALM_DUEL_RESOLVED':
      case 'REALM_MATCH_FINISHED':
        break;
    }
  }
  if (next.state === 'finished' && before.state !== 'finished') {
    const mine = standings?.find((s) => s.seat === mySeat);
    if (mine) cues.push({ cue: mine.place === 1 ? 'victory' : 'defeat', delayMs: delay + 400 });
  }
  if (next.state === 'pick' && (before.state !== 'pick' || before.lastSeq !== next.lastSeq)) {
    cues.push({ cue: 'turn', delayMs: delay });
  }
  // Mehrere Wahlen in einem Abruf klingen nur einmal
  return cues.filter((c, i) => c.cue !== 'pick' || cues.findIndex((d) => d.cue === 'pick') === i);
}
