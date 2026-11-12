import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crashCause, crashReport, type CrashEnv } from '../src/components/crash-report.ts';

const ENV: CrashEnv = {
  path: '/partie/0190c2a0-0000-7000-8000-000000000001',
  agent: 'Mozilla/5.0 (Test)',
  at: '2026-11-12T15:30:00.000Z',
};

/** Fehler, wie ihn der Browser wirft, wenn React eine fremd verschobene Textstelle entfernen will. */
function foreignDomError(): Error {
  const error = new DOMException(
    "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    'NotFoundError',
  );
  Object.defineProperty(error, 'stack', {
    value: [
      "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
      ...Array.from(
        { length: 12 },
        (_, i) => `    at f${i} (https://beispiel.example/assets/react-KPuNr9iS.js:8:${1000 + i})`,
      ),
    ].join('\n'),
  });
  return error;
}

describe('Meldung des Auffangschirms (ADR-061)', () => {
  it('erkennt den fremden Umbau der Seite an NotFoundError, alles andere bleibt unbekannt', () => {
    expect(crashCause(foreignDomError())).toBe('foreign-dom');
    // Safari und Firefox melden andere Sätze, aber denselben Namen
    expect(crashCause(new DOMException('The object can not be found here.', 'NotFoundError'))).toBe(
      'foreign-dom',
    );
    expect(crashCause(new TypeError('x is undefined'))).toBe('unknown');
    expect(crashCause(new RangeError('Unbekannte Region 99'))).toBe('unknown');
    expect(crashCause('nur ein Text')).toBe('unknown');
    expect(crashCause(null)).toBe('unknown');
  });

  it('nennt Zeit, Seite, Browser und den Fehler mit seinem Namen', () => {
    const report = crashReport(new RangeError('Unbekannte Region 99'), null, ENV);
    const lines = report.split('\n');
    expect(lines[0]).toBe('Zeit: 2026-11-12T15:30:00.000Z');
    expect(lines[1]).toBe('Seite: /partie/0190c2a0-0000-7000-8000-000000000001');
    expect(lines[2]).toBe('Browser: Mozilla/5.0 (Test)');
    expect(lines[3]).toBe('Fehler: RangeError: Unbekannte Region 99');
  });

  it('kürzt den Stapel auf acht Zeilen, ohne die Adresse des Servers und ohne die Meldung doppelt', () => {
    const report = crashReport(foreignDomError(), null, ENV);
    const lines = report.split('\n');
    expect(lines[3]).toBe(
      "Fehler: NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    );
    expect(lines[4]).toBe('Stelle:');
    const where = lines.slice(5);
    expect(where).toHaveLength(8);
    expect(where[0]).toBe('  at f0 (assets/react-KPuNr9iS.js:8:1000)');
    expect(where[7]).toBe('  at f7 (assets/react-KPuNr9iS.js:8:1007)');
    expect(report).not.toContain('beispiel.example');
    expect(report.match(/not a child of this node/g)).toHaveLength(1);
  });

  it('behält den Stapel, wenn der Fehler keine Meldung hat', () => {
    const error = new Error('');
    Object.defineProperty(error, 'stack', {
      value: ['Error', '    at eins (a.js:1:1)', '    at zwei (b.js:2:2)'].join('\n'),
    });
    const lines = crashReport(error, null, ENV).split('\n');
    expect(lines.slice(4)).toEqual(['Stelle:', '  at eins (a.js:1:1)', '  at zwei (b.js:2:2)']);
  });

  it('hängt den Weg durch die Bauteile an, sobald React ihn mitgibt', () => {
    const parts =
      '\n    at RealmStage (https://beispiel.example/assets/index-abc.js:1:2)\n    at MatchScreen\n    at App';
    const report = crashReport(new TypeError('x is undefined'), parts, ENV);
    expect(report).toContain(
      'Bauteile:\n  at RealmStage (assets/index-abc.js:1:2)\n  at MatchScreen\n  at App',
    );
    expect(crashReport(new TypeError('x is undefined'), null, ENV)).not.toContain('Bauteile:');
  });

  it('kommt auch mit etwas zurecht, das kein Fehlerobjekt ist', () => {
    expect(crashReport('kaputt', null, ENV).split('\n')[3]).toBe('Fehler: kaputt');
    expect(crashReport(undefined, null, ENV).split('\n')[3]).toBe('Fehler: undefined');
    expect(crashReport({ message: 'ohne Namen' }, null, ENV).split('\n')[3]).toBe(
      'Fehler: ohne Namen',
    );
  });
});

describe('Seite ohne automatische Übersetzung (ADR-061)', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

  it('sperrt die Übersetzung des Browsers für das ganze Dokument', () => {
    expect(html).toMatch(/<html lang="de" translate="no">/);
    expect(html).toMatch(/<meta name="google" content="notranslate" \/>/);
  });
});
