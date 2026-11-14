import type { DuelLayout } from '../art/attack.ts';
import type { FxBurst, FxPoint, FxQuake } from '../art/fx/fx.ts';
import type { ArtRegion, MapArt } from '../art/map-art.ts';
import {
  armiesBefore,
  bannerAt,
  bearerFoot,
  BEARER,
  castleBox,
  footOf,
  gateAt,
  houseBox,
  type RealmLayer,
  type RealmMotion,
} from './RealmBoardArt.tsx';

/**
 * Effekte der Partie mit Ausbau über der Karte (ADR-070), als reine Ableitung aus der Bewegung
 * (`RealmMotion`, ADR-067). Die Zeiten folgen den Variablen oben im Abschnitt „Bewegung“ von
 * `art/map-art.css`, damit Staub und Trümmer genau dort und dann aufsteigen, wo die Karte das
 * Gebäude brechen, die Burg einstürzen oder den Zug aufsetzen lässt. Alles ist verweht, bevor
 * die Ebene geht: der Ausgang vor dem Ende des ersten Takts (1,5 s), das Aufdecken vor 2 s.
 */

/**
 * Zeiten aus `map-art.css` in ms: Aufdecken. Ein Zug setzt nach 92 % seines Marschs am Ziel auf
 * (`army-march`).
 */
export const REVEAL_TIMES = {
  riseAt: 100,
  riseMs: 600,
  marchAt: 600,
  marchMs: 950,
  landAt: 0.92,
} as const;
/** Hüpfer eines marschierenden Zugs (`march-hop`, fünf je Marsch). */
const HOPS = 5;
/**
 * Ausgang: Schlag (`--fall-at`), Bruch (`--fall-at` + 0,07 s) und Einsturz des Bergfrieds
 * (`tower-fall-1`: Bruch + 44 % von 0,84 s).
 */
export const OUTCOME_TIMES = { impactMs: 350, breakMs: 420, keepMs: 790 } as const;

export interface RealmFxInput {
  readonly art: MapArt;
  readonly realm: RealmLayer;
  readonly motion: RealmMotion;
  /** Weg des Angriffs, wenn ein Duell auf der Karte steht: Trümmer fliegen von ihm weg. */
  readonly layout: DuelLayout | null;
}

export interface RealmFxPlan {
  readonly key: string;
  readonly bursts: FxBurst[];
  readonly quake: FxQuake | null;
}

const ROCK = 'var(--map-rock)';
const STONE = 'var(--map-stone)';
const ROOF = 'var(--map-roof)';

