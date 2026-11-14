import type { ParsedMatchEvent } from '@rdw/protocol';
import { t, tp } from '../i18n/i18n.ts';
import type { AnyStep, MatchScreenState } from './match-model.ts';
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

type MatchStepKind = AnyStep['kind'];

const CAMPAIGN: readonly (MatchStepKind | null)[] = [
  'CAMPAIGN_TARGET',
  'DUEL_TRIVIA',
  'DUEL_ESTIMATE',
];
const LAND: readonly (MatchStepKind | null)[] = ['LAND_ESTIMATE', 'LAND_PICK'];

/**
 * Ruhige Zustände, in denen eine Phase oder Runde angekündigt wird: Wahl oder Ansage, mit Ausbau
 * auch Rüstzeit und Aufdecken.
 */
export function isCalm(state: MatchScreenState): boolean {
  return (
    state === 'pick' ||
    state === 'waiting-pick' ||
    state === 'announce' ||
    state === 'prepare' ||
    state === 'prepared' ||
    state === 'watching-prepare' ||
    state === 'orders'
  );
}

/**
 * Zustände, in denen ein ausgefallener Angriff (ADR-064) sein Band bekommt: die ruhigen und das
 * Ende der Partie. Kostet das letzte Duell dem Letzten der Runde sein Ziel, folgt kein ruhiger
 * Zustand mehr; ohne das Band über der Abrechnung erführe er nicht, warum er nicht mehr dran war.
 */
export function showsSkips(state: MatchScreenState): boolean {
  return isCalm(state) || state === 'finished';
}

/**
 * Ausgefallene Angriffe, die während einer Auflösung kamen, warten auf den nächsten Zustand, der
 * ihr Band zeigen darf (`showsSkips`); dort kommen sie vor dem, was gerade eintraf. Beginnt vorher
 * eine Frage, verfallen sie wie die Bänder in der Warteschlange (`pruneMoments`): Sonst stünde ihr
 * Band ein Duell später über dem Angriff eines anderen. Das gilt auch für eine Frage, der dieser
 * Sitz nur zuschaut; für ihn hat das nächste Duell genauso begonnen.
 */
export function holdSkips(
  held: readonly ParsedMatchEvent[],
  arrived: readonly ParsedMatchEvent[],
  state: MatchScreenState,
): { readonly fresh: readonly ParsedMatchEvent[]; readonly held: readonly ParsedMatchEvent[] } {
  if (showsSkips(state)) return { fresh: [...held, ...arrived], held: [] };
  if (state === 'question' || state === 'spectating') return { fresh: arrived, held: [] };
  const skips = arrived.filter((event) => event.type === 'ATTACK_SKIPPED');
  return { fresh: arrived, held: skips.length === 0 ? held : [...held, ...skips] };
}

/** „Du bist dran“ gilt nur, solange die eigene Wahl offen ist. */
function isTurn(moment: Moment): boolean {
  return moment.key.startsWith('turn-');
}

/** Ein gefallenes Reich wird nach einer Frage nachgeholt; alles andere ist dann überholt. */
function isFallen(moment: Moment): boolean {
  return moment.key.startsWith('fallen-');
}

/** So lange steht ein Band vom Entrollen bis es wieder eingerollt ist. */
export const MOMENT_MS = 1500;
/** „Ein Reich fällt!“ hat mehr Gewicht: Es steht länger. */
export const GRAND_MOMENT_MS = 2200;
/**
 * Fällt ein Reich in einer Auflösung, die die Seite miterlebt, wartet das Band, bis der Schlag
 * sitzt und die Burg eingestürzt ist (docs/ART_DIRECTION.md §5: Einschlag bei 0,35 s, Einsturz
 * danach): Es sagt, was geschehen ist, und nimmt es nicht vorweg.
 */
export const FALLEN_LEAD_MS = 900;

/** Gewicht eines Bands: Ein gefallenes Reich ist größer als eine Ankündigung. */
export function momentWeight(moment: Moment): 'grand' | 'plain' {
  return isFallen(moment) ? 'grand' : 'plain';
}

export interface MomentTiming {
  /** Wartezeit, bevor sich das Band entrollt. */
  readonly leadMs: number;
  /** Vom Entrollen bis es wieder eingerollt ist. */
  readonly showMs: number;
}

/**
 * Zeiten eines Bands. `born` ist der Zustand, in dem sein Anlass eintraf: Nur ein Reich, das eben
 * in der Auflösung fällt, wartet auf den Einsturz; nach einer Frage nachgeholt, kommt es sofort.
 */
export function momentTiming(moment: Moment, born: MatchScreenState): MomentTiming {
  const grand = momentWeight(moment) === 'grand';
  return {
    leadMs: grand && born === 'reveal' ? FALLEN_LEAD_MS : 0,
    showMs: grand ? GRAND_MOMENT_MS : MOMENT_MS,
  };
}

