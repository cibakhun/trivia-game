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

  it('läuft mit kleinerem Takt schneller ab, in derselben Gestalt', () => {
    const normal = fxParticles(burst('dust', { count: 6 }));
    const quick = fxParticles(burst('dust', { count: 6, tempo: 0.5 }));
    expect(quick).toHaveLength(normal.length);
    quick.forEach((p, i) => {
      const q = normal[i]!;
      expect(p.dx).toBe(q.dx);
      expect(p.size).toBe(q.size);
      expect(p.durationMs).toBeLessThan(q.durationMs);
      expect(p.delayMs - 350).toBeLessThanOrEqual(q.delayMs - 350);
    });
  });
});
