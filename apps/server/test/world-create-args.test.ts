import { describe, expect, it } from 'vitest';
import { parseWorldCreateArgs } from '../src/cli/world-create-args.ts';

describe('Argumente von world:create', () => {
  it('liest Optionen und die Freigabe', () => {
    const args = parseWorldCreateArgs([
      '--slug=test-2',
      '--seed=-17',
      '--capacity=30',
      '--production-approved',
    ]);
    expect(args).toEqual(
      new Map([
        ['--slug', 'test-2'],
        ['--seed', '-17'],
        ['--capacity', '30'],
        ['--production-approved', 'true'],
      ]),
    );
    expect(parseWorldCreateArgs([])).toEqual(new Map());
  });

  it('trennt am ersten „=“ und verliert nichts dahinter', () => {
    expect(parseWorldCreateArgs(['--slug=test=x'])).toEqual(new Map([['--slug', 'test=x']]));
  });

  it('nennt unbekannte, leere, doppelte und unvollständige Argumente', () => {
    expect(parseWorldCreateArgs(['--slg=test'])).toBe('--slg=test');
    expect(parseWorldCreateArgs(['--slug='])).toBe('--slug=');
    expect(parseWorldCreateArgs(['--slug'])).toBe('--slug');
    expect(parseWorldCreateArgs(['=test'])).toBe('=test');
    expect(parseWorldCreateArgs(['--production-aproved'])).toBe('--production-aproved');
    expect(parseWorldCreateArgs(['--seed=1', '--seed=2'])).toBe('--seed=2');
  });
});
