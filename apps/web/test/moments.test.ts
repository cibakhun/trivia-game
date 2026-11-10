import { WENDELMARK } from '@rdw/game-core';
import { parseMatchEvent, type ParsedMatchEvent } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { arrowScale, attackArrow, attackSource, regionMarks } from '../src/art/attack.ts';
import { mapArt } from '../src/art/map-art.ts';
import { momentsBetween, type MomentSnapshot } from '../src/match/moments.ts';

/** Große Momente als Band und Angriffspfeil im Duell (Gestaltung, ADR-051). */

const name = (seat: number) => ['Anna (du)', 'Bot (schwer)', 'Bot (leicht)'][seat] ?? '?';

function snap(partial: Partial<MomentSnapshot>): MomentSnapshot {
  return { state: 'waiting-pick', kind: 'CAMPAIGN_TARGET', round: 1, lastSeq: 10, ...partial };
}

function eliminated(seq: number, seat: number, by: number): ParsedMatchEvent {
  const event = parseMatchEvent({
    seq,
    at: '2026-11-10T20:00:00.000Z',
    type: 'KINGDOM_ELIMINATED',
    payload: { round: 2, seat, by, regions: 4 },
  });
  if (!event) throw new Error('Ereignis ungültig');
  return event;
}

describe('Große Momente', () => {
  it('beim ersten Aufbau nur „Du bist dran“, nichts Vergangenes', () => {
    expect(momentsBetween(null, snap({ state: 'pick' }), [], name, 4).map((m) => m.title)).toEqual([
      'Du bist dran!',
    ]);
    expect(momentsBetween(null, snap({}), [eliminated(9, 1, 0)], name, 4)).toEqual([]);
  });

  it('ein fallendes Reich zeigt das Wappen des Siegers', () => {
    const [moment] = momentsBetween(
      snap({ lastSeq: 8 }),
      snap({ lastSeq: 10 }),
      [eliminated(9, 1, 0)],
      name,
      4,
    );
    expect(moment).toMatchObject({ title: 'Ein Reich fällt!', tone: 'seat', seat: 0 });
    expect(moment?.detail).toBe('Bot (schwer) scheidet aus, das Reich geht an Anna (du).');
  });

  it('Landnahme, Feldzug und neue Runden werden angekündigt', () => {
    const titles = (before: Partial<MomentSnapshot>, next: Partial<MomentSnapshot>) =>
      momentsBetween(snap(before), snap(next), [], name, 4).map((m) => m.title);
    expect(titles({ kind: 'CAPITAL_PICK' }, { kind: 'LAND_ESTIMATE' })).toEqual([
      'Die Landnahme beginnt',
    ]);
    expect(titles({ kind: 'LAND_PICK', round: 7 }, { kind: 'CAMPAIGN_TARGET', round: 1 })).toEqual([
      'Der Feldzug beginnt',
    ]);
    expect(
      titles({ kind: 'DUEL_TRIVIA', round: 1 }, { kind: 'CAMPAIGN_TARGET', round: 2 }),
    ).toEqual(['Runde 2 von 4']);
    // Innerhalb einer Runde und zwischen Landnahmerunden kein Band
    expect(
      titles({ kind: 'CAMPAIGN_TARGET', round: 2 }, { kind: 'DUEL_TRIVIA', round: 2 }),
    ).toEqual([]);
    expect(titles({ kind: 'LAND_PICK', round: 2 }, { kind: 'LAND_ESTIMATE', round: 3 })).toEqual(
      [],
    );
    expect(titles({ kind: 'DUEL_TRIVIA', round: 4 }, { kind: 'FINISHED', round: 4 })).toEqual([]);
  });

  it('Ankündigungen warten, bis gewählt wird', () => {
    expect(
      momentsBetween(
        snap({ state: 'question', kind: 'DUEL_TRIVIA', round: 1 }),
        snap({ state: 'reveal', kind: 'CAMPAIGN_TARGET', round: 2 }),
        [],
        name,
        4,
      ),
    ).toEqual([]);
  });

  it('„Du bist dran“ nach der Ankündigung, bei jeder neuen eigenen Wahl', () => {
    const moments = momentsBetween(
      snap({ kind: 'DUEL_TRIVIA', round: 1, lastSeq: 20 }),
      snap({ state: 'pick', kind: 'CAMPAIGN_TARGET', round: 2, lastSeq: 22 }),
      [],
      name,
      4,
    );
    expect(moments.map((m) => m.title)).toEqual(['Runde 2 von 4', 'Du bist dran!']);
    expect(
      momentsBetween(
        snap({ state: 'pick', kind: 'LAND_PICK', lastSeq: 30 }),
        snap({ state: 'pick', kind: 'LAND_PICK', lastSeq: 31 }),
        [],
        name,
        4,
      ).map((m) => m.title),
    ).toEqual(['Du bist dran!']);
  });
});

