import { hashText, sequence } from '../noise.ts';

/**
 * Effekte über der Karte (ADR-068): Splitter, Trümmer, Staub, Funken, Tintenspritzer, Druckwellen,
 * Glanzpunkte und Bewegungsstriche. Ein Ausbruch (`FxBurst`) sagt, was wo wann geschieht, in
 * Karteneinheiten; daraus entstehen fest gewürfelte Teilchen (`fxParticles`), auf jedem Gerät
 * dieselben. Gezeichnet werden sie in einer eigenen Ebene über der Karte (`FxLayer`), als
 * HTML-Elemente mit CSS-Animationen: Der Browser bewegt sie ohne die Karte neu zu zeichnen, und
 * „Bewegung reduzieren“ blendet die Ebene aus. Grundzustand jedes Teilchens ist unsichtbar.
 */

export type FxKind =
  /** Kantige Splitter, die im Bogen davonfliegen und sich drehen (zerbrochenes Wappen, Pfeil). */
  | 'shards'
  /** Steine, die aufsteigen und zu Boden fallen (Mauern, Gebäude). */
  | 'debris'
  /** Weiche Staubwolken, die quellen und verwehen. */
  | 'dust'
  /** Kurze helle Funken, strahlenförmig (Schlag auf Metall, Abwehr). */
  | 'sparks'
  /** Tintentropfen, die aufspritzen und liegen bleiben, bis sie verblassen. */
  | 'splash'
  /** Druckwelle: ein Ring, der sich weitet. */
  | 'ring'
  /** Goldene Glanzpunkte, die kurz aufblitzen (fertig gebaut, Gold kommt an). */
  | 'glints'
  /** Bewegungsstriche hinter etwas, das schnell zieht. */
  | 'streaks'
  /**
   * Splitter, die flach über die Karte davonspritzen (von oben gesehen, ohne Bogen) und sich
   * dabei drehen: ein Wappen, das im Treffer zerspringt.
   */
  | 'chips'
  /** Tintenspritzer von oben: Tropfen schießen langgezogen davon und landen als runde Kleckse. */
  | 'spatter';

export interface FxPoint {
  readonly x: number;
  readonly y: number;
}

export interface FxBurst {
  /** Eindeutig je Ebene; daraus wird auch gewürfelt. */
  readonly key: string;
  readonly kind: FxKind;
  /** Ursprung in Karteneinheiten (viewBox der Karte). */
  readonly x: number;
  readonly y: number;
  /** Maßstab in Karteneinheiten, meist die Sechseckgröße: Reichweite und Größe der Teilchen. */
  readonly size: number;
  /** Beginn in ms, gezählt vom Erscheinen der Ebene. */
  readonly atMs: number;
  /** Farbe als CSS-Wert, etwa `var(--seat-1)`; ohne: die Farbe der Art. */
  readonly color?: string;
  /** Hauptrichtung als Einheitsvektor; ohne: rundum. */
  readonly dir?: FxPoint;
  /** Öffnung um die Hauptrichtung in Grad; ohne Richtung immer 360. */
  readonly spread?: number;
  readonly count?: number;
  /** Stärke: Reichweite und Größe, 1 = normal. */
  readonly power?: number;
  /** Tempo: wie viel schneller als üblich die Teilchen fliegen und vergehen, 1 = normal. */
  readonly tempo?: number;
}

export interface FxParticle {
  readonly key: string;
  readonly kind: FxKind;
  /** Start in Karteneinheiten. */
  readonly x: number;
  readonly y: number;
  /** Weg bis zum Ende in Karteneinheiten. */
  readonly dx: number;
  readonly dy: number;
  /** Höhe des Bogens über der geraden Linie (negativ = nach oben), Karteneinheiten. */
  readonly lift: number;
  /** Drehung in Grad: bei Funken und Strichen die Richtung, sonst die Drehung im Flug. */
  readonly rot: number;
  /** Größe in Karteneinheiten. */
  readonly size: number;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly color: string | null;
  /** Form 0 bis 3 (Splitter, Steine). */
  readonly variant: number;
}

interface KindSpec {
  readonly count: number;
  /** Reichweite in Maßstab. */
  readonly reach: readonly [number, number];
  /** Größe in Maßstab. */
  readonly grain: readonly [number, number];
  readonly durationMs: readonly [number, number];
  /** Streuung des Beginns. */
  readonly jitterMs: number;
}

