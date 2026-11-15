import { describe, expect, it } from 'vitest';
import type { MatchScreenState } from '../src/match/match-model.ts';
import {
  FALLEN_LEAD_MS,
  GRAND_MOMENT_MS,
  MOMENT_MS,
  momentTiming,
  momentWeight,
  type Moment,
} from '../src/match/moments.ts';
import {
  blattScene,
  IMPACT_MS,
  impactHoldMs,
  type BlattSceneStep,
} from '../src/match/stage-live.ts';

/** Takt der Bühne am Rand (docs/ART_DIRECTION.md §5): Seiten des Blatts, Schlag eines Duells, Bänder. */

function step(partial: Partial<BlattSceneStep>): BlattSceneStep {
  return { kind: 'CAMPAIGN_TARGET', round: 2, chooser: 0, attacker: 0, region: null, ...partial };
}

function moment(partial: Partial<Moment>): Moment {
  return {
    key: 'round-2',
    title: 'Runde 2 von 4',
    detail: null,
    tone: 'ink',
    seat: null,
    ...partial,
  };
}

describe('Seite des Blatts rechts', () => {
  it('schlägt um, wenn der Zustand wechselt', () => {
    const states: MatchScreenState[] = ['pick', 'waiting-pick', 'announce', 'question', 'reveal'];
    const scenes = states.map((state) => blattScene(state, step({}), 12));
    expect(new Set(scenes).size).toBe(states.length);
  });

  it('bleibt während einer Frage dieselbe Seite, was auch immer ich tue', () => {
    const open = blattScene('question', step({ kind: 'DUEL_TRIVIA' }), 12);
    for (const state of ['presenting', 'answered', 'missed', 'spectating'] as const) {
      expect(blattScene(state, step({ kind: 'DUEL_TRIVIA' }), 12)).toBe(open);
    }
    expect(blattScene('question', step({ kind: 'DUEL_TRIVIA' }), 13)).not.toBe(open);
  });

  it('schlägt in der Auflösung um, sobald das Blatt den Ausgang eines Duells nennt', () => {
    const answers = blattScene('reveal', step({}), 12, false);
    const outcome = blattScene('reveal', step({}), 12, true);
    expect(answers).not.toBe(outcome);
    // Rest der Auflösung: dieselbe Seite wie der Ausgang
    expect(blattScene('reveal', step({}), 12, true)).toBe(outcome);
  });

  it('bleibt in der Rüstzeit ruhig, wenn ich fertig bin oder die Befehle wieder ändere', () => {
    const prepare = blattScene('prepare', step({ kind: 'PREPARE', round: 2 }), null);
    expect(blattScene('prepared', step({ kind: 'PREPARE', round: 2 }), null)).toBe(prepare);
    expect(blattScene('prepare', step({ kind: 'PREPARE', round: 3 }), null)).not.toBe(prepare);
    expect(blattScene('watching-prepare', step({ kind: 'PREPARE', round: 2 }), null)).not.toBe(
      prepare,
    );
  });

  it('bleibt in der Ansage auf der Seite, solange Wahlen derselben Art folgen', () => {
    // Bots setzen nacheinander ihre Burg: Der Schritt wechselt, die gezeigte Art der Wahl nicht
    const first = blattScene(
      'announce',
      step({ kind: 'CASTLE_PICK', chooser: 0 }),
      null,
      false,
      'x',
    );
    const second = blattScene(
      'announce',
      step({ kind: 'CASTLE_PICK', chooser: 1 }),
      null,
      false,
      'x',
    );
    expect(second).toBe(first);
    expect(
      blattScene('announce', step({ kind: 'VILLAGE_PICK', chooser: 0 }), null, false, 'y'),
    ).not.toBe(first);
  });

  it('unterscheidet in der Ansage ohne gezeigte Wahl nach Angreifer und Ziel', () => {
    const mine = blattScene(
      'announce',
      step({ kind: 'DUEL_TRIVIA', attacker: 2, region: 7 }),
      null,
    );
    expect(
      blattScene('announce', step({ kind: 'DUEL_TRIVIA', attacker: 2, region: 7 }), null),
    ).toBe(mine);
    expect(
      blattScene('announce', step({ kind: 'DUEL_TRIVIA', attacker: 0, region: 9 }), null),
    ).not.toBe(mine);
  });

  it('schlägt für den nächsten Angreifer um, auch wenn der Zustand derselbe bleibt', () => {
    const first = blattScene('waiting-pick', step({ chooser: 0 }), null);
    expect(blattScene('waiting-pick', step({ chooser: 1 }), null)).not.toBe(first);
    const wheel = blattScene('wheel', step({ attacker: 0, region: 7 }), null);
    expect(blattScene('wheel', step({ attacker: 1, region: 4 }), null)).not.toBe(wheel);
  });

  it('kommt ohne Schritt aus (Laden, Lobby, Ende)', () => {
    expect(blattScene('loading', null, null)).toBe('loading');
    expect(blattScene('lobby', null, null)).toBe('lobby');
    expect(blattScene('finished', null, null)).toBe('finished');
  });
});

describe('Schlag eines Duells am Spielstand', () => {
  it('hält den Stand, bis der Schlag sitzt', () => {
    // 6 s Auflösung: Takt des Ausgangs 1,5 s, der Schlag sitzt nach 0,41 s
    expect(impactHoldMs(6000)).toBe(IMPACT_MS);
    expect(IMPACT_MS).toBe(410);
  });

  it('hält mit Spieltestzeiten höchstens den halben Takt', () => {
    // 2 s Auflösung: Takt 0,5 s
    expect(impactHoldMs(2000)).toBe(250);
    expect(impactHoldMs(0)).toBe(0);
  });
});

describe('Gewicht und Zeiten der Bänder', () => {
  const fallen = moment({ key: 'fallen-33', title: 'Ein Reich fällt!', tone: 'seat', seat: 2 });

  it('gibt nur dem gefallenen Reich das große Band', () => {
    expect(momentWeight(fallen)).toBe('grand');
    expect(momentWeight(moment({}))).toBe('plain');
    expect(momentWeight(moment({ key: 'turn-2-0', tone: 'gold' }))).toBe('plain');
  });

  it('lässt das große Band länger stehen', () => {
    expect(momentTiming(moment({}), 'prepare')).toEqual({ leadMs: 0, showMs: MOMENT_MS });
    expect(momentTiming(fallen, 'waiting-pick')).toEqual({ leadMs: 0, showMs: GRAND_MOMENT_MS });
    expect(GRAND_MOMENT_MS).toBeGreaterThan(MOMENT_MS);
  });

  it('wartet mit dem gefallenen Reich auf den Einsturz, wenn es eben in der Auflösung fällt', () => {
    expect(momentTiming(fallen, 'reveal')).toEqual({
      leadMs: FALLEN_LEAD_MS,
      showMs: GRAND_MOMENT_MS,
    });
    // Eine Ankündigung in der Auflösung wartet nicht
    expect(momentTiming(moment({}), 'reveal').leadMs).toBe(0);
  });
});
