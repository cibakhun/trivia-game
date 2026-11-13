import { describe, expect, it } from 'vitest';
import { ActionKey, ApiRequestError, NetworkError, isTransientError } from '../src/api/client.ts';

describe('ActionKey', () => {
  it('behält den Schlüssel nach einem Netzfehler für dieselbe Eingabe', () => {
    const key = new ActionKey();
    const first = key.for({ prefix: 'Falken', suffix: 'stein' });
    key.settle(new NetworkError(new Error('offline')));
    expect(key.for({ prefix: 'Falken', suffix: 'stein' })).toBe(first);
  });

  it('gibt einer geänderten Eingabe einen neuen Schlüssel', () => {
    const key = new ActionKey();
    const first = key.for({ prefix: 'Falken', suffix: 'stein' });
    key.settle(new NetworkError(new Error('offline')));
    const second = key.for({ prefix: 'Rosen', suffix: 'tal' });
    expect(second).not.toBe(first);
    // und bleibt dann bei der neuen Eingabe
    expect(key.for({ prefix: 'Rosen', suffix: 'tal' })).toBe(second);
  });

  it('wechselt nach einer Antwort des Servers', () => {
    const key = new ActionKey();
    const first = key.current;
    expect(key.current).toBe(first);
    key.settle(new ApiRequestError(409, 'ALREADY_JOINED'));
    const second = key.current;
    expect(second).not.toBe(first);
    key.settle();
    expect(key.current).not.toBe(second);
  });
});

describe('isTransientError', () => {
  it('lässt nach Netzfehler, Überlast und Serverfehler einen neuen Versuch zu', () => {
    expect(isTransientError(new NetworkError(new Error('offline')))).toBe(true);
    expect(isTransientError(new ApiRequestError(429, 'RATE_LIMITED'))).toBe(true);
    expect(isTransientError(new ApiRequestError(500, 'INTERNAL'))).toBe(true);
    expect(isTransientError(new ApiRequestError(503, 'UNAVAILABLE'))).toBe(true);
  });

  it('nimmt eine Antwort des Servers als endgültig', () => {
    // Mitlesen (ADR-065): Frage schon aufgelöst, selbst gefragt, nicht in der Partie
    expect(isTransientError(new ApiRequestError(409, 'STEP_EXPIRED'))).toBe(false);
    expect(isTransientError(new ApiRequestError(409, 'STEP_NOT_AVAILABLE'))).toBe(false);
    expect(isTransientError(new ApiRequestError(404, 'NOT_FOUND'))).toBe(false);
    // Eine Antwort, die nicht zum Protokoll passt, wird durch Wiederholen nicht besser
    expect(isTransientError(new Error('Antwort ungültig'))).toBe(false);
  });
});
