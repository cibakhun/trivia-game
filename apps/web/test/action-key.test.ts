import { describe, expect, it } from 'vitest';
import { ActionKey, ApiRequestError, NetworkError } from '../src/api/client.ts';

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