export function realmBursts({ art, realm, motion, layout }: RealmFxInput): RealmFxPlan {
  const s = art.size;
  const bursts: FxBurst[] = [];
  let quake: FxQuake | null = null;
  const ids = Object.keys(motion.fields)
    .map(Number)
    .sort((a, b) => a - b);
  const key = `realm:${motion.kind}:${ids
    .map((id) => `${id}=${Object.entries(motion.fields[id] ?? {}).join(',')}`)
    .join(';')}`;
  const castleOn = (region: ArtRegion) =>
    (realm.regions[region.id]?.building ?? 'NONE') === 'CASTLE';

  if (motion.kind === 'orders') {
    for (const id of ids) {
      const field = motion.fields[id];
      const region = art.regions[id];
      if (!field || !region || field.built !== true) continue;
      // Baustaub am Fuß, während es wächst; Glanz, wenn es steht
      const armies = realm.regions[id]?.armies ?? 0;
      const box = castleOn(region)
        ? castleBox(region, s, armies > 0 || armiesBefore(armies, field) > 0)
        : houseBox(region, s);
      const foot = footOf(box);
      const at = `${key}:${id}`;
      bursts.push(
        {
          key: `${at}:build-dust`,
          kind: 'dust',
          ...foot,
          size: 0.85 * s,
          atMs: REVEAL_TIMES.riseAt + 30,
          count: 5,
          power: 0.9,
          tempo: 0.7,
        },
        {
          key: `${at}:glints`,
          kind: 'glints',
          x: foot.x,
          y: box.y + 0.42 * box.size,
          size: 1.3 * s,
          atMs: REVEAL_TIMES.riseAt + 0.62 * REVEAL_TIMES.riseMs,
          count: 4,
          tempo: 0.8,
          color: 'var(--map-gold)',
        },
      );
    }
    const marching = realm.moves ?? [];
    for (const move of marching) {
      const a = art.regions[move.from];
      const b = art.regions[move.to];
      if (!a || !b) continue;
      bursts.push(...marchDust(`${key}:${move.seat}:${move.from}:${move.to}`, a, b, s, castleOn));
    }
    // Neue Armeen treten aus dem Tor: ein paar Funken Gold, wenn es sich öffnet
    for (const id of ids) {
      const field = motion.fields[id];
      const region = art.regions[id];
      if (!field || !region || (field.recruited ?? 0) <= 0) continue;
      const gate = gateAt(region, s);
      bursts.push({
        key: `${key}:${id}:gate`,
        kind: 'glints',
        x: gate.x,
        y: gate.y + 0.04 * s,
        size: 0.6 * s,
        atMs: 300,
        count: 3,
        tempo: 0.7,
        color: 'var(--map-gold)',
      });
    }
    return { key, bursts, quake };
  }

  // Ausgang: Trümmer fliegen vom Angreifer weg, über die Burg oder das Gebäude hinaus
  const away: FxPoint | undefined = layout?.dir;
  for (const id of ids) {
    const field = motion.fields[id];
    const region = art.regions[id];
    if (!field || !region) continue;
    const at = `${key}:${id}`;
    if (field.fell === 'VILLAGE' || field.fell === 'TOWN') {
      const box = houseBox(region, s);
      const foot = footOf(box);
      const mid = { x: foot.x, y: box.y + 0.5 * box.size };
      bursts.push(
        {
          key: `${at}:roof`,
          kind: 'debris',
          ...mid,
          size: 0.72 * s,
          atMs: OUTCOME_TIMES.breakMs,
          count: 5,
          color: field.fell === 'TOWN' ? STONE : ROOF,
          tempo: 0.8,
          ...(away ? { dir: away, spread: 240 } : {}),
        },
        {
          key: `${at}:stones`,
          kind: 'debris',
          x: mid.x,
          y: mid.y + 0.12 * box.size,
          size: 0.62 * s,
          atMs: OUTCOME_TIMES.breakMs + 50,
          count: 5,
          color: field.fell === 'TOWN' ? ROOF : ROCK,
          tempo: 0.8,
          power: 0.9,
        },
        {
          key: `${at}:dust`,
          kind: 'dust',
          ...foot,
          size: 0.85 * s,
          atMs: OUTCOME_TIMES.breakMs + 40,
          count: 7,
          power: 1.3,
          tempo: 0.6,
        },
        {
          // Was einsackt, wirbelt Staub über den Fuß hinauf
          key: `${at}:billow`,
          kind: 'dust',
          x: foot.x,
          y: foot.y - 0.18 * box.size,
          size: 0.7 * s,
          atMs: OUTCOME_TIMES.breakMs + 140,
          count: 3,
          power: 1.2,
          tempo: 0.55,
          dir: { x: 0, y: -1 },
          spread: 120,
        },
      );
    } else if (field.fell === 'CASTLE') {
      const box = castleBox(region, s, field.lost !== undefined);
      const foot = footOf(box);
      const mid = { x: foot.x, y: box.y + 0.45 * box.size };
      bursts.push(
        {
          key: `${at}:stones`,
          kind: 'debris',
          ...mid,
          size: 0.95 * s,
          atMs: OUTCOME_TIMES.breakMs,
          count: 7,
          color: STONE,
          power: 1.1,
          tempo: 0.85,
          ...(away ? { dir: away, spread: 260 } : {}),
        },
        {
          key: `${at}:dust`,
          kind: 'dust',
          ...foot,
          size: 1.05 * s,
          atMs: OUTCOME_TIMES.breakMs + 40,
          count: 7,
          power: 1.35,
          tempo: 0.6,
        },
        {
          // Zweiter Schlag: Der Bergfried sackt ein (`tower-fall-1`), Grus und eine Staubwand
          key: `${at}:rubble`,
          kind: 'debris',
          x: mid.x,
          y: foot.y - 0.2 * box.size,
          size: 0.8 * s,
          atMs: OUTCOME_TIMES.keepMs + 30,
          count: 5,
          color: ROCK,
          tempo: 0.6,
        },
        {
          key: `${at}:slump`,
          kind: 'dust',
          x: foot.x,
          y: foot.y - 0.08 * box.size,
          size: 0.95 * s,
          atMs: OUTCOME_TIMES.keepMs,
          count: 5,
          power: 1.25,
          tempo: 0.45,
        },
      );
      quake = { strength: 'heavy', atMs: OUTCOME_TIMES.impactMs };
    } else if (field.hit === true) {
      const armies = realm.regions[id]?.armies ?? 0;
      const box = castleBox(region, s, armies > 0 || armiesBefore(armies, field) > 0);
      const foot = footOf(box);
      // Splitter springen von der Mauer, die dem Angreifer zugewandt ist, zu ihm zurück
      const toward = away ? { x: -away.x, y: -away.y } : undefined;
      const wall = {
        x: foot.x + (toward ? toward.x * 0.3 * box.size : 0),
        y: box.y + 0.5 * box.size + (toward ? toward.y * 0.2 * box.size : 0),
      };
      bursts.push(
        {
          key: `${at}:chips`,
          kind: 'debris',
          ...wall,
          size: 0.8 * s,
          atMs: OUTCOME_TIMES.impactMs + 20,
          count: 5,
          color: STONE,
          power: 1.05,
          tempo: 0.75,
          ...(toward ? { dir: toward, spread: 170 } : {}),
        },
        {
          // Dunkler Grus dazwischen, damit die hellen Splitter auf dem Pergament lesbar bleiben
          key: `${at}:grit`,
          kind: 'debris',
          ...wall,
          size: 0.6 * s,
          atMs: OUTCOME_TIMES.impactMs + 40,
          count: 3,
          color: ROCK,
          tempo: 0.7,
          ...(toward ? { dir: toward, spread: 200 } : {}),
        },
        {
          key: `${at}:dust`,
          kind: 'dust',
          ...foot,
          size: 0.7 * s,
          atMs: OUTCOME_TIMES.impactMs + 60,
          count: 5,
          power: 0.9,
          tempo: 0.6,
        },
      );
    }
  }
  return { key, bursts, quake };
}

