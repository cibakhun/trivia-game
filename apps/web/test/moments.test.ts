import { WENDELMARK } from '@rdw/game-core';
import { parseMatchEvent, type ParsedMatchEvent } from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { attackSource, duelLayout, duelScale, inUpperHalf } from '../src/art/attack.ts';
import { mapArt } from '../src/art/map-art.ts';
import {
  enqueueMoments,
  momentsBetween,
  pruneMoments,
  type MomentSnapshot,
} from '../src/match/moments.ts';

/** Große Momente als Band und Aufstellung eines Duells auf der Karte (Gestaltung, ADR-051/054). */

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

describe('Große Momente der Partie mit Ausbau', () => {
  const between = (before: Partial<MomentSnapshot>, next: Partial<MomentSnapshot>) =>
    momentsBetween(snap(before), snap(next), [], name, 5, true);
  const titles = (before: Partial<MomentSnapshot>, next: Partial<MomentSnapshot>) =>
    between(before, next).map((m) => m.title);

  it('sagt zur Landnahme, wie viele Runden sie hat und was mit dem Rest geschieht (ADR-062)', () => {
    const land = (rounds: number | null) =>
      momentsBetween(
        snap({ kind: 'VILLAGE_PICK', round: null }),
        snap({ kind: 'LAND_ESTIMATE', round: 1 }),
        [],
        name,
        5,
        true,
        rounds,
      ).map((m) => [m.title, m.detail]);
    expect(land(2)).toEqual([
      ['Die Landnahme beginnt', '2 Runden. Was frei bleibt, holst du dir im Feldzug.'],
    ]);
    expect(land(1)).toEqual([
      ['Die Landnahme beginnt', 'Eine Runde. Was frei bleibt, holst du dir im Feldzug.'],
    ]);
    // Partien von vor ADR-062: Die Landnahme läuft, bis alles vergeben ist
    expect(land(null)).toEqual([
      ['Die Landnahme beginnt', 'Wer am genauesten schätzt, wählt zuerst.'],
    ]);
  });

  it('kündigt Burgen und Startdörfer an, je einmal', () => {
    expect(
      titles(
        { state: 'reveal', kind: 'START_ESTIMATE', round: null },
        { kind: 'CASTLE_PICK', round: null },
      ),
    ).toEqual(['Die Burgen werden gesetzt']);
    expect(
      titles({ kind: 'CASTLE_PICK', round: null }, { kind: 'VILLAGE_PICK', round: null }),
    ).toEqual(['Jetzt die Dörfer']);
    // Der nächste Sitz setzt: dieselbe Phase, kein neues Band
    expect(
      titles(
        { kind: 'CASTLE_PICK', round: null, lastSeq: 10 },
        { kind: 'CASTLE_PICK', round: null, lastSeq: 11 },
      ),
    ).toEqual([]);
  });

  it('kündigt jede Runde mit ihrer Rüstzeit an, die letzte als letzte', () => {
    const first = between(
      { kind: 'VILLAGE_PICK', round: null },
      { state: 'prepare', kind: 'PREPARE', round: 1 },
    );
    expect(first).toMatchObject([
      { key: 'prepare-1', title: 'Rüstzeit', detail: 'Runde 1 von 5', tone: 'ink' },
    ]);
    const last = between(
      { kind: 'CAMPAIGN_TARGET', round: 4 },
      { state: 'prepare', kind: 'PREPARE', round: 5 },
    );
    expect(last[0]?.detail).toBe('Letzte Runde des Feldzugs');
    // Abgegeben oder zuschauend: dieselbe Rüstzeit
    expect(
      titles(
        { state: 'prepare', kind: 'PREPARE', round: 2 },
        { state: 'prepared', kind: 'PREPARE', round: 2 },
      ),
    ).toEqual([]);
    expect(
      titles(
        { kind: 'CAMPAIGN_TARGET', round: 1 },
        { state: 'watching-prepare', kind: 'PREPARE', round: 2 },
      ),
    ).toEqual(['Rüstzeit']);
  });

  it('kündigt das Aufdecken an und danach keinen eigenen Feldzug', () => {
    const orders = between(
      { state: 'prepared', kind: 'PREPARE', round: 2 },
      { state: 'orders', kind: 'CAMPAIGN_TARGET', round: 2 },
    );
    expect(orders).toMatchObject([
      { key: 'orders-2', title: 'Die Befehle werden aufgedeckt', detail: null },
    ]);
    expect(
      titles(
        { state: 'orders', kind: 'CAMPAIGN_TARGET', round: 2 },
        { state: 'orders', kind: 'CAMPAIGN_TARGET', round: 2 },
      ),
    ).toEqual([]);
    // Die Runde hat die Rüstzeit schon angekündigt
    expect(
      titles(
        { state: 'orders', kind: 'CAMPAIGN_TARGET', round: 2 },
        { kind: 'CAMPAIGN_TARGET', round: 2 },
      ),
    ).toEqual([]);
    expect(
      titles({ kind: 'DUEL_TRIVIA', round: 2 }, { kind: 'CAMPAIGN_TARGET', round: 2 }),
    ).toEqual([]);
  });

  it('wartet mit der Ankündigung, solange eine Auflösung steht', () => {
    expect(
      titles(
        { state: 'question', kind: 'DUEL_TRIVIA', round: 2 },
        { state: 'reveal', kind: 'PREPARE', round: 3 },
      ),
    ).toEqual([]);
    expect(
      titles(
        { state: 'reveal', kind: 'PREPARE', round: 3 },
        { state: 'prepare', kind: 'PREPARE', round: 3 },
      ),
    ).toEqual([]);
  });

  it('sagt „Du bist dran“ beim eigenen Angriff, nicht in der Rüstzeit', () => {
    expect(
      titles(
        { state: 'orders', kind: 'CAMPAIGN_TARGET', round: 2, lastSeq: 40 },
        { state: 'pick', kind: 'CAMPAIGN_TARGET', round: 2, lastSeq: 41 },
      ),
    ).toEqual(['Du bist dran!']);
    expect(
      titles(
        { kind: 'CAMPAIGN_TARGET', round: 1 },
        { state: 'prepare', kind: 'PREPARE', round: 2 },
      ),
    ).toEqual(['Rüstzeit']);
  });

  it('ein ausgefallener Angriff bekommt ein Band in der Farbe des Reichs (ADR-064)', () => {
    const skipped = (seq: number, attacker: number): ParsedMatchEvent => {
      const event = parseMatchEvent({
        seq,
        at: '2026-11-10T20:00:00.000Z',
        type: 'ATTACK_SKIPPED',
        payload: { round: 2, attacker },
      });
      if (!event) throw new Error('Ereignis ungültig');
      return event;
    };
    // Ich bin Sitz 0 (Anna)
    const run = (
      before: Partial<MomentSnapshot>,
      next: Partial<MomentSnapshot>,
      fresh: readonly ParsedMatchEvent[],
    ) => momentsBetween(snap(before), snap(next), fresh, name, 5, true, 2, 0);
    // Beim Aufdecken: erst die Ankündigung, dann wer aussetzt
    const atReveal = run(
      { state: 'prepared', kind: 'PREPARE', round: 2 },
      { state: 'orders', kind: 'CAMPAIGN_TARGET', round: 2, lastSeq: 12 },
      [skipped(11, 1)],
    );
    expect(atReveal.map((m) => m.title)).toEqual([
      'Die Befehle werden aufgedeckt',
      'Bot (schwer) setzt aus',
    ]);
    expect(atReveal[1]).toMatchObject({
      key: 'skipped-11',
      detail: 'Keine Armee neben einem Ziel',
      tone: 'seat',
      seat: 1,
    });
    // Der eigene Angriff in der Du-Form
    expect(
      run({ round: 2 }, { round: 2, lastSeq: 12 }, [skipped(11, 0)]).map((m) => m.title),
    ).toEqual(['Dein Angriff fällt aus']);
    // Über einer Auflösung erscheint nichts
    expect(
      run(
        { state: 'question', kind: 'DUEL_TRIVIA', round: 2 },
        { state: 'reveal', kind: 'CAMPAIGN_TARGET', round: 2, lastSeq: 12 },
        [skipped(11, 1)],
      ),
    ).toEqual([]);
    // Vor der nächsten Runde: erst wer aussetzte, dann die Rüstzeit
    expect(
      run(
        { state: 'reveal', kind: 'DUEL_TRIVIA', round: 2 },
        { state: 'prepare', kind: 'PREPARE', round: 3, lastSeq: 14 },
        [skipped(11, 2)],
      ).map((m) => m.title),
    ).toEqual(['Bot (leicht) setzt aus', 'Rüstzeit']);
    // Alle setzen aus: Das Aufgedeckte steht mit dem Schritt der nächsten Runde, deren Rüstzeit
    // wird danach eigens angekündigt
    expect(
      run(
        { state: 'prepared', kind: 'PREPARE', round: 2 },
        { state: 'orders', kind: 'PREPARE', round: 2, lastSeq: 14 },
        [skipped(11, 0), skipped(12, 1), skipped(13, 2)],
      ).map((m) => m.title),
    ).toEqual(['Die Befehle werden aufgedeckt', 'Angriffe fallen aus']);
    // Mehrere Ausfälle zugleich: ein Band nennt alle, damit sie nicht bis in die Rüstzeit stehen
    expect(run({ round: 2 }, { round: 2, lastSeq: 13 }, [skipped(11, 0), skipped(12, 1)])).toEqual([
      {
        key: 'skipped-11',
        title: 'Angriffe fallen aus',
        detail: 'Keine Armee neben einem Ziel: Du, Bot (schwer)',
        tone: 'ink',
        seat: null,
      },
    ]);
    expect(
      run(
        { state: 'orders', kind: 'PREPARE', round: 2 },
        { state: 'prepare', kind: 'PREPARE', round: 3 },
        [],
      ).map((m) => m.title),
    ).toEqual(['Rüstzeit']);
  });

  it('feiert ein fallendes Reich wie ohne Ausbau', () => {
    const [moment] = momentsBetween(
      snap({ state: 'reveal', lastSeq: 8 }),
      snap({ state: 'reveal', lastSeq: 10 }),
      [eliminated(9, 1, 0)],
      name,
      5,
      true,
    );
    expect(moment).toMatchObject({ title: 'Ein Reich fällt!', tone: 'seat', seat: 0 });
  });
});

