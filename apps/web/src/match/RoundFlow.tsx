import { t } from '../i18n/i18n.ts';
import type { RoundFlowView } from './realm-model.ts';
import { useBorn } from './stage-live.ts';

/**
 * Ablauf unter dem Band links: die drei Abschnitte, zwischen denen die Partie gerade läuft, der
 * laufende hervorgehoben. So steht immer da, was jetzt geschieht und was danach kommt. Die Zeile ist
 * immer gleich hoch und verschiebt nichts: Der goldene Strich läuft von einem Abschnitt zum
 * nächsten (realm.css). Wechseln die drei Abschnitte selbst (Eröffnung, Feldzug), gibt die Bühne
 * der Zeile einen neuen Schlüssel, und sie schreibt sich neu ein.
 */
export function RoundFlow({ flow }: { readonly flow: RoundFlowView }) {
  const born = useBorn();
  return (
    <ol
      className={born ? 'flow arriving' : 'flow'}
      data-testid="match-flow"
      aria-label={t('realm.flow.label')}
    >
      {flow.steps.map((step, index) => (
        <li
          key={step}
          className={index === flow.now ? 'now' : index < flow.now ? 'done' : undefined}
          aria-current={index === flow.now ? 'step' : undefined}
        >
          <span>{t(`realm.flow.${step}`)}</span>
        </li>
      ))}
    </ol>
  );
}
