import { t } from '../i18n/i18n.ts';
import type { RoundFlowView } from './realm-model.ts';

/**
 * Ablauf unter dem Band links: die drei Abschnitte, zwischen denen die Partie gerade läuft, der
 * laufende hervorgehoben. So steht immer da, was jetzt geschieht und was danach kommt. Die Zeile ist
 * immer gleich hoch und bewegt sich nicht.
 */
export function RoundFlow({ flow }: { readonly flow: RoundFlowView }) {
  return (
    <ol className="flow" data-testid="match-flow" aria-label={t('realm.flow.label')}>
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
