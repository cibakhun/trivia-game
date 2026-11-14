import { WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { duelLayout } from '../src/art/attack.ts';
import { fxParticles, type FxBurst } from '../src/art/fx/fx.ts';
import { mapArt } from '../src/art/map-art.ts';
import type { RealmLayer, RealmMotion, RealmMove } from '../src/match/RealmBoardArt.tsx';
import { OUTCOME_TIMES, REVEAL_TIMES, realmBursts } from '../src/match/realm-fx.ts';

/**
 * Effekte der Partie mit Ausbau über der Karte (ADR-068): Staub, Trümmer und Glanz folgen der
 * Bewegung der Karte und sind verweht, bevor ihre Ebene geht.
 */

const art = mapArt(WENDELMARK);

function layer(
  buildings: Readonly<Record<number, 'VILLAGE' | 'TOWN' | 'CASTLE'>> = {},
  armies: Readonly<Record<number, number>> = {},
  moves: readonly RealmMove[] = [],
): RealmLayer {
  return {
    regions: WENDELMARK.regions.map((r) => ({
      building: buildings[r.id] ?? ('NONE' as const),
      armies: armies[r.id] ?? 0,
      castleLives: buildings[r.id] === 'CASTLE' ? 2 : 0,
      held: 0,
    })),
    moves,
  };
}

const plan = (realm: RealmLayer, motion: RealmMotion, attack = true) =>
  realmBursts({ art, realm, motion, layout: attack ? duelLayout(art, 0, 1) : null });

/** Wann das letzte Teilchen eines Plans verweht ist. */
function lastMs(bursts: readonly FxBurst[]): number {
  return Math.max(...bursts.flatMap(fxParticles).map((p) => p.delayMs + p.durationMs));
}

const particles = (bursts: readonly FxBurst[]) => bursts.flatMap(fxParticles).length;

describe('realmBursts: Ausgang', () => {
  const outcomes: readonly [string, RealmLayer, RealmMotion][] = [
    ['Dorf fällt', layer(), { kind: 'outcome', fields: { 1: { fell: 'VILLAGE' } } }],
    [
      'Stadt wird Dorf',
      layer({ 1: 'VILLAGE' }),
      { kind: 'outcome', fields: { 1: { fell: 'TOWN' } } },
    ],
    ['Burg fällt', layer(), { kind: 'outcome', fields: { 1: { fell: 'CASTLE', lost: 0 } } }],
    [
      'Burg getroffen',
      layer({ 1: 'CASTLE' }, { 1: 2 }),
      { kind: 'outcome', fields: { 1: { hit: true } } },
    ],
  ];

  it.each(outcomes)(
    '%s: verweht vor dem Ende des ersten Takts, mit wenigen Teilchen',
    (_, realm, motion) => {
      const { bursts } = plan(realm, motion);
      expect(bursts.length).toBeGreaterThan(0);
      // Die Ebene geht nach 1,5 s mit der Szene `outcome`; nichts darf dort abreißen
      expect(lastMs(bursts)).toBeLessThan(1450);
      expect(particles(bursts)).toBeLessThanOrEqual(30);
      // Nichts beginnt, bevor der Schlag sitzt
      for (const burst of bursts) expect(burst.atMs).toBeGreaterThanOrEqual(OUTCOME_TIMES.impactMs);
    },
  );

  it('lässt nur eine einstürzende Burg die Karte schwer beben, im Schlag', () => {
    const [, , , hit] = outcomes;
    expect(plan(layer(), { kind: 'outcome', fields: { 1: { fell: 'CASTLE' } } }).quake).toEqual({
      strength: 'heavy',
      atMs: OUTCOME_TIMES.impactMs,
    });
    expect(plan(hit![1], hit![2]).quake).toBeNull();
    expect(plan(layer(), { kind: 'outcome', fields: { 1: { fell: 'VILLAGE' } } }).quake).toBeNull();
  });

  it('wirft Trümmer vom Angreifer weg und Splitter einer getroffenen Mauer zu ihm zurück', () => {
    const dir = duelLayout(art, 0, 1)!.dir;
    const fell = plan(layer(), { kind: 'outcome', fields: { 1: { fell: 'VILLAGE' } } }).bursts;
    expect(fell.find((b) => b.key.endsWith(':roof'))?.dir).toEqual(dir);
    const hit = plan(layer({ 1: 'CASTLE' }), { kind: 'outcome', fields: { 1: { hit: true } } });
    expect(hit.bursts.find((b) => b.key.endsWith(':chips'))?.dir).toEqual({ x: -dir.x, y: -dir.y });
    // Ohne Duell auf der Karte fliegen sie rundum
    const free = plan(layer(), { kind: 'outcome', fields: { 1: { fell: 'VILLAGE' } } }, false);
    expect(free.bursts.find((b) => b.key.endsWith(':roof'))?.dir).toBeUndefined();
  });

  it('zeigt für eine verlorene Armee allein nichts über der Karte: Das macht der Träger selbst', () => {
    const { bursts, quake } = plan(layer({}, { 0: 1 }), {
      kind: 'outcome',
      fields: { 0: { lost: 0 } },
    });
    expect(bursts).toEqual([]);
    expect(quake).toBeNull();
  });

  it('hat einen Schlüssel je Ausgang: gleicher Ausgang, gleiche Teilchen', () => {
    const motion: RealmMotion = { kind: 'outcome', fields: { 1: { fell: 'TOWN' } } };
    const a = plan(layer({ 1: 'VILLAGE' }), motion);
    const b = plan(layer({ 1: 'VILLAGE' }), motion);
    expect(a).toEqual(b);
    expect(a.key).not.toBe(
      plan(layer(), { kind: 'outcome', fields: { 1: { fell: 'VILLAGE' } } }).key,
    );
    expect(new Set(a.bursts.map((burst) => burst.key)).size).toBe(a.bursts.length);
  });
});

describe('realmBursts: Aufdecken', () => {
  const realm = layer({ 1: 'VILLAGE', 5: 'CASTLE' }, { 5: 3, 4: 2 }, [
    { from: 5, to: 4, count: 2, seat: 0 },
  ]);
  const motion: RealmMotion = {
    kind: 'orders',
    fields: { 1: { built: true }, 5: { recruited: 2, left: 2 }, 4: { arrived: 2 } },
  };

  it('ist verweht, bevor das Aufdecken endet, mit wenigen Teilchen', () => {
    const { bursts, quake } = plan(realm, motion, false);
    expect(lastMs(bursts)).toBeLessThan(1950);
    expect(particles(bursts)).toBeLessThanOrEqual(40);
    expect(quake).toBeNull();
  });

  it('staubt am Fuß eines wachsenden Gebäudes und lässt es danach glänzen', () => {
    const { bursts } = plan(realm, motion, false);
    const dust = bursts.find((b) => b.key.endsWith(':build-dust'));
    const glints = bursts.find((b) => b.key.endsWith(':glints'));
    expect(dust?.atMs).toBeGreaterThanOrEqual(REVEAL_TIMES.riseAt);
    expect(glints!.atMs).toBeGreaterThan(dust!.atMs);
  });

  it('lässt neue Armeen funkelnd aus dem Tor treten', () => {
    const { bursts } = plan(realm, motion, false);
    expect(bursts.filter((b) => b.key.endsWith(':gate'))).toHaveLength(1);
  });

  it('staubt bei jedem Aufsetzen eines Zugs und setzt ihn mit einem Ring am Ziel auf', () => {
    const { bursts } = plan(realm, motion, false);
    const steps = bursts.filter((b) => b.key.includes(':step-'));
    expect(steps).toHaveLength(4);
    // Die Schritte folgen aufeinander, alle nach dem Aufbruch und vor der Ankunft
    const land = REVEAL_TIMES.marchAt + REVEAL_TIMES.marchMs * REVEAL_TIMES.landAt;
    const times = steps.map((b) => b.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times[0]).toBeGreaterThan(REVEAL_TIMES.marchAt);
    expect(times[3]).toBeLessThan(land);
    const ring = bursts.find((b) => b.key.endsWith(':ring'));
    expect(ring?.kind).toBe('ring');
    expect(Math.abs(ring!.atMs - land)).toBeLessThanOrEqual(60);
  });

  it('zeigt nichts ohne Bewegung', () => {
    expect(plan(layer(), { kind: 'orders', fields: {} }).bursts).toEqual([]);
  });
});