/**
 * Warteschlange nach einem Zustandswechsel: Während einer Frage bleibt nur ein gefallenes Reich,
 * es wird danach nachgeholt. Ein ausgefallener Angriff verfällt dann wie jede Ankündigung, ob sein
 * Band die Farbe des Reichs trägt oder mehrere nennt: Nach der Frage stünde es über der Auflösung
 * eines anderen Angriffs. „Du bist dran“ verfällt, sobald die eigene Wahl vorbei ist, sonst
 * stünde es über der Ansage dessen, der als Nächster wählt. Verfällt nichts, bleibt es dieselbe
 * Liste, damit das laufende Band nicht neu startet.
 */
export function pruneMoments(queue: readonly Moment[], state: MatchScreenState): readonly Moment[] {
  const keep = (moment: Moment) =>
    state === 'question' ? isFallen(moment) : state === 'pick' || !isTurn(moment);
  return queue.every(keep) ? queue : queue.filter(keep);
}

/**
 * Hängt neue Momente an. Wählt derselbe Sitz gleich noch einmal, während „Du bist dran“ noch
 * steht oder wartet, kommt kein zweites dahinter.
 */
export function enqueueMoments(
  queue: readonly Moment[],
  moments: readonly Moment[],
): readonly Moment[] {
  const waiting = queue.some(isTurn);
  const added = moments.filter((moment) => !(waiting && isTurn(moment)));
  return added.length === 0 ? queue : [...queue, ...added];
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
  /** Partie mit Ausbau: Jede Runde beginnt mit der Rüstzeit, sie kündigt die Runde an. */
  realm = false,
  /** Runden der Landnahme, wenn sie begrenzt ist (ADR-062): Danach bleibt Land frei. */
  landRounds: number | null = null,
  /** Eigener Sitz: Fällt der eigene Angriff aus, sagt das Band es in der Du-Form. */
  mySeat: number | null = null,
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
    // Ausgefallene Angriffe (ADR-064) erst in einem ruhigen Zustand oder am Ende der Partie, nicht
    // über einer Auflösung; beim Aufdecken hinter dessen Ankündigung, sonst vor der nächsten
    // Runde. Fallen mehrere zugleich aus, nennt ein einziges Band alle: Sonst stünden Bänder bis
    // in die Rüstzeit
    const skips = showsSkips(next.state)
      ? fresh.filter((event) => event.type === 'ATTACK_SKIPPED')
      : [];
    const [only] = skips;
    const skipped: Moment[] =
      only === undefined
        ? []
        : skips.length === 1
          ? [
              {
                key: `skipped-${only.seq}`,
                title:
                  only.payload.attacker === mySeat
                    ? t('realm.moment.skippedMe')
                    : t('realm.moment.skipped', { name: name(only.payload.attacker) }),
                detail: t('realm.moment.skippedDetail'),
                tone: 'seat',
                seat: only.payload.attacker,
              },
            ]
          : [
              {
                key: `skipped-${only.seq}`,
                title: t('realm.moment.skippedMany'),
                detail: t('realm.moment.skippedManyDetail', {
                  names: skips
                    .map((event) =>
                      event.payload.attacker === mySeat
                        ? t('match.youShort')
                        : name(event.payload.attacker),
                    )
                    .join(', '),
                }),
                tone: 'ink',
                seat: null,
              },
            ];
    if (next.state !== 'orders') moments.push(...skipped);
    // Phasen und Runden erst ankündigen, wenn gewählt wird (nicht mitten in einer Auflösung)
    const calm = isCalm(next.state) && next.kind !== 'FINISHED';
    if (calm && LAND.includes(next.kind) && !LAND.includes(before.kind)) {
      moments.push({
        key: `land-${next.round ?? 1}`,
        title: t('match.moment.land'),
        detail:
          landRounds === null
            ? t('match.moment.landDetail')
            : tp('realm.moment.landDetail', landRounds),
        tone: 'ink',
        seat: null,
      });
    } else if (calm && realm) {
      moments.push(...realmMoments(before, next, campaignRounds));
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
    if (next.state === 'orders') moments.push(...skipped);
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

/** Ankündigungen der Partie mit Ausbau: Burgen, Startdörfer, Rüstzeit jeder Runde, Aufdecken. */
function realmMoments(
  before: MomentSnapshot,
  next: MomentSnapshot,
  campaignRounds: number,
): Moment[] {
  const ink = (key: string, title: string, detail: string | null = null): Moment => ({
    key,
    title,
    detail,
    tone: 'ink',
    seat: null,
  });
  const round = next.round ?? 1;
  if (next.state === 'orders') {
    return before.state === 'orders' ? [] : [ink(`orders-${round}`, t('realm.moment.orders'))];
  }
  if (next.kind === before.kind && next.round === before.round) return [];
  if (next.kind === 'CASTLE_PICK') return [ink('castles', t('realm.moment.castles'))];
  if (next.kind === 'VILLAGE_PICK') return [ink('villages', t('realm.moment.villages'))];
  if (next.kind === 'PREPARE') {
    return [
      ink(
        `prepare-${round}`,
        t('realm.moment.prepare'),
        round === campaignRounds
          ? t('match.moment.lastRound')
          : t('realm.step.ROUND', { round, rounds: campaignRounds }),
      ),
    ];
  }
  return [];
}
