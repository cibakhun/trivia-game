import type { DuelLayout } from '../art/attack.ts';
import { NO_FX, type BoardFx, type FxBurst, type FxQuake } from '../art/fx/fx.ts';
import type { MapArt } from '../art/map-art.ts';
import type { DuelStage } from './match-model.ts';
import type { RealmLayer } from './RealmBoardArt.tsx';
import { realmBursts } from './realm-fx.ts';

/**
 * Welche Effekte die Karte gerade spielt (ADR-068), als reine Ableitung aus dem, was sie ohnehin
 * zeigt: Ausgang eines Duells, Aufdecken der Befehle, Ausgang mit Ausbau. Nur für Wechsel, die die
 * Seite miterlebt hat (`live`); nie während einer Frage, denn dann steht kein Ausgang an.
 */
export interface BoardFxInput {
  readonly art: MapArt;
  readonly duel: DuelStage | null;
  readonly layout: DuelLayout | null;
  /** Das Ziel des Duells ist eine Burg (Hauptstadt oder mit Ausbau jede Burg). */
  readonly castle: boolean;
  readonly realm: RealmLayer | null;
  readonly live: boolean;
}

/** Schlag des Ausgangs: Hier trifft der Angreifer (ms nach Beginn der Auflösung). */
export const IMPACT_MS = 350;

export function boardFx(input: BoardFxInput): BoardFx {
  if (!input.live) return NO_FX;
  const duel = duelFx(input);
  const realm = realmFx(input);
  const bursts = [...duel.bursts, ...realm.bursts];
  if (bursts.length === 0 && !duel.quake && !realm.quake) return NO_FX;
  return {
    key: [duel.key, realm.key].filter(Boolean).join('|'),
    bursts,
    quake: strongest(duel.quake, realm.quake),
  };
}

function strongest(a: FxQuake | null, b: FxQuake | null): FxQuake | null {
  if (!a) return b;
  if (!b) return a;
  return a.strength === 'heavy' || b.strength !== 'heavy' ? a : b;
}

/** Ausgang eines Duells auf der Karte: Einschlag, Splitter, Tinte. */
export function duelFx({ art, duel, layout }: BoardFxInput): BoardFx {
  if (!duel || duel.scene !== 'outcome' || !layout) return NO_FX;
  const key = `duel:${duel.attacker}:${duel.region}`;
  const s = art.size;
  const target = layout.target;
  const winner = duel.winner === null ? 'var(--map-ink)' : `var(--seat-${duel.winner})`;
  const bursts: FxBurst[] = [];
  if (duel.repelled) {
    // Der Angriff zerschellt: Funken fliegen zum Angreifer zurück
    const at = {
      x: target.x - layout.dir.x * layout.radius,
      y: target.y - layout.dir.y * layout.radius,
    };
    bursts.push(
      {
        key: `${key}:sparks`,
        kind: 'sparks',
        ...at,
        size: s,
        atMs: 170,
        dir: { x: -layout.dir.x, y: -layout.dir.y },
        spread: 150,
      },
      {
        key: `${key}:ring`,
        kind: 'ring',
        ...at,
        size: 0.45 * s,
        atMs: 170,
        color: 'var(--map-gold)',
      },
    );
    return { key, bursts, quake: { strength: 'light', atMs: 170 } };
  }
  bursts.push(
    { key: `${key}:ring`, kind: 'ring', ...target, size: 0.5 * s, atMs: IMPACT_MS, color: winner },
    {
      key: `${key}:splash`,
      kind: 'splash',
      ...target,
      size: s,
      atMs: IMPACT_MS,
      color: winner,
      dir: layout.dir,
      spread: 200,
    },
  );
  if (duel.defender !== null) {
    bursts.push({
      key: `${key}:shards`,
      kind: 'shards',
      ...target,
      size: s,
      atMs: IMPACT_MS - 30,
      color: `var(--seat-${duel.defender})`,
      dir: layout.dir,
      spread: 140,
    });
  }
  const heavy = duel.effect === 'TAKEOVER';
  return { key, bursts, quake: { strength: heavy ? 'heavy' : 'light', atMs: IMPACT_MS } };
}

/**
 * Partie mit Ausbau: Staub, Trümmer und Glanz beim Aufdecken und im Ausgang (`realm-fx.ts`). Der
 * Ausgang spielt nur in der Szene `outcome`, zusammen mit dem Duell: So bleibt der Schlüssel der
 * Ebene über die ganze Szene derselbe, und danach liegt das Blatt mit den Antworten auf der Karte.
 */
export function realmFx({ art, duel, layout, realm }: BoardFxInput): BoardFx {
  const motion = realm?.motion;
  if (!realm || !motion) return NO_FX;
  if (motion.kind === 'outcome' && duel !== null && duel.scene !== 'outcome') return NO_FX;
  const plan = realmBursts({ art, realm, motion, layout });
  return plan.bursts.length === 0 && !plan.quake ? NO_FX : plan;
}
