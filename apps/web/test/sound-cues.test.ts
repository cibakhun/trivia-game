import { parseMatchEvent, type ParsedMatchEvent } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { setSoundEnabled, soundEnabled } from '../src/audio/sound.ts';
import type { MatchScreenState } from '../src/match/match-model.ts';
import { cuesFor } from '../src/match/sound-cues.ts';

/** Klänge der Partie: welche Ereignisse welchen Klang auslösen (Gestaltung, ADR-051). */

function event(seq: number, type: string, payload: Record<string, unknown>): ParsedMatchEvent {
  const parsed = parseMatchEvent({ seq, at: '2026-11-10T20:00:00.000Z', type, payload });
  if (!parsed) throw new Error(`Ereignis ${type} ungültig`);
  return parsed;
}

const answer = (seat: number, correct: boolean) => ({
  seat,
  answered: true,
  correct,
  optionText: 'x',
  value: null,
  distance: null,
  effectiveMs: 1000,
});

const resolved = (seq: number, mine: boolean) =>
  event(seq, 'QUESTION_RESOLVED', {
    seq: 3,
    kind: 'TRIVIA',
    purpose: 'DUEL',
    prompt: 'Frage',
    options: [],
    solution: { optionToken: null, text: 'x' },
    explanation: null,
    answers: [answer(0, mine), answer(1, !mine)],
  });

const duel = (seq: number, effect: string) =>
  event(seq, 'DUEL_RESOLVED', {
    round: 1,
    duel: 1,
    attacker: 0,
    defender: 1,
    region: 4,
    winner: effect === 'FORTIFIED' ? 'DEFENDER' : 'ATTACKER',
    reason: 'TRIVIA',
    effect,
    capitalLivesLeft: effect === 'CAPITAL_HIT' ? 2 : null,
    regionValue: 100,
  });

const at = (state: MatchScreenState, lastSeq: number) => ({ state, lastSeq });

describe('Klänge der Partie', () => {
  it('nichts beim ersten Aufbau und nichts während einer Frage', () => {
    expect(cuesFor(null, at('pick', 5), [], 0)).toEqual([]);
    expect(cuesFor(at('reveal', 4), at('question', 6), [duel(5, 'CONQUERED')], 0)).toEqual([]);
  });

  it('erst die eigene Antwort, dann die Folge des Duells', () => {
    const cues = cuesFor(
      at('question', 4),
      at('reveal', 6),
      [resolved(5, true), duel(6, 'CONQUERED')],
      0,
    );
    expect(cues.map((c) => c.cue)).toEqual(['correct', 'conquer']);
    expect(cues[1]!.delayMs).toBeGreaterThan(cues[0]!.delayMs);
    expect(
      cuesFor(
        at('question', 4),
        at('reveal', 6),
        [resolved(5, false), duel(6, 'FORTIFIED')],
        0,
      ).map((c) => c.cue),
    ).toEqual(['wrong', 'defend']);
    // Zuschauer hören nur die Folge
    expect(
      cuesFor(
        at('question', 4),
        at('reveal', 6),
        [resolved(5, true), duel(6, 'CAPITAL_HIT')],
        2,
      ).map((c) => c.cue),
    ).toEqual(['capitalHit']);
  });

  it('Horn, wenn du dran bist; eine Wahl klingt nur einmal je Abruf', () => {
    const picks = [
      event(5, 'REGION_CLAIMED', { round: 1, seat: 1, region: 3 }),
      event(6, 'REGION_CLAIMED', { round: 1, seat: 2, region: 7 }),
    ];
    expect(cuesFor(at('waiting-pick', 4), at('pick', 6), picks, 0).map((c) => c.cue)).toEqual([
      'pick',
      'turn',
    ]);
  });

  it('Sieg oder Niederlage erst mit der Abrechnung, nicht schon in der letzten Auflösung', () => {
    const standings = [
      { seat: 0, place: 1, points: 900, regions: 9, capitalLives: 3, eliminated: false },
      { seat: 1, place: 2, points: 400, regions: 4, capitalLives: 1, eliminated: false },
    ];
    const finished = event(9, 'MATCH_FINISHED', { reason: 'ROUNDS_COMPLETE', standings });
    const last = [resolved(7, true), duel(8, 'CONQUERED'), finished];
    // Letzte Auflösung (ADR-055): Die Partie läuft noch, `MATCH_FINISHED` steht schon im Verlauf
    expect(
      cuesFor(at('answered', 6), at('reveal', 9), last, 0, standings).map((c) => c.cue),
    ).toEqual(['correct', 'conquer']);
    // Die Abrechnung erscheint: jetzt klingt das Ende, je nach Platz
    expect(cuesFor(at('reveal', 9), at('finished', 9), [], 0, standings)).toEqual([
      { cue: 'victory', delayMs: 400 },
    ]);
    expect(cuesFor(at('reveal', 9), at('finished', 9), [], 1, standings)[0]?.cue).toBe('defeat');
    // Wer zuschaut, hört nichts; wer die fertige Partie nur ansieht, auch nicht
    expect(cuesFor(at('reveal', 9), at('finished', 9), [], null, standings)).toEqual([]);
    expect(cuesFor(at('finished', 9), at('finished', 9), [], 0, standings)).toEqual([]);
    expect(cuesFor(null, at('finished', 9), [], 0, standings)).toEqual([]);
  });

  it('kommt die Abrechnung in einem Abruf mit dem letzten Duell, klingt das Ende zuletzt', () => {
    const standings = [
      { seat: 0, place: 1, points: 900, regions: 9, capitalLives: 3, eliminated: false },
      { seat: 1, place: 2, points: 400, regions: 4, capitalLives: 1, eliminated: false },
    ];
    const finished = event(9, 'MATCH_FINISHED', { reason: 'ROUNDS_COMPLETE', standings });
    const last = [resolved(7, true), duel(8, 'CONQUERED'), finished];
    expect(cuesFor(at('answered', 6), at('finished', 9), last, 1, standings)).toEqual([
      { cue: 'wrong', delayMs: 0 },
      { cue: 'conquer', delayMs: 550 },
      { cue: 'defeat', delayMs: 1500 },
    ]);
  });

  it('der Schalter bleibt gespeichert', () => {
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
  });
});
