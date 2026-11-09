import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { validateContentDir, validateQuestionText } from '../src/index.ts';

const today = '2026-11-09';

function trivia(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const t = (prompt: string, opts: string[]) => ({
    status: 'DRAFT',
    prompt,
    options: Object.fromEntries(['a', 'b', 'c', 'd'].map((k, i) => [k, opts[i]])),
  });
  return {
    schema_version: 1,
    key: 'test-frage',
    kind: 'TRIVIA',
    category: 'SCIENCE',
    difficulty: 2,
    origin: 'AI_ASSISTED',
    license_note: null,
    status: 'DRAFT',
    tags: [],
    sources: [{ title: 'Gold', url: 'https://en.wikipedia.org/wiki/Gold', accessed: today }],
    reviews: [],
    trivia: { options: ['a', 'b', 'c', 'd'], correct: 'b' },
    translations: {
      de: t('Welches chemische Symbol hat Gold?', ['Ag', 'Au', 'Go', 'Gd']),
      hu: t('Mi az arany vegyjele a kémiában?', ['Ag', 'Au', 'Go', 'Gd']),
      en: t('What is the chemical symbol for gold?', ['Ag', 'Au', 'Go', 'Gd']),
    },
    ...overrides,
  };
}

function estimate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const t = (prompt: string, unit: string) => ({ status: 'DRAFT', prompt, unit_label: unit });
  const base = trivia();
  delete base.trivia;
  return {
    ...base,
    key: 'test-schaetzung',
    kind: 'ESTIMATE',
    estimate: {
      answer_value: '1642',
      answer_precision: 0,
      answer_unit: 'm',
      input_min: '0',
      input_max: '12000',
      scale_type: 'LOG',
      scale: 0.4,
    },
    translations: {
      de: t('Wie tief ist der Baikalsee (in Metern)?', 'Meter'),
      hu: t('Milyen mély a Bajkál-tó (méterben)?', 'méter'),
      en: t('How deep is Lake Baikal (in metres)?', 'metres'),
    },
    ...overrides,
  };
}

const fullReviews = [
  { kind: 'FACT', reviewer: 'Redaktion A', date: today },
  ...['de', 'hu', 'en'].map((locale) => ({ kind: 'LANGUAGE', locale, reviewer: `Prüfer ${locale}`, date: today })),
];

function approved(q: Record<string, unknown>): Record<string, unknown> {
  const translations = Object.fromEntries(
    Object.entries(q.translations as Record<string, object>).map(([k, v]) => [k, { ...v, status: 'APPROVED' }]),
  );
  return { ...q, status: 'APPROVED', reviews: fullReviews, translations };
}

function check(q: Record<string, unknown>, { fixture = false, file }: { fixture?: boolean; file?: string } = {}) {
  const name = file ?? `${String(q.key)}.yaml`;
  return validateQuestionText(stringify(q), { file: name, fixture }).issues;
}

const errors = (q: Record<string, unknown>, opts?: { fixture?: boolean; file?: string }) =>
  check(q, opts).filter((i) => i.severity === 'error').map((i) => i.message);

describe('Fragendatei – gültige Fälle', () => {
  it('Trivia- und Schätzfrage ohne Befund', () => {
    expect(check(trivia())).toEqual([]);
    expect(check(estimate())).toEqual([]);
  });

  it('KI-gestützte Frage ist mit vollständiger dokumentierter Prüfung freigebbar', () => {
    expect(errors(approved(trivia()))).toEqual([]);
  });
});

