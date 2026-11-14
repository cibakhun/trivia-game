import { WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { duelContact, duelContactOf, duelLayout } from '../src/art/attack.ts';
import { fxParticles } from '../src/art/fx/fx.ts';
import { mapArt } from '../src/art/map-art.ts';
import { boardFx, duelFx, HIT_STOP_MS, IMPACT_MS } from '../src/match/board-fx.ts';
import type { DuelStage } from '../src/match/match-model.ts';

/** Effekte des Duells auf der Karte (ADR-070): Anlauf, Einschlag und je Ausgang ein eigenes Bild. */

const art = mapArt(WENDELMARK);
const at = (name: string) => WENDELMARK.regions.findIndex((r) => r.name === name);
const FROM = at('Dornfeld');
const TO = at('Kranichsee');

function stage(partial: Partial<DuelStage> = {}): DuelStage {
  return {
    attacker: 2,
    defender: 1,
    region: TO,
    scene: 'outcome',
    winner: 2,
    repelled: false,
    effect: 'CONQUERED',
    ...partial,
  };
}

function fx(duel: DuelStage, castle = false) {
  const layout = duelLayout(art, FROM, TO, { castle });
  return duelFx({ art, duel, layout, castle, realm: null, live: true });
}

const particles = (bursts: ReturnType<typeof fx>['bursts']) => bursts.flatMap(fxParticles);

const OUTCOMES: Record<string, [DuelStage, boolean]> = {
  erobert: [stage(), false],
  'Reich fällt': [stage({ effect: 'TAKEOVER' }), true],
  gehalten: [stage({ winner: 1, repelled: true, effect: 'FORTIFIED' }), false],
  'frei bleibt frei': [
    stage({ defender: null, winner: null, repelled: true, effect: 'FORTIFIED' }),
    false,
  ],
  'Burg getroffen': [stage({ effect: 'CAPITAL_HIT' }), true],
  'Gebäude getroffen': [stage({ effect: 'CAPITAL_HIT' }), false],
};

describe('duelFx', () => {
  it('spielt nur im Ausgang und nur, was die Seite miterlebt hat', () => {
    const layout = duelLayout(art, FROM, TO);
    for (const scene of ['announce', 'duel', 'settled'] as const) {
      expect(fx(stage({ scene })).bursts).toHaveLength(0);
    }
    expect(
      boardFx({ art, duel: stage(), layout, castle: false, realm: null, live: false }).bursts,
    ).toHaveLength(0);
    expect(
      duelFx({ art, duel: stage(), layout: null, castle: false, realm: null, live: true }).bursts,
    ).toHaveLength(0);
  });

  it('jeder Ausgang: Anlauf mit Strichen, Einschlag mit Druckwelle und Beben, höchstens 40 Teilchen', () => {
    for (const [name, [duel, castle]] of Object.entries(OUTCOMES)) {
      const { bursts, quake } = fx(duel, castle);
      const kinds = bursts.map((b) => b.kind);
      expect(kinds, name).toContain('streaks');
      // Striche nur, solange er stürmt
      for (const b of bursts.filter((b) => b.kind === 'streaks')) {
        expect(b.atMs, name).toBeLessThan(IMPACT_MS);
      }
      expect(
        bursts.some((b) => b.kind === 'ring' && b.atMs === IMPACT_MS),
        name,
      ).toBe(true);
      expect(quake?.atMs, name).toBe(IMPACT_MS);
      expect(quake?.strength, name).toBe(duel.effect === 'TAKEOVER' ? 'heavy' : 'light');
      const all = particles(bursts);
      expect(all.length, name).toBeLessThanOrEqual(40);
      expect(new Set(all.map((p) => p.key)).size, name).toBe(all.length);
      // Nach dem Einschlag ist alles vor dem Ende des Ausgangs (1,5 s) verflogen
      for (const p of all) expect(p.delayMs + p.durationMs, name).toBeLessThan(1500);
    }
  });

  it('erobert: Der Verteidiger zerspringt nach dem Treffer-Stopp in seiner Farbe, Tinte des Siegers spritzt', () => {
    const { bursts } = fx(stage());
    const shards = bursts.find((b) => b.key.endsWith(':shards'));
    expect(shards?.color).toBe('var(--seat-1)');
    expect(shards?.atMs).toBeGreaterThanOrEqual(IMPACT_MS + HIT_STOP_MS - 10);
    const splash = bursts.find((b) => b.kind === 'spatter');
    expect(splash?.color).toBe('var(--seat-2)');
    // Zweite Druckwelle in der Farbe des Siegers
    expect(bursts.some((b) => b.kind === 'ring' && b.color === 'var(--seat-2)')).toBe(true);
  });

  it('gehalten: goldene Funken zum Angreifer zurück, der Pfeil splittert in seiner Farbe', () => {
    const layout = duelLayout(art, FROM, TO)!;
    const { bursts } = fx(OUTCOMES.gehalten![0]);
    const sparks = bursts.find((b) => b.kind === 'sparks');
    expect(sparks).toBeDefined();
    // Zurück, also gegen die Richtung des Angriffs
    expect(sparks!.dir!.x * layout.dir.x + sparks!.dir!.y * layout.dir.y).toBeLessThan(0);
    expect(bursts.find((b) => b.key.endsWith(':arrow'))?.color).toBe('var(--seat-2)');
    expect(bursts.some((b) => b.key.endsWith(':shards'))).toBe(false);
  });

  it('getroffen: Funken und Steinsplitter, wo der Angreifer anschlägt', () => {
    const { bursts } = fx(stage({ effect: 'CAPITAL_HIT' }), true);
    expect(bursts.map((b) => b.kind)).toEqual(expect.arrayContaining(['sparks', 'debris']));
    const layout = duelLayout(art, FROM, TO, { castle: true })!;
    const hit = duelContact(layout, 'wall', art.size) + layout.radius;
    const sparks = bursts.find((b) => b.kind === 'sparks')!;
    expect(sparks.x).toBeCloseTo(layout.source.x + layout.dir.x * hit, 5);
    expect(sparks.y).toBeCloseTo(layout.source.y + layout.dir.y * hit, 5);
  });
});

describe('duelContact', () => {
  const layout = duelLayout(art, FROM, TO)!;

  it('wählt, wogegen der Angreifer stößt', () => {
    expect(duelContactOf({ defender: 1, repelled: false }, false)).toBe('token');
    expect(duelContactOf({ defender: 1, repelled: true }, false)).toBe('guard');
    expect(duelContactOf({ defender: null, repelled: false }, false)).toBe('field');
    expect(duelContactOf({ defender: 1, repelled: true }, true)).toBe('wall');
  });

  it('der Schild hält ihn vor dem Wappen auf, auf einem freien Feld setzt er in der Mitte auf', () => {
    const s = art.size;
    const token = duelContact(layout, 'token', s);
    const guard = duelContact(layout, 'guard', s);
    expect(guard).toBeLessThan(token);
    expect(duelContact(layout, 'field', s)).toBeCloseTo(layout.distance, 0);
    // Immer ein kurzer Anlauf, auch wenn die Regionen dicht beieinander liegen
    for (const contact of ['token', 'guard', 'wall', 'field'] as const) {
      expect(duelContact(layout, contact, s)).toBeGreaterThanOrEqual(0.6 * layout.radius - 0.05);
    }
  });

  it('Schaft und Spitze im eigenen Rahmen bilden denselben Pfeil', () => {
    const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const head = nums(layout.head);
    const shaft = nums(layout.shaft);
    // Die Spitze liegt auf der Achse bei `tip`, der Schaft beginnt bei `start`
    expect(head[2]).toBeCloseTo(layout.tip, 1);
    expect(head[3]).toBeCloseTo(0, 1);
    expect(shaft[0]).toBeCloseTo(layout.start, 1);
    // Der Schaft reicht ein Stück in die Spitze: keine Fuge
    expect(shaft[2]).toBeGreaterThan(head[0]!);
    expect(shaft[2]).toBeLessThan(layout.tip);
    expect(layout.tip - layout.start).toBeGreaterThan(0);
  });
});
