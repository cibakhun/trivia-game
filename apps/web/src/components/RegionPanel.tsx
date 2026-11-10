import type { AttackResponse, RegionDetailResponse } from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, newActionKey } from '../api/client.ts';
import { errorMessage, formatTime, t } from '../i18n/i18n.ts';
import { biomeName } from '../map/palette.ts';
import { ErrorNote } from './ErrorNote.tsx';

/** Regionsdetails mit Angriffsberechtigung aus dem Server (API.md §2.2). */
export function RegionPanel({
  instanceId,
  regionId,
  ownKingdomId,
  onClose,
  onAttack,
}: {
  readonly instanceId: string;
  readonly regionId: string;
  readonly ownKingdomId: string | null;
  readonly onClose: () => void;
  /** `label` ist der lesbare Regionsname für das Quiz (Biom und Stufe). */
  readonly onAttack: (attack: AttackResponse, label: string) => void;
}) {
  const [detail, setDetail] = useState<RegionDetailResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Ein Angriff = ein Schlüssel, auch wenn der Spieler nach einem Netzfehler erneut klickt
  const attackKey = useRef(newActionKey());

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.region(instanceId, regionId));
    } catch (e) {
      setError(e);
    }
  }, [instanceId, regionId]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  async function attack() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.attack(instanceId, regionId, attackKey.current);
      attackKey.current = newActionKey();
      onAttack(result, title);
    } catch (e) {
      // erst neu laden (setzt den Fehler zurück), dann den Fehler des Angriffs zeigen
      await load();
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const region = detail?.region;
  const biome = region ? biomeName(region.biome) : null;
  const ownerText = detail?.owner
    ? detail.owner.id === ownKingdomId
      ? t('kingdom.yours')
      : detail.owner.name
    : t('kingdom.garrison');

  const title =
    biome && region
      ? t('region.label', { biome: t(`biome.${biome}`), tier: region.tier })
      : t('region.title', { id: regionId });

  return (
    <section className="panel" aria-labelledby="region-title" data-testid="region-panel">
      <div className="panel-head">
        <h2 id="region-title">{title}</h2>
        <button type="button" className="button button-quiet" onClick={onClose}>
          {t('region.close')}
        </button>
      </div>
      {!detail && !error ? <p>{t('app.loading')}</p> : null}
      {region && detail ? (
        <>
          <dl className="facts">
            <dt>{t('region.owner')}</dt>
            <dd>{ownerText}</dd>
            <dt>{t('region.tierLabel')}</dt>
            <dd>{region.tier}</dd>
          </dl>
          {region.isCapital ? <p className="badge">{t('region.capital')}</p> : null}
          {detail.capital ? (
            <div className="capital-lives" data-testid="capital-lives">
              <p>
                <span className="hearts" aria-hidden="true">
                  {'♥'.repeat(detail.capital.lives)}
                  {'♡'.repeat(Math.max(0, detail.capital.maxLives - detail.capital.lives))}
                </span>{' '}
                {t('region.capitalLives', {
                  lives: detail.capital.lives,
                  max: detail.capital.maxLives,
                })}
              </p>
              {detail.capital.nextLifeAt ? (
                <p className="muted">
                  {t('region.capitalNextLife', { time: formatTime(detail.capital.nextLifeAt) })}
                </p>
              ) : null}
              {detail.owner?.id !== ownKingdomId ? (
                <p className="muted">{t('region.capitalRule')}</p>
              ) : null}
            </div>
          ) : null}
          {region.underSiege ? <p className="badge badge-siege">{t('region.underSiege')}</p> : null}
          {region.protectedUntil ? (
            <p className="badge">
              {t('region.protectedUntil', { time: formatTime(region.protectedUntil) })}
            </p>
          ) : null}
          {detail.attack.allowed ? (
            <>
              {detail.attack.mode === 'PVP' ? <p className="muted">{t('region.pvpHint')}</p> : null}
              {detail.attack.endsOwnProtection ? (
                <p className="note" data-testid="ends-protection">
                  {t('region.endsOwnProtection')}
                </p>
              ) : null}
              <button
                type="button"
                className="button button-primary button-wide"
                disabled={busy}
                onClick={() => void attack()}
              >
                {busy
                  ? t('region.attacking')
                  : detail.attack.mode === 'PVP'
                    ? t('region.attackPlayer')
                    : t('region.attack')}
              </button>
            </>
          ) : detail.attack.reason ? (
            <p className="muted" data-testid="attack-reason">
              {errorMessage(
                detail.attack.reason,
                detail.attack.until ? { until: detail.attack.until } : {},
              )}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? <ErrorNote error={error} /> : null}
    </section>
  );
}
