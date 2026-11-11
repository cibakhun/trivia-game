import { useEffect, useRef } from 'react';
import { t } from '../i18n/i18n.ts';
import {
  ESTIMATE_KEYS,
  estimateKeyOf,
  estimateToSend,
  pressEstimateKey,
  type EstimateKey,
} from './estimate-input.ts';

/**
 * Ziffernfeld für die Schätzfrage im Blatt der Partie (ADR-059): zwölf große Tasten und „Antwort
 * abgeben“. Die Zahl selbst steht in der Fragekarte auf der Karte. Mit einer echten Tastatur gehen
 * Ziffern, Komma, Rücktaste und Enter genauso.
 */
export function NumPad({
  value,
  precision,
  busy,
  onChange,
  onSubmit,
}: {
  readonly value: string;
  /** Gewertete Nachkommastellen; bei 0 ist das Komma aus. */
  readonly precision: number;
  readonly busy: boolean;
  /** Nimmt die Änderung als Funktion: So geht keine Ziffer verloren, wenn schnell getippt wird. */
  readonly onChange: (update: (current: string) => string) => void;
  readonly onSubmit: () => void;
}) {
  const ready = estimateToSend(value) !== null;
  const press = (key: EstimateKey) =>
    onChange((current) => pressEstimateKey(current, key, precision));
  // Der Tastaturhörer liest immer den jüngsten Stand, ohne bei jeder Ziffer neu angemeldet zu werden
  const live = useRef({ busy, ready, press, onSubmit });
  useEffect(() => {
    live.current = { busy, ready, press, onSubmit };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      if (now.busy || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter') {
        if (!now.ready) return;
        // Sonst löste Enter zusätzlich die Taste aus, auf der gerade der Fokus liegt
        event.preventDefault();
        now.onSubmit();
        return;
      }
      const key = estimateKeyOf(event.key);
      if (key === null) return;
      event.preventDefault();
      now.press(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const label = (key: EstimateKey) =>
    key === ','
      ? t('match.stage.numpad.comma')
      : key === 'back'
        ? t('match.stage.numpad.back')
        : key;

  return (
    <div className="numpad-box">
      <div className="numpad" role="group" aria-label={t('match.stage.numpad.label')}>
        {ESTIMATE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="button numkey"
            aria-label={label(key)}
            disabled={busy || (key === ',' && precision === 0)}
            onClick={() => press(key)}
          >
            {key === 'back' ? (
              <svg viewBox="0 0 28 20" aria-hidden="true" focusable="false">
                <path d="M9 2H25V18H9L2 10Z" className="numkey-back" />
                <path d="M13 6.5L20 13.5M20 6.5L13 13.5" className="numkey-cross" />
              </svg>
            ) : (
              key
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button button-primary blatt-go"
        disabled={busy || !ready}
        onClick={onSubmit}
      >
        {busy ? t('quiz.sending') : t('quiz.submit')}
      </button>
    </div>
  );
}
