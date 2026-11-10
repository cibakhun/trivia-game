import type { SiegeSummary, SiegesResponse } from '@rdw/protocol';
import { formatTime, t, tDynamic } from '../i18n/i18n.ts';
import { biomeName } from '../map/palette.ts';
import { navigate } from '../router.ts';

/**
 * Belagerungsübersicht in der Seitenleiste (SIEGE_SYSTEM §9): eingehende Belagerungen mit Frist
 * und „Verteidigen“, eigene offene Angriffe und die zuletzt entschiedenen Kämpfe. Die Verteidigung
 * beginnt erst im Quiz, damit die Wissensfrage direkt mit dem Beginn erscheint.
 */
export function SiegePanel({
  sieges,
  onSelectRegion,
}: {
  readonly sieges: SiegesResponse;
  readonly onSelectRegion: (regionId: string) => void;
}) {
  const { incoming, outgoing, recent } = sieges;
  const openChallenge = (siege: SiegeSummary) =>
    navigate({ name: 'challenge', challengeId: siege.challengeId });
  return (
    <section
      className={incoming.length > 0 ? 'card card-accent' : 'card'}
      aria-labelledby="sieges-title"
      data-testid="siege-panel"
    >
      <h2 id="sieges-title">{t('sieges.title')}</h2>
      {incoming.length === 0 && outgoing.length === 0 ? (
        <p className="muted">{t('sieges.none')}</p>
      ) : null}

      {incoming.length > 0 ? (
        <>
          <h3>{t('sieges.incoming')}</h3>
          <ul className="sieges" data-testid="sieges-incoming">
            {incoming.map((siege) => (
              <li key={siege.siegeId}>
                <button
                  type="button"
                  className="link"
                  onClick={() => onSelectRegion(siege.regionId)}
                >
                  {t('sieges.incomingItem', {
                    attacker: siege.attacker.name,
                    region: regionLabel(siege),
                  })}
                </button>
                {siege.deadlineAt ? (
                  <p className="muted">
                    {t('sieges.deadline', { time: formatTime(siege.deadlineAt) })}
                  </p>
                ) : null}
                {siege.status === 'DEFENDING' ? (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => openChallenge(siege)}
                  >
                    {t('sieges.defending')}
                  </button>
                ) : siege.canDefend ? (
                  <button
                    type="button"
                    className="button button-primary"
                    data-testid="defend"
                    onClick={() => openChallenge(siege)}
                  >
                    {t('sieges.defend')}
                  </button>
                ) : siege.defendBlockedBy ? (
                  <p className="note">{t(`sieges.blocked.${siege.defendBlockedBy}`)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {outgoing.length > 0 ? (
        <>
          <h3>{t('sieges.outgoing')}</h3>
          <ul className="sieges" data-testid="sieges-outgoing">
            {outgoing.map((siege) => (
              <li key={siege.siegeId}>
                <button type="button" className="link" onClick={() => openChallenge(siege)}>
                  {t('sieges.outgoingItem', {
                    region: regionLabel(siege),
                    defender: siege.defender?.name ?? t('kingdom.garrison'),
                  })}
                </button>
                <p className="muted">
                  {siege.status === 'PREPARING'
                    ? t('sieges.preparing')
                    : siege.status === 'DEFENDING'
                      ? t('quiz.openedDefending', { name: siege.defender?.name ?? '' })
                      : siege.deadlineAt
                        ? t('sieges.deadline', { time: formatTime(siege.deadlineAt) })
                        : null}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {recent.length > 0 ? (
        <>
          <h3>{t('sieges.recent')}</h3>
          <ul className="sieges" data-testid="sieges-recent">
            {recent.map((siege) => (
              <li key={siege.siegeId}>
                <button type="button" className="link" onClick={() => openChallenge(siege)}>
                  {t('sieges.recentItem', {
                    region: regionLabel(siege),
                    outcome: tDynamic(`sieges.outcome.${outcomeOf(siege)}`, 'errors.generic'),
                  })}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function regionLabel(siege: SiegeSummary): string {
  const biome = biomeName(siege.region.biome);
  const label = biome
    ? t('region.label', { biome: t(`biome.${biome}`), tier: siege.region.tier })
    : t('region.title', { id: siege.regionId });
  return siege.region.isCapital ? `${label} (${t('sieges.capital')})` : label;
}

/** Ergebnis aus Sicht des Spielers. */
function outcomeOf(siege: SiegeSummary): 'won' | 'lost' | 'none' {
  if (siege.winner === null || siege.winner === 'NONE') return 'none';
  return (siege.winner === 'ATTACKER') === (siege.role === 'ATTACKER') ? 'won' : 'lost';
}
