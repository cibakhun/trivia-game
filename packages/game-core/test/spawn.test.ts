import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPAWN_RULES,
  axialKey,
  chooseStartRegion,
  createRng,
  hexDistance,
  spawnCandidates,
  tutorialTarget,
  type Axial,
  type SpawnKingdom,
  type SpawnRegion,
} from '../src/index.ts';

/** Sechseck mit Radius 7, Stufe 0 am Rand bis 10 im Zentrum, alles neutral. */
const CENTER = { q: 0, r: 0 };
const RADIUS = 7;

function world(): SpawnRegion[] {
  const regions: SpawnRegion[] = [];
  let id = 1;
  for (let q = -RADIUS; q <= RADIUS; q++) {
    for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) {
      const distance = hexDistance({ q, r }, CENTER);
      regions.push({
        id: String(id++),
        q,
        r,
        tier: Math.round((10 * (RADIUS - distance)) / RADIUS),
        ownerKingdomId: null,
        underSiege: false,
      });
    }
  }
  return regions;
}

function own(regions: SpawnRegion[], cells: readonly Axial[], kingdomId: string): SpawnRegion[] {
  const keys = new Set(cells.map(axialKey));
  return regions.map((region) =>
    keys.has(axialKey(region)) ? { ...region, ownerKingdomId: kingdomId } : region,
  );
}

const light: SpawnKingdom = {
  id: 'light',
  kind: 'NPC',
  archetype: 'LIGHT',
  regionCount: 1,
  capital: { q: 0, r: -3 },
};

function rng(byte = 1) {
  return createRng(new Uint8Array(16).fill(byte));
}

describe('Startregion (WORLD_SYSTEM §4.2)', () => {
  it('wählt nur neutrale Regionen der Startzone mit Raum und leichter Fraktion in Reichweite', () => {
    const regions = own(world(), [light.capital!], 'light');
    const candidates = spawnCandidates(regions, [light]);
    expect(candidates.length).toBeGreaterThan(0);
    for (const { region } of candidates) {
      expect(region.tier).toBeLessThanOrEqual(DEFAULT_SPAWN_RULES.maxTier);
      expect(region.ownerKingdomId).toBeNull();
      expect(hexDistance(region, light.capital!)).toBeLessThanOrEqual(8);
    }
  });

  it('verlangt eine leichte NPC-Fraktion im Radius 8', () => {
    expect(spawnCandidates(world(), [])).toEqual([]);
    const medium: SpawnKingdom = { ...light, id: 'medium', archetype: 'MEDIUM' };
    expect(spawnCandidates(own(world(), [light.capital!], 'medium'), [medium])).toEqual([]);
  });

  it('schließt belagerte Regionen und Regionen ohne genug freien Raum aus', () => {
    const base = own(world(), [light.capital!], 'light');
    const target = { q: 7, r: -7 }; // Ecke: wenige Nachbarn
    const corner = base.find((r) => axialKey(r) === axialKey(target))!;
    const free = (regions: SpawnRegion[]) =>
      spawnCandidates(regions, [light]).map((c) => c.region.id);
    expect(free(base)).toContain(corner.id);
    const sieged = base.map((r) => (r.id === corner.id ? { ...r, underSiege: true } : r));
    expect(free(sieged)).not.toContain(corner.id);
    // Ein direkter Nachbar bleibt frei (Nachbarregel erfüllt); im Radius 2 genau drei freie
    // Zellen → nur die Raumregel (mindestens vier) schließt die Ecke aus.
    const direct = base.filter((r) => hexDistance(r, target) === 1);
    const second = base.filter((r) => hexDistance(r, target) === 2);
    expect(direct.length).toBeGreaterThan(1);
    expect(second.length).toBeGreaterThan(3);
    const crowded = own(base, [...direct.slice(1), ...second.slice(2)], 'other');
    expect(free(crowded)).not.toContain(corner.id);
    // mit einer vierten freien Zelle wird sie wieder zugelassen
    const roomy = own(base, [...direct.slice(1), ...second.slice(3)], 'other');
    expect(free(roomy)).toContain(corner.id);
  });

  it('lässt ohne große Reiche auch einen Mindestabstand über 12 zu', () => {
    // die Kappung auf 12 gilt nur der Bewertung, nicht der Abstandsprüfung
    const base = own(world(), [light.capital!], 'light');
    const rules = { ...DEFAULT_SPAWN_RULES, largeKingdomDistance: 15 };
    expect(spawnCandidates(base, [light], rules).length).toBeGreaterThan(0);
  });

  it('hält Abstand zu großen Spielerreichen und zu fremden Hauptstädten', () => {
    const base = own(world(), [light.capital!], 'light');
    const capital = { q: 7, r: 0 };
    const small: SpawnKingdom = {
      id: 'p1',
      kind: 'PLAYER',
      archetype: null,
      regionCount: 1,
      capital,
    };
    const withSmall = own(base, [capital], 'p1');
    for (const { region } of spawnCandidates(withSmall, [light, small])) {
      expect(hexDistance(region, capital)).toBeGreaterThanOrEqual(3);
    }
    const large: SpawnKingdom = { ...small, regionCount: 15 };
    for (const { region } of spawnCandidates(withSmall, [light, large])) {
      expect(hexDistance(region, capital)).toBeGreaterThanOrEqual(6);
    }
  });

  it('bevorzugt freien Raum und die Nähe zu anderen Neulingen', () => {
    const base = own(world(), [light.capital!], 'light');
    const candidates = spawnCandidates(base, [light]);
    const corner = candidates.find((c) => axialKey(c.region) === '7,-7')!;
    const edge = candidates.find((c) => axialKey(c.region) === '6,-3')!;
    expect(edge.score).toBeGreaterThan(corner.score);

    const newcomer: SpawnKingdom = {
      id: 'p1',
      kind: 'PLAYER',
      archetype: null,
      regionCount: 2,
      capital: { q: -7, r: 4 },
    };
    const near = spawnCandidates(own(base, [newcomer.capital!], 'p1'), [light, newcomer]);
    const best = chooseStartRegion(near, rng())!;
    expect(hexDistance(best, newcomer.capital!)).toBeLessThanOrEqual(8);
  });

  it('entscheidet Gleichstand per Zufallsstrom, unabhängig von der Reihenfolge', () => {
    const candidates = spawnCandidates(own(world(), [light.capital!], 'light'), [light]);
    const a = chooseStartRegion(candidates, rng(1));
    expect(chooseStartRegion([...candidates].reverse(), rng(1))).toEqual(a);
    const picks = new Set(
      Array.from({ length: 20 }, (_, i) => chooseStartRegion(candidates, rng(i + 1))?.id),
    );
    expect(picks.size).toBeGreaterThan(1);
    expect(chooseStartRegion([], rng())).toBeNull();
  });
});

describe('Tutorial-Garnison', () => {
  it('ist der freie neutrale Nachbar mit der niedrigsten Stufe', () => {
    const regions = world();
    const start = { q: 6, r: -3 };
    const target = tutorialTarget(regions, start)!;
    expect(hexDistance(target, start)).toBe(1);
    expect(target.tier).toBe(0);
    const taken = own(
      regions,
      regions.filter((r) => hexDistance(r, start) === 1),
      'x',
    );
    expect(tutorialTarget(taken, start)).toBeNull();
  });
});
