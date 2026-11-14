import { DUEL_BACK, duelContact, duelContactOf, type DuelLayout } from '../art/attack.ts';
import { NO_FX, type BoardFx, type FxBurst, type FxQuake } from '../art/fx/fx.ts';
import type { MapArt } from '../art/map-art.ts';
import type { DuelStage } from './match-model.ts';
import type { RealmLayer } from './RealmBoardArt.tsx';
import { realmBursts } from './realm-fx.ts';

/**
 * Welche Effekte die Karte gerade spielt (ADR-070), als reine Ableitung aus dem, was sie ohnehin
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

/** Ob die Seite den Wechsel zu einem Satz Effekte miterlebt hat, mit dem Schlüssel des Satzes. */
export interface FxWitness {
  readonly key: string;
  readonly live: boolean;
}

/**
 * Ob ein Satz Effekte spielen darf, steht fest, wenn er erscheint (ADR-070): Ein Ausgang, der beim
 * Laden der Seite schon lief, bekommt auch beim nächsten Rendern keine Effekte, wenn die Seite
 * inzwischen „eingeschwungen“ ist. Erst ein neuer Schlüssel fragt wieder nach.
 */
export function fxWitness(prev: FxWitness | null, key: string, live: boolean): FxWitness {
  return prev !== null && prev.key === key ? prev : { key, live };
}

function strongest(a: FxQuake | null, b: FxQuake | null): FxQuake | null {
  if (!a) return b;
  if (!b) return a;
  return a.strength === 'heavy' || b.strength !== 'heavy' ? a : b;
}

/** Treffer-Stopp: So lange stehen beide Wappen nach dem Einschlag still (map-art.css). */
export const HIT_STOP_MS = 60;

/** Anlauf: Bis hierhin holt der Angreifer Schwung, dann stürmt er bis zum Einschlag. */
const WINDUP_MS = 100;

/**
 * Wo das stürmende Wappen zur Zeit `ms` steht, als Anteil des Wegs vom Ausholen bis zum
 * Einschlag: dieselbe Kurve wie in `duel-charge-*` (map-art.css), immer schneller.
 */
function chargeAt(ms: number): number {
  const t = Math.min(1, Math.max(0, (ms - WINDUP_MS) / (IMPACT_MS - WINDUP_MS)));
  return cubicBezier(0.42, 0, 0.78, 0.6, t);
}

/** Wert einer CSS-Kurve `cubic-bezier(x1, y1, x2, y2)` an der Stelle `t` (Zeitanteil). */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  const at = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  // Den Kurvenparameter zur Zeit suchen (die x-Werte steigen streng)
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < t) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

/**
 * Ausgang eines Duells auf der Karte: Bewegungsstriche beim Sturm, im Einschlag eine doppelte
 * Druckwelle (Tinte, dann die Farbe des Siegers) und ein Beben; dann je nach Ausgang Splitter des
 * Verteidigers und Tintenspritzer (erobert), goldene Funken und Splitter des Pfeils (gehalten),
 * Funken und Steinsplitter (Burg oder Gebäude getroffen). Die Wege stimmen mit den Wappen in
 * map-art.css überein (`duelContact`).
 */
