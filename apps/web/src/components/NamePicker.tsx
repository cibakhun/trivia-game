import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { ErrorNote } from './ErrorNote.tsx';

/** Ein wählbarer Name: Bausteine für den Server und der fertige Anzeigename. */
export interface NameChoice<T> {
  readonly parts: T;
  readonly name: string;
}

/**
 * Namenswahl aus Vorschlägen des Servers (O-10, ADR-044): Spieler- und Reichsnamen sind nie frei
 * getippt. Ohne Wahl wird der erste Vorschlag vorgewählt; eine Wahl bleibt auch nach „Andere
 * Vorschläge“ in der Liste. `load` muss stabil sein (Modulfunktion oder `useCallback`).
 */
export function NamePicker<T>({
  legend,
  hint,
  load,
  value,
  onChange,
  testId,
}: {
  readonly legend: string;
  readonly hint?: string;
  readonly load: () => Promise<readonly NameChoice<T>[]>;
  readonly value: NameChoice<T> | null;
  readonly onChange: (choice: NameChoice<T>) => void;
  readonly testId?: string;
}) {
  const [choices, setChoices] = useState<readonly NameChoice<T>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const group = useId();
  // Aktuelle Werte für das Nachladen, ohne es bei jeder Wahl neu anzustoßen
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  const refresh = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setError(null);
      try {
        const next = await load();
        if (isCancelled()) return;
        setChoices(next);
        const first = next[0];
        if (!latest.current.value && first) latest.current.onChange(first);
      } catch (e) {
        if (!isCancelled()) setError(e);
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    let cancelled = false;
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const list =
    value && !choices?.some((choice) => choice.name === value.name)
      ? [value, ...(choices ?? [])]
      : (choices ?? []);

  return (
    <fieldset className="name-picker" data-testid={testId}>
      <legend>{legend}</legend>
      {hint ? <p className="muted">{hint}</p> : null}
      {choices === null && loading ? <p className="muted">{t('names.loading')}</p> : null}
      <div className="name-choices">
        {list.map((choice) => (
          <label key={choice.name} className="name-choice">
            <input
              type="radio"
              name={group}
              checked={value?.name === choice.name}
              onChange={() => onChange(choice)}
            />
            <span>{choice.name}</span>
          </label>
        ))}
      </div>
      <button type="button" className="link" disabled={loading} onClick={() => void refresh()}>
        {t('names.more')}
      </button>
      {error ? <ErrorNote error={error} /> : null}
    </fieldset>
  );
}
