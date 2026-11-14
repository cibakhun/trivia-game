import { describe, expect, it } from 'vitest';
import { fxParticles, type FxBurst, type FxKind } from '../src/art/fx/fx.ts';

const burst = (kind: FxKind, extra: Partial<FxBurst> = {}): FxBurst => ({
  key: `test:${kind}`,
  kind,
  x: 100,
  y: 50,
  size: 40,
  atMs: 350,
  ...extra,
});

describe('fxParticles', () => {
  it('würfelt aus dem Schlüssel: gleiche Eingabe, gleiche Teilchen', () => {
    expect(fxParticles(burst('shards'))).toEqual(fxParticles(burst('shards')));
    expect(fxParticles(burst('shards'))).not.toEqual(fxParticles(burst('shards', { key: 'x' })));
  });

  it('beginnt nie vor dem Ausbruch und hat eindeutige Schlüssel', () => {
    for (const kind of [
      'shards',
      'debris',
      'dust',
      'sparks',
      'splash',
      'ring',
      'glints',
      'streaks',
      'chips',
      'spatter',
    ] as const) {
      const particles = fxParticles(burst(kind));
      expect(particles.length).toBeGreaterThan(0);
      expect(new Set(particles.map((p) => p.key)).size).toBe(particles.length);
      for (const p of particles) {
        expect(p.delayMs).toBeGreaterThanOrEqual(350);
        expect(p.durationMs).toBeGreaterThan(0);
        expect(p.size).toBeGreaterThan(0);
      }
    }
  });

  it('streut Splitter nur in die Öffnung um die Hauptrichtung', () => {
    const particles = fxParticles(burst('shards', { dir: { x: 1, y: 0 }, spread: 90, count: 12 }));
    for (const p of particles) {
      // Waagrecht immer nach rechts; die Schwerkraft zieht nur senkrecht
      expect(p.dx).toBeGreaterThan(0);
    }
  });

  it('Steine landen tiefer, als sie starten', () => {
    for (const p of fxParticles(burst('debris', { count: 20 }))) expect(p.dy).toBeGreaterThan(0);
  });

  it('richtet sich nach der Zahl', () => {
    expect(fxParticles(burst('dust', { count: 3 }))).toHaveLength(3);
  });

  it('läuft mit `tempo` schneller, auf denselben Wegen', () => {
    const slow = fxParticles(burst('chips'));
    const fast = fxParticles(burst('chips', { tempo: 2 }));
    expect(fast).toHaveLength(slow.length);
    fast.forEach((p, i) => {
      expect(Math.abs(p.durationMs - slow[i]!.durationMs / 2)).toBeLessThanOrEqual(1);
      expect(p.dx).toBe(slow[i]!.dx);
      expect(p.dy).toBe(slow[i]!.dy);
    });
  });

  it('Splitter und Spritzer gleiten flach aus, ohne zu fallen', () => {
    for (const kind of ['chips', 'spatter'] as const) {
      for (const p of fxParticles(burst(kind, { dir: { x: 0, y: -1 }, spread: 60 }))) {
        // Nach oben gerichtet bleiben sie oben: keine Schwerkraft auf der Karte von oben
        expect(p.dy).toBeLessThan(0);
        expect(p.lift).toBe(0);
      }
    }
  });
});
