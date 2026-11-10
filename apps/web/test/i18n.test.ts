import { BIOMES } from '@rdw/game-core';
import {
  ATTACK_REFUSAL_CODES,
  ERROR_CODES,
  KINGDOM_RANK_CODES,
  OUTCOME_REASONS,
  WORLD_MODES,
} from '@rdw/protocol';
import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de.ts';
import { errorMessage, formatDecimal, hasMessage, t, tp } from '../src/i18n/i18n.ts';

/** Vollständigkeit der deutschen Texte gegen die Codes des Protokolls (ADR-036). */

function leaves(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

describe('deutsche Texte', () => {
  it('haben für jeden Fehlercode einen Text (Ablehnungsgründe unter attack.reason)', () => {
    const refusals = new Set<string>(ATTACK_REFUSAL_CODES);
    const missing = ERROR_CODES.filter((code) =>
      refusals.has(code) ? !hasMessage(`attack.reason.${code}`) : !hasMessage(`errors.${code}`),
    );
    expect(missing).toEqual([]);
  });

  it('führen keine Texte für unbekannte Codes', () => {
    const known = new Set<string>(ERROR_CODES);
    const stale = [
      ...Object.keys(de.attack.reason),
      ...Object.keys(de.errors).filter((key) => key !== 'generic' && key !== 'network'),
    ].filter((code) => !known.has(code));
    expect(stale).toEqual([]);
  });

  it('haben jeden Ausgangsgrund, Rang, Weltmodus und jedes Biom', () => {
    const keys = [
      ...OUTCOME_REASONS.map((reason) => `result.reason.${reason}`),
      ...KINGDOM_RANK_CODES.map((rank) => `rank.${rank}`),
      ...WORLD_MODES.map((mode) => `start.worldMode.${mode}`),
      ...BIOMES.map((biome) => `biome.${biome}`),
    ];
    expect(keys.filter((key) => !hasMessage(key))).toEqual([]);
  });

  it('enthalten keine leeren Texte', () => {
    expect(leaves(de).filter(([, text]) => text.trim() === '')).toEqual([]);
  });
});

describe('Übersetzungsfunktionen', () => {
  it('setzen Parameter ein und lassen unbekannte stehen', () => {
    expect(t('region.label', { biome: 'Küste', tier: 2 })).toBe('Küste, Stufe 2');
    expect(t('region.title')).toBe('Region {id}');
  });

  it('wählen die deutsche Pluralform und gruppieren Zahlen', () => {
    expect(tp('kingdom.regions', 1)).toBe('1 Region');
    expect(tp('kingdom.regions', 2)).toBe('2 Regionen');
    expect(tp('kingdom.regions', 1000)).toBe('1.000 Regionen');
  });

  it('schreiben kanonische Dezimalzahlen deutsch, ohne zu runden', () => {
    expect(formatDecimal('27')).toBe('27');
    expect(formatDecimal('1234.5')).toBe('1.234,5');
    expect(formatDecimal('-1234567.125')).toBe('-1.234.567,125');
    expect(formatDecimal('0.05')).toBe('0,05');
    expect(formatDecimal('kein Wert')).toBe('kein Wert');
  });

  it('übersetzen Fehlercodes mit Zeitpunkt und fallen sonst auf den allgemeinen Text zurück', () => {
    const until = '2026-11-12T10:30:00.000Z';
    expect(errorMessage('REGION_PROTECTED', { until })).toMatch(/^Die Region ist geschützt bis \S/);
    expect(errorMessage('REGION_PROTECTED', { until })).not.toContain('{until}');
    expect(errorMessage('ATTACKER_ATTEMPT_LIMIT', { resetAt: until })).not.toContain('{until}');
    expect(errorMessage('INSTANCE_FULL')).toBe('Diese Welt ist voll.');
    expect(errorMessage('RATE_LIMITED', { retryAfterMs: 61_000 })).toBe(
      'Zu viele Fehlversuche. Bitte versuche es in 2 Min. erneut.',
    );
    expect(errorMessage('RATE_LIMITED', { retryAfterMs: 500 })).toContain('in 1 Min.');
    expect(errorMessage('GIBT_ES_NICHT')).toBe(t('errors.generic'));
  });
});