describe('Fragendatei – Freigaberegeln (Brief §5.6)', () => {
  it('APPROVED ohne Faktenprüfung wird abgelehnt', () => {
    const q = approved(trivia());
    q.reviews = fullReviews.filter((r) => r.kind !== 'FACT');
    expect(errors(q)).toContain('APPROVED ohne dokumentierte Faktenprüfung');
  });

  it('APPROVED mit nicht freigegebener Übersetzung wird abgelehnt', () => {
    const q = approved(trivia());
    (q.translations as Record<string, { status: string }>).hu!.status = 'REVIEWED';
    expect(errors(q)).toContain('APPROVED, aber Übersetzung hu ist nicht freigegeben');
  });

  it('Übersetzungsstatus über DRAFT braucht eine Sprachprüfung', () => {
    const q = trivia();
    (q.translations as Record<string, { status: string }>).de!.status = 'REVIEWED';
    expect(errors(q)).toContain('de: Status REVIEWED ohne dokumentierte Sprachprüfung (reviews, kind LANGUAGE)');
  });

  it('Fixtures werden nie freigegeben und tragen den Tag fixture', () => {
    expect(errors(approved({ ...trivia(), tags: ['fixture'] }), { fixture: true })).toContain(
      'Fixture-Fragen werden nie freigegeben',
    );
    expect(errors(trivia(), { fixture: true })).toContain('Dateien unter fixtures/ brauchen den Tag „fixture“');
    expect(errors({ ...trivia(), tags: ['fixture'] })).toContain('Der Tag „fixture“ ist nur unter fixtures/ erlaubt');
  });

  it('LICENSED braucht einen Lizenzvermerk, sonst keiner', () => {
    expect(errors({ ...trivia(), origin: 'LICENSED' })).toContain('license_note ist genau bei origin LICENSED anzugeben');
    expect(errors({ ...trivia(), license_note: 'CC0' })).toContain('license_note ist genau bei origin LICENSED anzugeben');
    expect(errors({ ...trivia(), origin: 'LICENSED', license_note: 'Vertrag 2026-01' })).toEqual([]);
  });

  it('mindestens eine Quelle über https', () => {
    expect(errors({ ...trivia(), sources: [] }).join()).toMatch(/mindestens eine überprüfbare Quelle/);
    expect(
      errors({ ...trivia(), sources: [{ title: 'x', url: 'http://example.org', accessed: today }] }).join(),
    ).toMatch(/https/);
  });
});

describe('Fragendatei – Trivia', () => {
  it('mindestens 4 Optionen', () => {
    const q = trivia({ trivia: { options: ['a', 'b', 'c'], correct: 'a' } });
    expect(errors(q).join()).toMatch(/trivia\.options/);
  });

  it('richtige Option muss existieren (genau eine richtige)', () => {
    expect(errors(trivia({ trivia: { options: ['a', 'b', 'c', 'd'], correct: 'e' } }))).toContain(
      'richtige Option „e“ fehlt in options',
    );
  });

  it('Optionstexte je Sprache vollständig und eindeutig', () => {
    const q = trivia();
    const tr = q.translations as Record<string, { options: Record<string, string> }>;
    delete tr.en!.options.d;
    tr.de!.options.c = 'au';
    const found = errors(q);
    expect(found).toContain('en: Optionstexte müssen genau die Schlüssel a, b, c, d abdecken');
    expect(found).toContain('de: Optionstexte doppelt');
  });

  it('alle drei Sprachen sind Pflicht', () => {
    const q = trivia();
    delete (q.translations as Record<string, unknown>).hu;
    expect(errors(q).join()).toMatch(/translations/);
  });

  it('Trivia ohne trivia-Abschnitt oder mit estimate-Abschnitt', () => {
    const q = trivia();
    delete q.trivia;
    expect(errors(q)).toContain('Trivia-Frage ohne Abschnitt trivia');
  });
});