export function duelFx({ art, duel, layout, castle, realm }: BoardFxInput): BoardFx {
  if (!duel || duel.scene !== 'outcome' || !layout) return NO_FX;
  const key = `duel:${duel.attacker}:${duel.region}`;
  const s = art.size;
  const { dir, source, target, radius: r, unit } = layout;
  const contact = duelContactOf(duel, castle);
  const hit = duelContact(layout, contact, s);
  const along = (d: number) => ({ x: source.x + dir.x * d, y: source.y + dir.y * d });
  // Vorderkante des Angreifers im Einschlag; auf einem freien Feld setzt er in der Mitte auf
  const impact = contact === 'field' ? target : along(hit + r);
  const back = { x: -dir.x, y: -dir.y };
  const attacker = `var(--seat-${duel.attacker})`;
  const winner = duel.winner === null ? 'var(--map-ink)' : `var(--seat-${duel.winner})`;
  const bursts: FxBurst[] = [];
  // Bewegungsstriche hinter dem stürmenden Wappen, dort, wo es gerade ist
  const start = DUEL_BACK * unit;
  [190, 255, 315].forEach((ms, i) => {
    bursts.push({
      key: `${key}:streak${i}`,
      kind: 'streaks',
      ...along(start + (hit - start) * chargeAt(ms)),
      size: 1.1 * s,
      atMs: ms,
      color: attacker,
      dir,
      count: 2 + (i > 0 ? 1 : 0),
      power: 0.85 + 0.15 * i,
    });
  });
  // Erste Druckwelle in Tinte, wo es kracht
  bursts.push({
    key: `${key}:ring`,
    kind: 'ring',
    ...impact,
    size: 0.5 * s,
    atMs: IMPACT_MS,
    color: duel.repelled && duel.defender !== null ? 'var(--map-gold)' : 'var(--map-ink)',
  });

  if (duel.effect === 'CAPITAL_HIT') {
    // Gegen Mauer oder Gebäude: Funken und kleine Steinsplitter prallen zurück
    bursts.push(
      {
        key: `${key}:sparks`,
        kind: 'sparks',
        ...impact,
        size: 1.2 * s,
        atMs: IMPACT_MS,
        dir: back,
        spread: 170,
        count: 10,
      },
      {
        key: `${key}:debris`,
        kind: 'debris',
        ...impact,
        size: 1.3 * s,
        atMs: IMPACT_MS + 10,
        dir: back,
        spread: 200,
        count: 7,
        power: 0.7,
        tempo: 0.83,
      },
    );
    return { key, bursts, quake: { strength: 'light', atMs: IMPACT_MS } };
  }

  if (duel.repelled) {
    if (duel.defender !== null) {
      // Der goldene Schild wirft den Angriff zurück: Funken sprühen zum Angreifer
      bursts.push({
        key: `${key}:sparks`,
        kind: 'sparks',
        ...impact,
        size: 1.3 * s,
        atMs: IMPACT_MS,
        dir: back,
        spread: 140,
        count: 12,
      });
    } else {
      // Ein freies Feld bleibt frei: Der Angriff verspritzt nur Tinte
      bursts.push({
        key: `${key}:splash`,
        kind: 'spatter',
        ...impact,
        size: s,
        atMs: IMPACT_MS,
        color: 'var(--map-ink)',
        dir: back,
        spread: 170,
        count: 8,
      });
    }
    // Der Pfeil splittert
    bursts.push({
      key: `${key}:arrow`,
      kind: 'chips',
      ...impact,
      size: 0.85 * s,
      atMs: IMPACT_MS + 5,
      color: attacker,
      dir: back,
      spread: 170,
      count: 7,
    });
    return { key, bursts, quake: { strength: 'light', atMs: IMPACT_MS } };
  }

  // Erobert: zweite Druckwelle in der Farbe des Siegers, Tinte spritzt in die Region
  bursts.push(
    {
      key: `${key}:wave`,
      kind: 'ring',
      ...target,
      size: 0.8 * s,
      atMs: IMPACT_MS + 40,
      color: winner,
    },
    {
      key: `${key}:splash`,
      kind: 'spatter',
      ...impact,
      size: 1.2 * s,
      atMs: IMPACT_MS,
      color: winner,
      dir,
      spread: 150,
      count: 9,
    },
  );
  if (contact === 'token' && duel.defender !== null) {
    // Nach dem Treffer-Stopp zerspringt das Wappen des Verteidigers: Schild und Scheibe
    bursts.push(
      {
        key: `${key}:shards`,
        kind: 'chips',
        ...target,
        size: 1.1 * s,
        atMs: IMPACT_MS + HIT_STOP_MS - 5,
        color: `var(--seat-${duel.defender})`,
        dir,
        spread: 250,
        count: 8,
      },
      {
        key: `${key}:disc`,
        kind: 'chips',
        ...target,
        size: 0.9 * s,
        atMs: IMPACT_MS + HIT_STOP_MS,
        color: 'var(--map-coin)',
        dir,
        spread: 300,
        count: 5,
      },
    );
  }
  if (contact === 'wall' && realm === null && duel.effect === 'TAKEOVER') {
    // Ohne Ausbau fällt die Burg der Hauptstadt hier (DuelStageArt): Steine und Staub
    const foot = { x: target.x - 0.12 * s, y: target.y + 0.24 * s };
    bursts.push(
      {
        key: `${key}:debris`,
        kind: 'debris',
        ...foot,
        size: 0.8 * s,
        atMs: IMPACT_MS + HIT_STOP_MS + 60,
        count: 8,
      },
      {
        key: `${key}:dust`,
        kind: 'dust',
        ...foot,
        size: 0.8 * s,
        atMs: IMPACT_MS + HIT_STOP_MS + 140,
        count: 5,
        // Verflogen, bevor der Ausgang endet: Danach nimmt die Karte die Effekte ab
        tempo: 0.6,
      },
    );
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
