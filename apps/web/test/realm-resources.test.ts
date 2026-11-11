import { KERNMARK, realmResourceTable, regionResource, WENDELMARK } from '@rdw/game-core';
import { describe, expect, it } from 'vitest';
import { terrainOf, type Terrain } from '../src/art/terrain.ts';

/**
 * Rohstoffe der Partie mit Ausbau (docs/MATCH_RULES.md §11, ADR-057): Man sieht sie an der
 * Landschaft. Die Regeln im Spielkern und die Motive auf der Karte müssen deckungsgleich bleiben.
 */

const BREAD: readonly Terrain[] = ['fields', 'meadow', 'river', 'lake', 'village'];

describe('Rohstoff je Region passt zur gezeichneten Landschaft', () => {
  it('Felder, Wiesen, Wasser und Dörfer geben Brot, Wald, Berge, Hügel und Moor Baustoff', () => {
    for (const [name, resource] of Object.entries(realmResourceTable())) {
      const expected = BREAD.includes(terrainOf(name)) ? 'BREAD' : 'MATERIAL';
      expect(resource, `${name} (${terrainOf(name)})`).toBe(expected);
    }
  });

  it('jede Region beider Karten hat einen Rohstoff', () => {
    for (const map of [WENDELMARK, KERNMARK]) {
      for (const r of map.regions) {
        expect(['BREAD', 'MATERIAL']).toContain(regionResource(map, r.id));
      }
    }
  });
});
