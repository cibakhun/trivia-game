import type { KingdomSummary } from '@rdw/protocol';
import { formatTime, t, tp } from '../i18n/i18n.ts';
import { cssColor, kingdomColor } from '../map/palette.ts';

/** Reichsanzeige: Farbe, Rang und Name (GAME_RULES §3.7–3.8), Regionenzahl, Anfängerschutz (§7). */
export function KingdomBar({ kingdom }: { readonly kingdom: KingdomSummary }) {
  return (
    <header className="kingdom-bar" aria-label={t('kingdom.yours')}>
      <span
        className="swatch"
        style={{ background: cssColor(kingdomColor(kingdom.color)) }}
        aria-hidden="true"
      />
      <div className="kingdom-name">
        <span className="rank" data-testid="kingdom-rank">
          {kingdom.rank ? t(`rank.${kingdom.rank}`) : t('kingdom.noRegions')}
        </span>{' '}
        <strong>{kingdom.name}</strong>
      </div>
      <div className="kingdom-regions" data-testid="kingdom-regions">
        {tp('kingdom.regions', kingdom.regionCount)}
      </div>
      {kingdom.protectedUntil && kingdom.protectionReason === 'NEWBIE' ? (
        <div className="muted">
          {t('kingdom.newbieProtection', { time: formatTime(kingdom.protectedUntil) })}
        </div>
      ) : null}
    </header>
  );
}
