import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../art/Icons.tsx';
import { t } from '../i18n/i18n.ts';
import { ErrorNote } from './ErrorNote.tsx';
import type { NameChoice } from './NamePicker.tsx';

/**
 * Namenswahl der Kontoseite (O-10, ADR-044, ADR-080): Vorschläge des Servers als Namensschilder
 * zum Antippen, dazu „Andere Vorschläge“. Wie `NamePicker` nie frei getippt; ohne Wahl ist der
 * erste Vorschlag gewählt, eine Wahl bleibt nach neuen Vorschlägen vorn in der Liste. `current`
 * ist der bisherige Name: Er steht als erstes Schild da und ist anfangs gewählt. `load` muss
 * stabil sein (Modulfunktion oder `useCallback`).
 */
export function NameChips<T>({
  legend,
  load,
  value,
  current = null,
  onChange,
  testId,
}: {
  readonly legend: string;
  readonly load: () => Promise<readonly NameChoice<T>[]>;
  readonly value: NameChoice<T> | null;
  readonly current?: NameChoice<T> | null;
  readonly onChange: (choice: NameChoice<T>) => void;
  readonly testId?: string;
}) {
  const [choices, setChoices] = useState<readonly NameChoice<T>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Jede neue Ladung bekommt eine Nummer: Die Schilder erscheinen dann neu gestempelt
  const [batch, setBatch] = useState(0);
  const group = useId();
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
        setBatch((n) => n + 1);
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

  // Bisheriger und gewählter Name bleiben vorn, auch wenn die Vorschläge wechseln
  const list: NameChoice<T>[] = [];
  for (const choice of [current, value, ...(choices ?? [])]) {
    if (choice && !list.some((c) => c.name === choice.name)) list.push(choice);
  }

  return (
    <fieldset className="name-chips" data-testid={testId} aria-busy={loading}>
      <legend className="visually-hidden">{legend}</legend>
      <div className="name-chip-grid">
        {choices === null && loading ? <p className="menu-note">{t('names.loading')}</p> : null}
        {list.map((choice, i) => {
          const on = value?.name === choice.name;
          const old = current?.name === choice.name;
          return (
            <label
              key={`${choice.name}-${old ? 'old' : batch}`}
              className={`name-chip${on ? ' on' : ''}${old ? ' old' : ''}`}
              style={{ ['--i' as string]: i }}
            >
              <input
                type="radio"
                className="menu-pick"
                name={group}
                checked={on}
                onChange={() => onChange(choice)}
              />
              <span className="name-chip-text">{choice.name}</span>
              {old ? <span className="name-chip-tag">{t('konto.names.current')}</span> : null}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className="name-chips-more"
        disabled={loading}
        onClick={() => void refresh()}
      >
        <Icon kind="dice" size={18} />
        <span>{t('names.more')}</span>
      </button>
      {error ? <ErrorNote error={error} /> : null}
    </fieldset>
  );
}
