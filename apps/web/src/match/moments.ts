import type { MatchView, ParsedMatchEvent } from '@rdw/protocol';
import { t } from '../i18n/i18n.ts';
import type { MatchScreenState } from './match-model.ts';
import type { SeatName } from './match-text.ts';

/**
 * Große Momente der Partie als Band über der Karte (docs/ART_DIRECTION.md §5): ein Reich fällt,
 * eine Phase beginnt, eine neue Feldzugrunde, du bist dran. Reine Darstellung aus dem Vergleich
 * zweier Stände; nie während einer laufenden Frage (der Bildschirm blendet sie dann aus).
 */

export interface Moment {
  /** Eindeutig je Anlass, damit dasselbe Band nicht zweimal erscheint. */
  readonly key: string;
  readonly title: string;
  readonly detail: string | null;
  /** Farbe des Bands: Gold, Tinte oder Sitzfarbe (mit Wappen). */
  readonly tone: 'gold' | 'ink' | 'seat';
  readonly seat: number | null;
}

export interface MomentSnapshot {
  readonly state: MatchScreenState;
  readonly kind: MatchStepKind | null;
  readonly round: number | null;
  /** Höchste bereits verarbeitete Ereignisnummer. */
  readonly lastSeq: number;
}

type MatchStepKind = NonNullable<MatchView['board']>['step']['kind'];

const CAMPAIGN: readonly (MatchStepKind | null)[] = [
  'CAMPAIGN_TARGET',
  'DUEL_TRIVIA',
  'DUEL_ESTIMATE',
];
const LAND: readonly (MatchStepKind | null)[] = ['LAND_ESTIMATE', 'LAND_PICK'];

/** Ruhige Zustände, in denen eine Phase oder Runde angekündigt wird: Wahl oder Ansage. */
export function isCalm(state: MatchScreenState): boolean {
  return state === 'pick' || state === 'waiting-pick' || state === 'announce';
}

/**
 * Momente zwischen zwei Ständen, in der Reihenfolge, in der sie gezeigt werden. `before = null`
 * ist der erste Aufbau der Seite: Dann zählt nur „Du bist dran“, Vergangenes wird nicht gefeiert.
 */
export function momentsBetween(
  before: MomentSnapshot | null,
  next: MomentSnapshot,
  fresh: readonly ParsedMatchEvent[],
  name: SeatName,
  campaignRounds: number,
): Moment[] {
  const moments: Moment[] = [];
  if (before) {
    for (const event of fresh) {
      if (event.type !== 'KINGDOM_ELIMINATED') continue;
      moments.push({
        key: `fallen-${event.seq}`,
        title: t('match.moment.fallen'),
        detail: t('match.moment.fallenDetail', {
          name: name(event.payload.seat),
          by: name(event.payload.by),
        }),
        tone: 'seat',
        seat: event.payload.by,
      });
    }
    // Phasen und Runden erst ankündigen, wenn gewählt wird (nicht mitten in einer Auflösung)
    const calm = isCalm(next.state) && next.kind !== 'FINISHED';
    if (calm && LAND.includes(next.kind) && !LAND.includes(before.kind)) {
      moments.push({
        key: `land-${next.round ?? 1}`,
        title: t('match.moment.land'),
        detail: t('match.moment.landDetail'),
        tone: 'ink',
        seat: null,
      });
    } else if (calm && CAMPAIGN.includes(next.kind)) {
      const round = next.round ?? 1;
      if (!CAMPAIGN.includes(before.kind)) {
        moments.push({
          key: `campaign-${round}`,
          title: t('match.moment.campaign'),
          detail: t('match.step.CAMPAIGN', { round, rounds: campaignRounds }),
          tone: 'ink',
          seat: null,
        });
      } else if (before.round !== null && round > before.round) {
        moments.push({
          key: `campaign-${round}`,
          title: t('match.moment.round', { round, rounds: campaignRounds }),
          detail: round === campaignRounds ? t('match.moment.lastRound') : null,
          tone: 'ink',
          seat: null,
        });
      }
    }
  }
  const myTurnStarts =
    next.state === 'pick' &&
    (before === null || before.state !== 'pick' || before.lastSeq !== next.lastSeq);
  if (myTurnStarts) {
    moments.push({
      key: `turn-${next.lastSeq}`,
      title: t('match.pick.banner'),
      detail: null,
      tone: 'gold',
      seat: null,
    });
  }
  return moments;
}
