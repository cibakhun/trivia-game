import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_KEYS,
  ESTIMATE_MAX_WHOLE,
  estimateKeyOf,
  estimateToSend,
  pressEstimateKey,
  showEstimate,
  type EstimateKey,
} from '../src/match/estimate-input.ts';

/**
 * Ziffernfeld der Schätzfrage (ADR-059): Die Eingabe ist immer ein Text, den der Server als
 * deutsche Zahl liest, ganz gleich, in welcher Reihenfolge jemand tippt.
 */

function type(keys: string, precision: number, start = ''): string {
  let value = start;
  for (const key of keys) {
    value = pressEstimateKey(value, (key === '<' ? 'back' : key) as EstimateKey, precision);
  }
  return value;
}

describe('Ziffernfeld der Schätzfrage', () => {
  it('hat zwölf Tasten in der Ordnung eines Telefons', () => {
    expect(ESTIMATE_KEYS).toHaveLength(12);
    expect(ESTIMATE_KEYS.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(ESTIMATE_KEYS.slice(-3)).toEqual([',', '0', 'back']);
  });

  it('reiht Ziffern aneinander und löscht die letzte', () => {
    expect(type('1230', 0)).toBe('1230');
    expect(type('1230<', 0)).toBe('123');
    expect(type('<', 0)).toBe('');
  });

  it('lässt keine führenden Nullen stehen', () => {
    expect(type('0', 0)).toBe('0');
    expect(type('007', 0)).toBe('7');
    expect(type('0,5', 1)).toBe('0,5');
  });

  it('nimmt ein Komma nur, wenn die Frage Nachkommastellen wertet', () => {
    expect(type('12,5', 0)).toBe('125');
    expect(type('12,5', 1)).toBe('12,5');
    // Kein Komma am Anfang und kein zweites
    expect(type(',5', 1)).toBe('5');
    expect(type('1,2,3', 2)).toBe('1,23');
  });

  it('nimmt nicht mehr Nachkommastellen an, als gewertet werden', () => {
    expect(type('9,81', 1)).toBe('9,8');
    expect(type('9,812', 2)).toBe('9,81');
  });

  it('begrenzt die Länge vor dem Komma', () => {
    const long = type('9'.repeat(ESTIMATE_MAX_WHOLE + 5), 0);
    expect(long).toHaveLength(ESTIMATE_MAX_WHOLE);
  });

  it('liest die Tasten einer echten Tastatur', () => {
    expect(estimateKeyOf('7')).toBe('7');
    expect(estimateKeyOf(',')).toBe(',');
    expect(estimateKeyOf('.')).toBe(',');
    expect(estimateKeyOf('Backspace')).toBe('back');
    expect(estimateKeyOf('Delete')).toBe('back');
    expect(estimateKeyOf('Enter')).toBeNull();
    expect(estimateKeyOf('a')).toBeNull();
  });

  it('gliedert große Zahlen in der Anzeige, Jahreszahlen bleiben glatt', () => {
    expect(showEstimate('')).toBe('');
    expect(showEstimate('1989')).toBe('1989');
    expect(showEstimate('12500')).toBe('12.500');
    expect(showEstimate('1234567')).toBe('1.234.567');
    expect(showEstimate('12500,5')).toBe('12.500,5');
    expect(showEstimate('3,')).toBe('3,');
  });

  it('schickt nur eine fertige Zahl ab', () => {
    expect(estimateToSend('')).toBeNull();
    expect(estimateToSend('1230')).toBe('1230');
    expect(estimateToSend('9,8')).toBe('9,8');
    // Ein Komma, hinter dem nichts steht, zählt nicht
    expect(estimateToSend('9,')).toBe('9');
    expect(estimateToSend(',')).toBeNull();
  });
});