describe('Fragendatei – Schätzfragen', () => {
  const est = (e: Record<string, unknown>) =>
    estimate({ estimate: { ...(estimate().estimate as object), ...e } });

  it('answer_value im Eingabebereich und mit passender Präzision', () => {
    expect(errors(est({ answer_value: '20000' }))).toContain('answer_value liegt außerhalb von [input_min, input_max]');
    expect(errors(est({ answer_value: '1642.5' }))).toContain('answer_value hat mehr Nachkommastellen als answer_precision');
    expect(errors(est({ input_min: '5000', input_max: '100' }))).toContain('input_min muss kleiner als input_max sein');
  });

  it('LOG-Skala nur mit positivem Zielwert', () => {
    expect(errors(est({ answer_value: '0' }))).toContain('LOG-Skala verlangt einen positiven answer_value');
  });

  it('keine Jahreszahlen vor Christus', () => {
    expect(
      errors(est({ answer_unit: 'year', input_min: '-500', answer_value: '1849', scale_type: 'LINEAR', scale: 50 })),
    ).toContain('Jahreszahlen vor Christus sind im MVP ausgeschlossen (input_min ≥ 1)');
  });

  it('Dezimalwerte als Zeichenkette, nie als YAML-Zahl', () => {
    expect(errors(est({ answer_value: 9.8 })).join()).toMatch(/answer_value/);
    expect(errors(est({ answer_value: '09.80' })).join()).toMatch(/kanonische/);
  });

  it('Einheit in jeder Sprache, keine Optionen', () => {
    const q = estimate();
    delete (q.translations as Record<string, Record<string, unknown>>).en!.unit_label;
    expect(errors(q)).toContain('en: unit_label fehlt (Einheit steht in der Frage)');
  });
});

describe('Dateiebene', () => {
  it('key muss dem Dateinamen entsprechen', () => {
    expect(errors(trivia(), { file: 'anders.yaml' })).toContain('key „test-frage“ muss dem Dateinamen „anders“ entsprechen');
  });

  it('doppelte YAML-Schlüssel und kaputtes YAML werden gemeldet', () => {
    const text = 'schema_version: 1\nkey: a\nkey: b\n';
    expect(validateQuestionText(text, { file: 'a.yaml', fixture: false }).issues[0]!.message).toMatch(/^YAML/);
  });

  it('unbekannte Felder fallen auf', () => {
    expect(errors({ ...trivia(), difficulty_label: 'leicht' }).join()).toMatch(/difficulty_label|Unrecognized/i);
  });

  describe('Verzeichnis', () => {
    const dirs: string[] = [];
    afterAll(async () => {
      for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    });

    it('meldet doppelte Schlüssel über Bestand und Testdaten hinweg', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'rdw-content-'));
      dirs.push(dir);
      await mkdir(path.join(dir, 'questions', 'science'), { recursive: true });
      await mkdir(path.join(dir, 'fixtures', 'questions'), { recursive: true });
      await writeFile(path.join(dir, 'questions', 'science', 'test-frage.yaml'), stringify(trivia()));
      await writeFile(
        path.join(dir, 'fixtures', 'questions', 'test-frage.yaml'),
        stringify({ ...trivia(), tags: ['fixture'] }),
      );
      const report = await validateContentDir(dir);
      expect(report.questions).toHaveLength(2);
      expect(report.issues.map((i) => i.message).join()).toMatch(/bereits in questions/);
    });

    it('fehlende Verzeichnisse sind kein Fehler', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'rdw-content-empty-'));
      dirs.push(dir);
      expect(await validateContentDir(dir)).toEqual({ questions: [], issues: [] });
    });
  });
});

describe('Fixture-Bestand im Repository', () => {
  it('40 Testfragen (25 Trivia, 15 Schätzung) ohne Fehler, alle Kategorien, alle DRAFT/AI_ASSISTED', async () => {
    const contentDir = path.resolve(import.meta.dirname, '../../../content');
    const { questions, issues } = await validateContentDir(contentDir);
    const fixtures = questions.filter((q) => q.fixture).map((q) => q.question);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(fixtures).toHaveLength(40);
    expect(fixtures.filter((q) => q.kind === 'TRIVIA')).toHaveLength(25);
    expect(fixtures.filter((q) => q.kind === 'ESTIMATE')).toHaveLength(15);
    expect(new Set(fixtures.map((q) => q.category)).size).toBe(11);
    expect(fixtures.every((q) => q.status === 'DRAFT' && q.origin === 'AI_ASSISTED')).toBe(true);
  });
});
