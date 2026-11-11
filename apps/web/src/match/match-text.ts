import {
  MATCH_MAP_IDS,
  type MatchMapId,
  type MatchView,
  type ParsedMatchEvent,
} from '@rdw/protocol';
import { matchMap, type MatchMap } from '@rdw/game-core';
import { t, tp } from '../i18n/i18n.ts';
import { rulesOf, type RevealOutcome } from './match-model.ts';

/**
 * Texte der Partie aus Ansicht und Ereignissen: Namen der Sitze und Regionen, Abschnitt,
 * Aufforderung zur Wahl, Verlauf. Alles über Schlüssel aus `de.ts` (ADR-036).
 */

export type SeatName = (seat: number) => string;
export type RegionName = (region: number) => string;

function isMapId(id: string): id is MatchMapId {
  return (MATCH_MAP_IDS as readonly string[]).includes(id);
}

/**
 * Karte der Partie, mit Ausbau aus `realm.board`; unbekannte Kennungen fallen auf die Wendelmark
 * zurück.
 */
export function mapOfView(view: MatchView): MatchMap {
  const id = view.board?.map ?? view.realm?.board?.map ?? 'WENDELMARK';
  return matchMap(isMapId(id) ? id : 'WENDELMARK');
}

/** Anzeigename eines Sitzes; der eigene mit „(du)“. */
export function seatNames(view: MatchView): SeatName {
  return (seat) => {
    const player = view.players.find((p) => p.seat === seat);
    if (!player) return `#${seat + 1}`;
    return player.isMe ? t('match.you', { name: player.name }) : player.name;
  };
}

export function regionNames(map: MatchMap): RegionName {
  return (region) => map.regions[region]?.name ?? `#${region}`;
}

/** Abschnitt der Partie für die Kopfzeile, `null` vor dem Start. */
export function stepLabel(view: MatchView): string | null {
  const step = view.board?.step;
  if (!step) return null;
  switch (step.kind) {
    case 'CAPITAL_PICK':
      return t('match.step.CAPITAL_PICK');
    case 'LAND_ESTIMATE':
    case 'LAND_PICK':
      return t('match.step.LAND', { round: step.round ?? 1 });
    case 'CAMPAIGN_TARGET':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
      return t('match.step.CAMPAIGN', {
        round: step.round ?? 1,
        rounds: rulesOf(view.match.rulesPreset).campaign.rounds,
      });
    case 'FINISHED':
      // Solange die letzte Auflösung steht (ADR-055), bleibt die Runde im Band: Die Abrechnung
      // kommt erst danach
      return view.match.status === 'RUNNING' && step.round !== null
        ? t('match.step.CAMPAIGN', {
            round: step.round,
            rounds: rulesOf(view.match.rulesPreset).campaign.rounds,
          })
        : t('match.step.FINISHED');
  }
}

/** Aufforderung oder Wartehinweis in Phase `PICK`. */
export function pickText(view: MatchView, name: SeatName): string | null {
  const step = view.board?.step;
  if (!step || step.chooser === null) return null;
  const mine = view.legalRegions.length > 0;
  const chooser = name(step.chooser);
  switch (step.kind) {
    case 'CAPITAL_PICK':
      return mine ? t('match.pick.capital') : t('match.pick.waitingCapital', { name: chooser });
    case 'LAND_PICK':
      return mine ? t('match.pick.land') : t('match.pick.waitingLand', { name: chooser });
    case 'CAMPAIGN_TARGET':
      return mine ? t('match.pick.target') : t('match.pick.waitingTarget', { name: chooser });
    case 'LAND_ESTIMATE':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      return null;
  }
}

/** Wofür die laufende Frage zählt. */
export function questionContext(
  view: MatchView,
  name: SeatName,
  region: RegionName,
): string | null {
  const step = view.board?.step;
  if (!step) return null;
  switch (step.kind) {
    case 'LAND_ESTIMATE':
      return t('match.question.land', { round: step.round ?? 1 });
    case 'DUEL_TRIVIA':
      return step.attacker !== null && step.defender !== null && step.region !== null
        ? t('match.question.duel', {
            region: region(step.region),
            attacker: name(step.attacker),
            defender: name(step.defender),
          })
        : null;
    case 'DUEL_ESTIMATE':
      return step.region !== null
        ? t('match.question.duelEstimate', { region: region(step.region) })
        : null;
    case 'CAPITAL_PICK':
    case 'LAND_PICK':
    case 'CAMPAIGN_TARGET':
    case 'FINISHED':
      return null;
  }
}