/**
 * Staubspur eines marschierenden Zugs: Bei jedem Aufsetzen seiner Hüpfer wirbelt am Fuß ein
 * Wölkchen auf, nach hinten weg; bei der Ankunft setzt er mit einem Staubring auf. Der Weg folgt
 * `army-march` (zwei Geraden über den Scheitel des Bogens).
 */
function marchDust(
  key: string,
  a: ArtRegion,
  b: ArtRegion,
  s: number,
  castleOn: (region: ArtRegion) => boolean,
): FxBurst[] {
  const from = bannerAt(a, castleOn(a), s);
  const to = bannerAt(b, castleOn(b), s);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const mid = { x: dx / 2 - (dy / len) * 0.16 * s, y: dy / 2 + (dx / len) * 0.16 * s };
  const along = (f: number) =>
    f <= 0.5
      ? { x: mid.x * (f / 0.5), y: mid.y * (f / 0.5) }
      : {
          x: mid.x + (dx - mid.x) * ((f - 0.5) / 0.5),
          y: mid.y + (dy - mid.y) * ((f - 0.5) / 0.5),
        };
  const size = BEARER.field * s;
  const back = { x: -dx / len, y: -dy / len };
  const bursts: FxBurst[] = [];
  const walkMs = REVEAL_TIMES.marchMs * REVEAL_TIMES.landAt;
  const hopMs = walkMs / HOPS;
  for (let hop = 1; hop < HOPS; hop++) {
    const p = along(hop / HOPS);
    const foot = bearerFoot({ x: from.x + p.x, y: from.y + p.y }, size);
    bursts.push({
      key: `${key}:step-${hop}`,
      kind: 'dust',
      ...foot,
      size: 0.58 * s,
      atMs: Math.round(REVEAL_TIMES.marchAt + hop * hopMs - 20),
      count: 2,
      power: 0.55,
      tempo: 0.5,
      dir: back,
      spread: 110,
    });
  }
  const landing = bearerFoot(to, size);
  const arrive = REVEAL_TIMES.marchAt + walkMs;
  bursts.push(
    {
      key: `${key}:ring`,
      kind: 'ring',
      ...landing,
      size: 0.34 * s,
      atMs: arrive - 30,
      color: ROCK,
      tempo: 0.55,
    },
    {
      key: `${key}:land`,
      kind: 'dust',
      ...landing,
      size: 0.5 * s,
      atMs: arrive - 60,
      count: 3,
      power: 0.5,
      tempo: 0.3,
    },
  );
  return bursts;
}
