import type { MatchEventOf } from '@rdw/protocol';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scheduleCue, type SoundCue } from '../src/audio/sound.ts';
import { seatNames } from '../src/match/match-text.ts';
import {
  RESULT_CUE_MS,
  resultTiming,
  SEAL_GLINTS,
  SEAL_SETTLE_MS,
  sealSparks,
  tallyAt,
} from '../src/match/result-motion.ts';
import { ResultPanel } from '../src/match/ResultPanel.tsx';
import { cuesFor } from '../src/match/sound-cues.ts';
import { event, viewOf } from './match-fixtures.ts';

/**
 * Abrechnung in Bewegung (docs/ART_DIRECTION.md §5): Der Zeitplan folgt dem Klang des Endes, und
 * ohne miterlebtes Ende steht sofort das Endbild.
 */

/** Einsätze der Töne eines Klangs in ms: ein Audiokontext, der nur mitschreibt. */
function onsets(cue: SoundCue): number[] {
  const starts: number[] = [];
  const param = {
    value: 0,
    setValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  };
  const node = () => ({ connect: () => undefined, type: '', frequency: param, gain: param });
  const ctx = {
    sampleRate: 8,
    createOscillator: () => ({
      ...node(),
      start: (at: number) => void starts.push(Math.round(at * 1000)),
      stop: () => undefined,
    }),
    createGain: node,
    createBiquadFilter: node,
    createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      start: () => undefined,
      stop: () => undefined,
    }),
  };
  scheduleCue(ctx as unknown as BaseAudioContext, {} as AudioNode, cue, 0);
  return [...new Set(starts)].sort((a, b) => a - b);
}

describe('resultTiming', () => {
  it('beginnt mit dem Klang des Endes', () => {
    const [cue] = cuesFor(
      { state: 'reveal', lastSeq: 9 },
      { state: 'finished', lastSeq: 9 },
      [],
      0,
      [{ seat: 0, place: 1 }],
    );
    // 10 ms Vorlauf beim Abspielen (`playSound`)
    expect(cue).toEqual({ cue: 'victory', delayMs: RESULT_CUE_MS - 10 });
  });

  it('Sieg: die Tabelle steigt mit der Fanfare vom letzten Platz zum ersten, das Siegel sitzt auf dem Akkord', () => {
    const fanfare = onsets('victory').map((at) => RESULT_CUE_MS + at);
    expect(fanfare).toHaveLength(4);
    const timing = resultTiming([1, 2, 3], 'victory');
    // Zeilen von oben nach unten: Der erste Platz steht zuletzt
    expect(timing.rows).toEqual([fanfare[2], fanfare[1], fanfare[0]]);
    expect(timing.seal).toBe(fanfare[3]);
    expect(timing.rest).toBe(fanfare[3]! + SEAL_SETTLE_MS);
    // Ein starker Moment, kein Feuerwerk: Nach rund 2,5 s steht alles
    expect(timing.rest).toBeLessThanOrEqual(2500);
    // Die Punkte des Siegers zählen am längsten und sind vor der Ruhe fertig
    expect(timing.counts[0]).toBeGreaterThan(timing.counts[1]!);
    for (const [row, at] of timing.rows.entries()) {
      expect(at + timing.counts[row]!).toBeLessThan(timing.rest);
    }
  });

  it('Sieg zu zweit: Der erste Platz steht auf dem letzten Ton vor dem Akkord', () => {
    const fanfare = onsets('victory').map((at) => RESULT_CUE_MS + at);
    expect(resultTiming([1, 2], 'victory').rows).toEqual([fanfare[2], fanfare[1]]);
  });

  it('gleiche Plätze erscheinen zusammen', () => {
    const shared = resultTiming([1, 1, 3], 'victory');
    expect(shared.rows[0]).toBe(shared.rows[1]);
    expect(shared.rows[2]).toBeLessThan(shared.rows[0]!);
    expect(shared.counts[0]).toBe(shared.counts[1]);
    const behind = resultTiming([1, 2, 2], 'placed');
    expect(behind.rows[1]).toBe(behind.rows[2]);
    expect(behind.rows[0]).toBeLessThan(behind.rows[1]!);
  });

  it('sonst: ruhig von oben nach unten im Schritt der fallenden Töne, ohne Siegel', () => {
    const lament = onsets('defeat').map((at) => RESULT_CUE_MS + at);
    const timing = resultTiming([1, 2, 3], 'placed');
    expect(timing.rows).toEqual(lament.slice(0, 3));
    expect(timing.seal).toBeNull();
    expect(timing.rest).toBeLessThan(resultTiming([1, 2, 3], 'victory').rest);
    // Wer zuschaut, sieht dieselbe ruhige Fassung
    expect(resultTiming([1, 2, 3], 'neutral')).toEqual(timing);
  });

  it('ohne Plätze steht nichts aus', () => {
    expect(resultTiming([], 'neutral')).toEqual({ rows: [], counts: [], seal: null, rest: 860 });
  });
});