describe('Angriffspfeil', () => {
  const owner = WENDELMARK.regions.map(() => null as number | null);
  const at = (n: string) => WENDELMARK.regions.findIndex((r) => r.name === n);

  it('kommt aus einer angrenzenden Region des Angreifers, nah an seiner Hauptstadt', () => {
    const target = at('Hagelstein');
    const own = [...owner];
    own[at('Ackerbrunn')] = 0;
    own[at('Birkental')] = 0;
    own[at('Otterbruch')] = 0;
    own[at('Eschenhain')] = 0;
    const from = attackSource(WENDELMARK, { owner: own, capital: at('Eschenhain') }, 0, target);
    expect(from).toBe(at('Ackerbrunn'));
    expect(WENDELMARK.adjacency[target]).toContain(from);
    // Ohne angrenzende Region kein Pfeil
    expect(attackSource(WENDELMARK, { owner, capital: null }, 0, target)).toBeNull();
  });

  it('läuft von der Quelle zum Ziel, das Siegel liegt dazwischen', () => {
    const art = mapArt(WENDELMARK);
    const from = at('Birkental');
    const to = at('Hagelstein');
    const arrow = attackArrow(art, from, to);
    expect(arrow).not.toBeNull();
    const a = art.regions[from]!;
    const b = art.regions[to]!;
    const near = (p: { x: number; y: number }, q: { cx: number; cy: number }) =>
      Math.hypot(p.x - q.cx, p.y - q.cy);
    // Schaft beginnt beim Angreifer, Spitze im Ziel, Siegel ungefähr auf der Grenze
    expect(near(arrow!.tail, a)).toBeLessThan(near(arrow!.tail, b));
    expect(near(arrow!.tip, b)).toBeLessThan(near(arrow!.tip, a));
    const gap = Math.hypot(a.cx - b.cx, a.cy - b.cy);
    expect(near(arrow!.mid, a)).toBeLessThan(gap);
    expect(near(arrow!.mid, b)).toBeLessThan(gap);
    expect(arrow!.d).toMatch(/^M[\d.-]+ [\d.-]+Q/);
  });

  it('das Siegel weicht Namen, Münzen und Burgen aus', () => {
    const art = mapArt(WENDELMARK);
    const s = art.size;
    for (const narrow of [false, true]) {
      // Jede Nachbarschaft der Karte, alle Regionen besetzt, Hauptstadt im Angreiferfeld
      const covered: string[] = [];
      let pairs = 0;
      for (const [from, list] of WENDELMARK.adjacency.entries()) {
        for (const to of list) {
          const marks = art.regions.flatMap((region) =>
            regionMarks(region, s, { owned: true, capital: region.id === from, narrow }),
          );
          const arrow = attackArrow(art, from, to, marks, arrowScale(narrow));
          expect(arrow).not.toBeNull();
          pairs++;
          const r = 0.18 * s * arrowScale(narrow);
          const hit = marks.some((m) => {
            const dx = Math.max(m.x0 - arrow!.mid.x, 0, arrow!.mid.x - m.x1);
            const dy = Math.max(m.y0 - arrow!.mid.y, 0, arrow!.mid.y - m.y1);
            return dx * dx + dy * dy < r * r;
          });
          if (hit) covered.push(`${from}→${to}`);
        }
      }
      expect(pairs).toBeGreaterThan(100);
      // Breit passt es überall; schmal sind die Namen größer, dort darf es in seltenen Fällen eng
      // werden (die Namen liegen ohnehin über Pfeil und Siegel)
      expect(covered.length, covered.join(' ')).toBeLessThanOrEqual(narrow ? 2 : 0);
    }
  });
});