describe('Warteschlange der Bänder', () => {
  const turn = (lastSeq: number) =>
    momentsBetween(null, snap({ state: 'pick', lastSeq }), [], name, 4)[0]!;
  const campaign = momentsBetween(
    snap({ kind: 'LAND_PICK', round: 7 }),
    snap({ state: 'announce', kind: 'CAMPAIGN_TARGET', round: 1 }),
    [],
    name,
    4,
  )[0]!;
  const fallen = momentsBetween(
    snap({ lastSeq: 8 }),
    snap({ lastSeq: 10 }),
    [eliminated(9, 1, 0)],
    name,
    4,
  )[0]!;

  it('„Du bist dran“ verfällt, sobald die eigene Wahl vorbei ist', () => {
    const queue = [turn(30), campaign];
    expect(pruneMoments(queue, 'pick')).toBe(queue);
    // Die Ansage zeigt schon die Wahl eines anderen: Das Band wäre dort falsch
    expect(pruneMoments(queue, 'announce')).toEqual([campaign]);
    expect(pruneMoments(queue, 'waiting-pick')).toEqual([campaign]);
    expect(pruneMoments(queue, 'reveal')).toEqual([campaign]);
    // Verfällt nichts, bleibt es dieselbe Liste: Das laufende Band startet nicht neu
    const calm = [campaign];
    expect(pruneMoments(calm, 'announce')).toBe(calm);
  });

  it('während einer Frage bleibt nur ein gefallenes Reich', () => {
    expect(pruneMoments([turn(30), campaign, fallen], 'question')).toEqual([fallen]);
  });

  it('ein zweites „Du bist dran“ stellt sich nicht hinter das erste', () => {
    const first = [turn(30)];
    expect(enqueueMoments(first, [turn(31)])).toBe(first);
    expect(enqueueMoments(first, [campaign])).toEqual([turn(30), campaign]);
    expect(enqueueMoments([], [turn(31)])).toEqual([turn(31)]);
  });
});