describe('tallyAt', () => {
  it('zählt von 0 zum Wert, zum Ende hin langsamer, nie darüber', () => {
    expect(tallyAt(0, 450, 1200)).toBe(0);
    const half = tallyAt(225, 450, 1200)!;
    expect(half).toBeGreaterThan(600);
    expect(half).toBeLessThan(1200);
    let last = 0;
    for (let at = 0; at < 450; at += 15) {
      const now = tallyAt(at, 450, 1200)!;
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now).toBeLessThanOrEqual(1200);
      last = now;
    }
  });

  it('ist fertig, sobald die Zeit um ist oder es nichts zu zählen gibt', () => {
    expect(tallyAt(450, 450, 1200)).toBeNull();
    expect(tallyAt(9999, 450, 1200)).toBeNull();
    expect(tallyAt(10, 450, 0)).toBeNull();
    expect(tallyAt(10, 0, 1200)).toBeNull();
    // Vor dem Beginn steht die Null
    expect(tallyAt(-50, 450, 1200)).toBe(0);
  });
});

describe('Siegel', () => {
  it('Funken sind fest gewürfelt, beginnen mit dem Aufsetzen und sind verflogen, bevor alles steht', () => {
    const seal = resultTiming([1, 2, 3], 'victory').seal!;
    const sparks = sealSparks(seal);
    expect(sparks).toEqual(sealSparks(seal));
    expect(sparks.length).toBeGreaterThan(8);
    for (const p of sparks) {
      expect(p.delayMs).toBeGreaterThanOrEqual(seal);
      expect(p.delayMs + p.durationMs).toBeLessThan(seal + 700);
    }
  });

  it('Glanzpunkte liegen im Bild des Siegels und sind verglommen, bevor die Strahlen stehen', () => {
    for (const g of SEAL_GLINTS) {
      expect(Math.abs(g.x)).toBeLessThanOrEqual(60);
      expect(g.y).toBeGreaterThanOrEqual(-52);
      expect(g.y).toBeLessThanOrEqual(44);
      expect(g.afterMs + g.durationMs).toBeLessThan(SEAL_SETTLE_MS);
    }
  });
});

describe('ResultPanel', () => {
  const standings = [
    { seat: 2, place: 1, points: 1250, regions: 9, capitalLives: 3, eliminated: false },
    { seat: 0, place: 2, points: 1000, regions: 8, capitalLives: 2, eliminated: false },
    { seat: 1, place: 3, points: 0, regions: 0, capitalLives: 0, eliminated: true },
  ];
  const finished = event(40, 'MATCH_FINISHED', {
    reason: 'ROUNDS_COMPLETE',
    standings,
  }) as MatchEventOf<'MATCH_FINISHED'>;
  const panel = (mySeat: number | null, live: boolean) => {
    const base = viewOf({}, { kind: 'FINISHED', round: null, finishReason: 'ROUNDS_COMPLETE' });
    const view = { ...base, mySeat, match: { ...base.match, status: 'FINISHED' as const } };
    return renderToStaticMarkup(
      createElement(ResultPanel, { view, finished, name: seatNames(view), live }),
    );
  };

  it('ohne miterlebtes Ende steht das Endbild: keine Bewegung, alle Zahlen da', () => {
    const html = panel(2, false);
    expect(html).toContain('class="sheet resolution result victory"');
    expect(html).not.toContain('entrance');
    expect(html).not.toContain('tally-run');
    expect(html).not.toContain('seal-fx');
    expect(html).toContain('1.250');
    expect(html).toContain('result-seal');
  });

  it('ohne Fenster (und mit „Bewegung reduzieren“) baut sich nichts auf, auch wenn das Ende miterlebt ist', () => {
    const html = panel(2, true);
    expect(html).not.toContain('entrance');
    expect(html).not.toContain('tally-run');
  });

  it('zeigt dem Sieger das Siegel, den anderen ihr Wappen mit dem Platz, Zuschauern keins von beiden', () => {
    expect(panel(2, false)).toContain('result-seal');
    expect(panel(2, false)).not.toContain('result-crest');
    const second = panel(0, false);
    expect(second).toContain('class="sheet resolution result placed"');
    expect(second).toContain('class="result-crest place-2"');
    expect(second).not.toContain('result-seal');
    const watching = panel(null, false);
    expect(watching).toContain('class="sheet resolution result neutral"');
    expect(watching).not.toContain('result-crest');
    expect(watching).not.toContain('result-seal');
  });
});
