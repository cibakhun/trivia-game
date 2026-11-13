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

/** Was die Klänge vom Endstand brauchen; beide Spielarten liefern es. */
export interface Placed {
  readonly seat: number;
  readonly place: number;
}

type RealmEffect = MatchEventOf<'REALM_DUEL_RESOLVED'>['payload']['effect'];

/**
 * Mit Ausbau klingt ein Duell wie ohne: gehalten, erobert oder ein Treffer auf ein Gebäude. Ein
 * freies Feld klingt genommen wie erobert; bleibt es frei, klingt nichts (niemand hat gehalten).
 */
function realmDuelCue(effect: RealmEffect): SoundCue | null {
  switch (effect) {
    case 'FORTIFIED':
      return 'defend';
    case 'UNCLAIMED':
      return null;
    case 'CONQUERED':
    case 'CASTLE_DESTROYED':
    case 'CLAIMED':
      return 'conquer';
    case 'BUILDING_DAMAGED':
    case 'CASTLE_HIT':
    case 'TAKEOVER':
      return 'capitalHit';
  }
}

export function cuesFor(
  before: { readonly state: MatchScreenState; readonly lastSeq: number } | null,
  next: { readonly state: MatchScreenState; readonly lastSeq: number },
  fresh: readonly ParsedMatchEvent[],
  mySeat: number | null,
  /** Endstand aus `MATCH_FINISHED` oder `REALM_MATCH_FINISHED`, sobald es ihn gibt. */
  standings: readonly Placed[] | null = null,
): TimedCue[] {
  if (!before || next.state === 'question') return [];
  const cues: TimedCue[] = [];
  let delay = 0;
  for (const event of fresh) {
    switch (event.type) {
      // Auch das Aufdecken: ein Klang für alle Reiche zusammen (siehe Filter unten)
      case 'CAPITAL_CHOSEN':
      case 'REGION_CLAIMED':
      case 'AUTO_PICKED':
      case 'CASTLE_CHOSEN':
      case 'VILLAGE_CHOSEN':
      case 'ORDERS_REVEALED':
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
      case 'REALM_DUEL_RESOLVED': {
        const cue = realmDuelCue(event.payload.effect);
        if (cue) {
          cues.push({ cue, delayMs: delay });
          delay += EFFECT_DELAY_MS;
        }
        break;
      }
      // Partie mit Ausbau (MATCH_RULES §11): ohne eigenen Klang
      case 'START_RANKED':
      case 'INCOME':
      case 'ORDERS_SUBMITTED':
      case 'PREPARE_CLOSED':
      case 'ATTACK_SKIPPED':
      case 'WHEEL_SPUN':
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