describe('Aufstellung eines Duells', () => {
  const owner = WENDELMARK.regions.map(() => null as number | null);
  const at = (n: string) => WENDELMARK.regions.findIndex((r) => r.name === n);
  const art = mapArt(WENDELMARK);
  const s = art.size;

  /** Eckpunkte des Blockpfeils: Beginn, Hals, Flügel, Spitze, Flügel, Hals, Beginn. */
  function corners(arrow: string): { x: number; y: number }[] {
    return [...arrow.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
  }

  function inside(p: { x: number; y: number }, polygon: readonly { x: number; y: number }[]) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i]!;
      const b = polygon[j]!;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        hit = !hit;
      }
    }
    return hit;
  }

  it('der Angreifer zieht aus einer angrenzenden eigenen Region, nah an seiner Hauptstadt', () => {
    const target = at('Hagelstein');
    const own = [...owner];
    own[at('Ackerbrunn')] = 0;
    own[at('Birkental')] = 0;
    own[at('Otterbruch')] = 0;
    own[at('Eschenhain')] = 0;
    const from = attackSource(WENDELMARK, { owner: own, capital: at('Eschenhain') }, 0, target);
    expect(from).toBe(at('Ackerbrunn'));
    expect(WENDELMARK.adjacency[target]).toContain(from);
    // Ohne angrenzende eigene Region gibt es keine Aufstellung
    expect(attackSource(WENDELMARK, { owner, capital: null }, 0, target)).toBeNull();
  });

  it('die Wappen stehen in der Mitte ihrer Regionen, der Pfeil zeigt vom Angreifer zum Ziel', () => {
    const from = at('Birkental');
    const to = at('Hagelstein');
    const layout = duelLayout(art, from, to);
    expect(layout).not.toBeNull();
    const a = art.regions[from]!;
    const b = art.regions[to]!;
    expect(layout!.source).toEqual({ x: a.cx, y: a.cy });
    expect(layout!.target).toEqual({ x: b.cx, y: b.cy });
    expect(Math.hypot(layout!.dir.x, layout!.dir.y)).toBeCloseTo(1);
    expect(layout!.distance).toBeCloseTo(Math.hypot(b.cx - a.cx, b.cy - a.cy), 0);
    const points = corners(layout!.arrow);
    expect(points).toHaveLength(7);
    const start = points[0]!;
    const tip = points[3]!;
    const near = (p: { x: number; y: number }, q: { cx: number; cy: number }) =>
      Math.hypot(p.x - q.cx, p.y - q.cy);
    expect(near(start, a)).toBeLessThan(near(start, b));
    expect(near(tip, b)).toBeLessThan(near(tip, a));
    // Der Pfeil steht frei zwischen den Plättchen
    expect(near(start, a)).toBeGreaterThan(layout!.radius);
    expect(near(tip, b)).toBeGreaterThan(layout!.radius);
    expect(duelLayout(art, from, from)).toBeNull();
    expect(duelLayout(art, from, 99)).toBeNull();
  });

  it('auf jeder Grenze der Karte beginnt der Pfeil beim Angreifer und endet im Ziel', () => {
    for (const narrow of [false, true]) {
      for (const castle of [false, true]) {
        let pairs = 0;
        for (const [from, list] of WENDELMARK.adjacency.entries()) {
          for (const to of list) {
            const layout = duelLayout(art, from, to, { scale: duelScale(narrow), castle });
            expect(layout).not.toBeNull();
            pairs++;
            const points = corners(layout!.arrow);
            const where = `${from}→${to}${narrow ? ' schmal' : ''}${castle ? ' Burg' : ''}`;
            const tip = points[3]!;
            const a = art.regions[from]!;
            const b = art.regions[to]!;
            expect(inside(points[0]!, a.outline), where).toBe(true);
            // Die Spitze liegt jenseits der Mitte; ohne Burg sicher in der umkämpften Region
            expect(Math.hypot(tip.x - b.cx, tip.y - b.cy), where).toBeLessThan(
              Math.hypot(tip.x - a.cx, tip.y - a.cy),
            );
            if (!castle) expect(inside(tip, b.outline), where).toBe(true);
          }
        }
        expect(pairs).toBeGreaterThan(100);
      }
    }
  });

  it('oben auf der Karte weicht das Band nach unten', () => {
    // Die Wendelmark hat fünf Reihen: Die beiden oberen zählen zur oberen Hälfte
    expect(inUpperHalf(art, [at('Graufurt'), at('Eisenhang')])).toBe(true);
    expect(inUpperHalf(art, [at('Kranichsee'), at('Eisenhang')])).toBe(true);
    expect(inUpperHalf(art, [at('Kranichsee'), at('Immenau')])).toBe(false);
    expect(inUpperHalf(art, [at('Uferland'), at('Otterbruch')])).toBe(false);
    // Ohne Aufstellung zählt nur die umkämpfte Region
    expect(inUpperHalf(art, [null, at('Eschenhain')])).toBe(true);
    expect(inUpperHalf(art, [null, at('Zinnberg')])).toBe(false);
    expect(inUpperHalf(art, [null, 99])).toBe(false);
  });

  it('vor einer Burg endet der Pfeil kurz hinter der Grenze', () => {
    const from = at('Ackerbrunn');
    const to = at('Birkental');
    const b = art.regions[to]!;
    const reach = (castle: boolean) => {
      const tip = corners(duelLayout(art, from, to, { castle })!.arrow)[3]!;
      return Math.hypot(tip.x - b.cx, tip.y - b.cy);
    };
    // Burg, Münze und Leben liegen innerhalb von 0,62 Sechseckgrößen um die Mitte
    expect(reach(true)).toBeGreaterThan(0.65 * s);
    expect(reach(true)).toBeGreaterThan(reach(false));
  });
});