const SPEC: Readonly<Record<FxKind, KindSpec>> = {
  shards: {
    count: 7,
    reach: [0.45, 1.0],
    grain: [0.09, 0.17],
    durationMs: [620, 860],
    jitterMs: 40,
  },
  debris: {
    count: 9,
    reach: [0.3, 0.85],
    grain: [0.05, 0.11],
    durationMs: [680, 980],
    jitterMs: 70,
  },
  dust: {
    count: 6,
    reach: [0.18, 0.5],
    grain: [0.24, 0.42],
    durationMs: [850, 1250],
    jitterMs: 140,
  },
  sparks: {
    count: 11,
    reach: [0.4, 0.95],
    grain: [0.12, 0.24],
    durationMs: [260, 460],
    jitterMs: 30,
  },
  splash: {
    count: 9,
    reach: [0.22, 0.7],
    grain: [0.035, 0.09],
    durationMs: [460, 720],
    jitterMs: 30,
  },
  ring: { count: 1, reach: [0, 0], grain: [1, 1], durationMs: [620, 620], jitterMs: 0 },
  glints: {
    count: 5,
    reach: [0.12, 0.42],
    grain: [0.12, 0.2],
    durationMs: [480, 680],
    jitterMs: 320,
  },
  streaks: {
    count: 4,
    reach: [0.3, 0.55],
    grain: [0.35, 0.6],
    durationMs: [240, 340],
    jitterMs: 40,
  },
  chips: {
    count: 10,
    reach: [0.55, 1.25],
    grain: [0.1, 0.2],
    durationMs: [420, 640],
    jitterMs: 25,
  },
  spatter: {
    count: 10,
    reach: [0.3, 0.95],
    grain: [0.05, 0.12],
    durationMs: [560, 820],
    jitterMs: 30,
  },
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Teilchen eines Ausbruchs, fest gewürfelt aus seinem Schlüssel. */
export function fxParticles(burst: FxBurst): FxParticle[] {
  const spec = SPEC[burst.kind];
  const rand = sequence(hashText(burst.key));
  const between = ([a, b]: readonly [number, number]) => a + (b - a) * rand();
  const power = burst.power ?? 1;
  const count = burst.count ?? spec.count;
  const s = burst.size * power;
  const base = burst.dir ? Math.atan2(burst.dir.y, burst.dir.x) : 0;
  const spread = burst.dir ? ((burst.spread ?? 120) * Math.PI) / 180 : Math.PI * 2;
  const particles: FxParticle[] = [];
  for (let i = 0; i < count; i++) {
    // Gleichmäßig über die Öffnung verteilt, mit etwas Zufall: keine Lücken, kein Klumpen
    const slot = count === 1 ? 0.5 : (i + 0.2 + 0.6 * rand()) / count;
    const angle = burst.dir ? base + (slot - 0.5) * spread : slot * spread + rand() * 0.4;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const reach = between(spec.reach) * s;
    const size = between(spec.grain) * s;
    const delayMs = Math.round(burst.atMs + rand() * spec.jitterMs);
    const durationMs = Math.round(
      (between(spec.durationMs) * (0.85 + 0.15 * power)) / (burst.tempo ?? 1),
    );
    const variant = Math.floor(rand() * 4);
    let dx = ux * reach;
    let dy = uy * reach;
    let lift = 0;
    let rot = 0;
    switch (burst.kind) {
      case 'shards':
        lift = -(0.18 + 0.3 * rand()) * s;
        dy += 0.12 * s;
        rot = (rand() < 0.5 ? -1 : 1) * (200 + 360 * rand());
        break;
      case 'debris':
        // Steine steigen auf und fallen unter ihren Start: der Boden liegt etwas tiefer
        lift = -(0.32 + 0.42 * rand()) * s;
        dy = Math.abs(dy) * 0.35 + (0.12 + 0.14 * rand()) * s;
        rot = (rand() < 0.5 ? -1 : 1) * (90 + 300 * rand());
        break;
      case 'dust':
        // Staub rollt flach am Boden entlang und steigt nur wenig
        dy = dy * 0.45 - 0.08 * s;
        rot = rand() * 360;
        break;
      case 'sparks':
        // Funken fliegen gerade: Die Drehung gibt die Richtung, der Weg die Länge
        rot = (angle * 180) / Math.PI;
        dx = reach;
        dy = 0;
        break;
      case 'splash':
        lift = -(0.05 + 0.12 * rand()) * s;
        rot = rand() * 360;
        break;
      case 'ring':
        dx = 0;
        dy = 0;
        break;
      case 'chips':
        // Von oben gesehen: gerade hinaus, von der Reibung gebremst, und dabei kreiselnd
        rot = (rand() < 0.5 ? -1 : 1) * (240 + 380 * rand());
        break;
      case 'spatter':
        // Der Tropfen fliegt in Richtung seines Wegs langgezogen
        rot = (angle * 180) / Math.PI;
        break;
      case 'glints':
        // Glanzpunkte stehen, statt zu fliegen
        rot = 45 * variant;
        break;
      case 'streaks': {
        // Striche liegen quer versetzt hinter dem Ursprung und ziehen der Richtung nach
        const side = (slot - 0.5) * 0.7 * s;
        const back = (0.1 + 0.35 * rand()) * s;
        rot = (base * 180) / Math.PI;
        particles.push({
          key: `${burst.key}:${i}`,
          kind: burst.kind,
          x: round(burst.x - Math.cos(base) * back - Math.sin(base) * side),
          y: round(burst.y - Math.sin(base) * back + Math.cos(base) * side),
          dx: round(-Math.cos(base) * reach),
          dy: round(-Math.sin(base) * reach),
          lift: 0,
          rot: round(rot),
          size: round(size),
          delayMs,
          durationMs,
          color: burst.color ?? null,
          variant,
        });
        continue;
      }
    }
    const start =
      burst.kind === 'glints'
        ? { x: burst.x + ux * reach, y: burst.y + uy * reach * 0.8 }
        : { x: burst.x, y: burst.y };
    particles.push({
      key: `${burst.key}:${i}`,
      kind: burst.kind,
      x: round(start.x),
      y: round(start.y),
      dx: burst.kind === 'glints' ? 0 : round(dx),
      dy: burst.kind === 'glints' ? 0 : round(dy),
      lift: round(lift),
      rot: round(rot),
      size: round(burst.kind === 'ring' ? s : size),
      delayMs,
      durationMs,
      color: burst.color ?? null,
      variant,
    });
  }
  return particles;
}

/** Beben der Karte bei einem schweren Schlag: leicht (Treffer) oder schwer (Burg, Reich fällt). */
export interface FxQuake {
  readonly strength: 'light' | 'heavy';
  readonly atMs: number;
}

/** Was die Karte gerade an Effekten spielt; `key` wechselt mit jedem neuen Anlass. */
export interface BoardFx {
  readonly key: string;
  readonly bursts: readonly FxBurst[];
  readonly quake: FxQuake | null;
}

export const NO_FX: BoardFx = { key: '', bursts: [], quake: null };