/** Folge einer Auflösung als Satz (Rangfolge der Landnahme, Duellausgang, Ausscheiden). */
export function outcomeTexts(
  outcome: RevealOutcome,
  name: SeatName,
  region: RegionName,
): readonly string[] {
  switch (outcome.type) {
    case 'LAND_RANKED':
      return outcome.payload.ranking.map((r) =>
        t('match.reveal.ranking', {
          place: r.place,
          name: name(r.seat),
          picks: r.picks > 0 ? tp('match.reveal.picks', r.picks) : t('match.reveal.noPicks'),
        }),
      );
    case 'DUEL_RESOLVED': {
      const p = outcome.payload;
      const params = {
        attacker: name(p.attacker),
        defender: name(p.defender),
        region: region(p.region),
        value: p.regionValue,
      };
      const effect =
        p.effect === 'CAPITAL_HIT'
          ? tp('match.duel.CAPITAL_HIT', p.capitalLivesLeft ?? 0, params)
          : t(`match.duel.${p.effect}`, params);
      return [t(`match.duel.reason.${p.reason}`), effect];
    }
    case 'KINGDOM_ELIMINATED':
      return [
        t('match.log.KINGDOM_ELIMINATED', {
          name: name(outcome.payload.seat),
          by: name(outcome.payload.by),
        }),
      ];
  }
}

/** Ein Ereignis als Zeile im Verlauf; `null` für Ereignisse ohne eigene Zeile. */
export function logText(
  event: ParsedMatchEvent,
  name: SeatName,
  region: RegionName,
): string | null {
  switch (event.type) {
    case 'MATCH_STARTED':
      return t('match.log.MATCH_STARTED');
    case 'CAPITAL_CHOSEN':
      return t('match.log.CAPITAL_CHOSEN', {
        name: name(event.payload.seat),
        region: region(event.payload.region),
      });
    case 'AUTO_PICKED':
      return t('match.log.AUTO_PICKED', {
        name: name(event.payload.seat),
        region: region(event.payload.region),
      });
    case 'LAND_RANKED': {
      const first = event.payload.ranking.find((r) => r.place === 1);
      return first
        ? t('match.log.LAND_RANKED', { round: event.payload.round, name: name(first.seat) })
        : null;
    }
    case 'REGION_CLAIMED':
      return t('match.log.REGION_CLAIMED', {
        name: name(event.payload.seat),
        region: region(event.payload.region),
      });
    case 'TARGET_CHOSEN':
      return t('match.log.TARGET_CHOSEN', {
        attacker: name(event.payload.attacker),
        defender: name(event.payload.defender),
        region: region(event.payload.region),
      });
    case 'DUEL_RESOLVED':
    case 'KINGDOM_ELIMINATED':
      return outcomeTexts(event, name, region).at(-1) ?? null;
    case 'MATCH_FINISHED':
      return t('match.log.MATCH_FINISHED');
    case 'MATCH_CREATED':
    case 'PLAYER_JOINED':
    case 'PLAYER_LEFT':
    case 'MATCH_ABANDONED':
    case 'QUESTION_OPENED':
    case 'QUESTION_RESOLVED':
      return null;
    // Partie mit Ausbau (MATCH_RULES §11): Der Browser zeigt sie erst im nächsten Schritt
    case 'START_RANKED':
    case 'CASTLE_CHOSEN':
    case 'VILLAGE_CHOSEN':
    case 'INCOME':
    case 'ORDERS_SUBMITTED':
    case 'PREPARE_CLOSED':
    case 'ORDERS_REVEALED':
    case 'WHEEL_SPUN':
    case 'REALM_DUEL_RESOLVED':
    case 'REALM_MATCH_FINISHED':
      return null;
  }
}
