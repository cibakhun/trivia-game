import { matchMap, regionNeighbors } from '@rdw/game-core';
import { expect, test, type Page, type Route } from '@playwright/test';
import { closeAnswerDb } from './answers.ts';
import { answerRight, matchIdOf, newPlayer, succeeds } from './match-kit.ts';

/**
 * Partie mit Ausbau im Browser (MATCH_RULES §11, ADR-060, TEST_PLAN §5): eine ganze Testpartie am
 * quer gehaltenen Handy gegen zwei Bots, mit Spieltestzeiten. „So geht's“ öffnet sich vor der ersten
 * Partie von selbst. Der Spieler wählt seine Lieblingskategorien, setzt Burg und Dorf, baut, kauft,
 * zieht und tauscht in der Rüstzeit über die drei festen Zeilen des Blatts (ADR-063), greift in zwei
 * Schritten an (Ziel antippen, dann „Angreifen“) und antwortet richtig; die Lösung liest nur der
 * Test aus der Datenbank. Die Landnahme endet nach zwei Runden; der erste eigene Angriff geht
 * auf ein freies Feld (O-37, ADR-062), die weiteren auf fremde. Aufgedecktes, Glücksrad und Ausgang
 * stehen nur kurz: Die Seite schreibt selbst mit, was sie gezeigt hat.
 */

test.afterAll(async () => {
  await closeAnswerDb();
});

/** Querformat eines Handys, wie es Safari der Seite lässt. */
const ACROSS = { width: 844, height: 390 };

/** Was die Seite während der Partie gezeigt hat. */
interface Seen {
  /** Zustand und Schritt der Bühne in der Reihenfolge, in der sie kamen. */
  readonly states: string[];
  /** Lage und Ausschnitt der Karte: in jedem Zustand gleich. */
  readonly frames: string[];
  /** Größter Betrag, um den die Seite gescrollt war oder sich hätte scrollen lassen. */
  scroll: number;
  /** Aufgedeckte Befehle je Runde: das eigene Reich, alle Zeilen und wie viele Reiche noch leben. */
  readonly orders: Record<string, { mine: string; rows: number; alive: number }>;
  /** Glücksrad je Duell: ob die Scheibe mitten auf der Karte lag und was es zeigte. */
  readonly wheels: { disc: boolean; segments: number; category: string | null; text: string }[];
  /** Ausgang je Duell. */
  readonly outcomes: { effect: string; text: string; sign: boolean }[];
  /** Liste, wer schon geantwortet hat: Zeilen, und ob die eigene als beantwortet markiert war. */
  readonly answers: { rows: number; mine: boolean }[];
  /** Fragen anderer zum Mitlesen (ADR-065, O-43): je Frage die Karte und der Satz im Blatt. */
  readonly watched: {
    kind: string;
    text: string;
    options: number;
    buttons: number;
    sheet: string;
  }[];
}

/** Lässt die Seite mitschreiben, was sie zeigt; für eine Abfrage von außen steht manches zu kurz. */
async function recordSeen(page: Page): Promise<void> {
  const install = () => {
    const seen: Seen = {
      states: [],
      frames: [],
      scroll: 0,
      orders: {},
      wheels: [],
      outcomes: [],
      answers: [],
      watched: [],
    };
    (window as unknown as { seen: Seen }).seen = seen;
    let key = '';
    let outcomeSeq = '';
    let watchedSeq = '';
    const text = (selector: string) =>
      (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const note = () => {
      const screen = document.querySelector('[data-testid="match-screen"]');
      if (!screen) return;
      const state = screen.getAttribute('data-state') ?? '';
      const step = screen.getAttribute('data-step') ?? '';
      const entered = `${state}:${step}:${screen.getAttribute('data-seq') ?? ''}` !== key;
      key = `${state}:${step}:${screen.getAttribute('data-seq') ?? ''}`;
      if (seen.states.at(-1) !== `${state}:${step}`) seen.states.push(`${state}:${step}`);
      if (document.documentElement.classList.contains('match-playing')) {
        seen.scroll = Math.max(
          seen.scroll,
          Math.abs(window.scrollY),
          document.documentElement.scrollHeight - window.innerHeight,
          document.documentElement.scrollWidth - window.innerWidth,
        );
      }
      const board = document.querySelector('[data-testid="match-board"]');
      // Bebt die Karte gerade (ADR-070), ruckt nur ihr Rahmen kurz: kein Platzwechsel
      const frameEl = board?.closest('.board-frame');
      const quaking = frameEl ? getComputedStyle(frameEl).transform !== 'none' : false;
      if (board && !quaking) {
        const rect = board.getBoundingClientRect();
        const frame = [
          ...[rect.x, rect.y, rect.width, rect.height].map(Math.round),
          board.getAttribute('viewBox'),
        ].join(' ');
        if (!seen.frames.includes(frame)) seen.frames.push(frame);
      }
      if (state === 'orders') {
        const me = document.querySelector('[data-testid="match-seats"] li.me');
        const row = `[data-testid="match-orders"] li[data-seat="${me?.getAttribute('data-seat')}"]`;
        seen.orders[text('[data-testid="match-step"]')] = {
          mine: text(row),
          rows: document.querySelectorAll('[data-testid="match-orders"] li[data-seat]').length,
          alive: document.querySelectorAll('[data-testid="match-seats"] li:not(.eliminated)')
            .length,
        };
      } else if (state === 'wheel') {
        const disc = document.querySelector('[data-testid="match-wheel-disc"]');
        const result = document.querySelector('[data-testid="wheel-result"]');
        const wheel = {
          disc: disc !== null && disc.closest('.stage-centre.disc') !== null,
          segments: disc?.querySelectorAll('.wheel-seg').length ?? 0,
          category: result?.getAttribute('data-category') ?? null,
          text: text('[data-testid="match-wheel"]'),
        };
        if (entered) seen.wheels.push(wheel);
        else seen.wheels[seen.wheels.length - 1] = wheel;
      } else if (state === 'reveal') {
        const outcome = document.querySelector('[data-testid="match-outcome"]');
        const seq = screen.getAttribute('data-seq') ?? '';
        if (outcome && seq !== outcomeSeq) {
          outcomeSeq = seq;
          seen.outcomes.push({
            effect: outcome.getAttribute('data-effect') ?? '',
            text: text('[data-testid="match-outcome"]'),
            sign: document.querySelector('[data-testid="match-board"] .plan-change') !== null,
          });
        }
      }
      const card = document.querySelector('[data-testid="match-question-watched"]');
      const cardSeq = screen.getAttribute('data-seq') ?? '';
      if (card && cardSeq !== watchedSeq) {
        watchedSeq = cardSeq;
        seen.watched.push({
          kind: card.getAttribute('data-kind') ?? '',
          text: text('[data-testid="match-question-watched"]'),
          options: card.querySelectorAll('.option-read').length,
          buttons: card.querySelectorAll('button').length,
          sheet: text('[data-testid="match-waiting"]'),
        });
      }
      const list = document.querySelector('[data-testid="match-answers"]');
      if (list) {
        const me = document.querySelector('[data-testid="match-seats"] li.me');
        const mine = list.querySelector(`li[data-seat="${me?.getAttribute('data-seat')}"]`);
        const answers = {
          rows: list.querySelectorAll('li[data-seat]').length,
          mine: mine?.getAttribute('data-answered') === 'true',
        };
        const last = seen.answers.at(-1);
        if (entered || !last || last.rows !== answers.rows || last.mine !== answers.mine) {
          seen.answers.push(answers);
        }
      }
    };
    const start = () => {
      new MutationObserver(note).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      note();
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start);
  };
  // Gilt für die Seite, die schon steht, und für jede, die neu geladen wird
  await page.addInitScript(install);
  await page.evaluate(install);
}

function seenBy(page: Page): Promise<Seen> {
  return page.evaluate(() => (window as unknown as { seen: Seen }).seen);
}

/** Wartet auf die Antwort des Servers auf eine eigene Aktion der Partie. */
function accepted(page: Page, matchId: string, action: string, timeout = 3_000): Promise<boolean> {
  return page
    .waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/matches/${matchId}/${action}`),
      { timeout },
    )
    .then(
      (r) => r.ok(),
      () => false,
    );
}

const MAP = matchMap('WENDELMARK');

/**
 * Wählt ein markiertes Feld mit einem Tipp. Als Burg das Feld mit den meisten Nachbarn, als Dorf
 * und in der Landnahme ein Feld an der eigenen Burg: So hat die Burg sicher ein eigenes Nachbarfeld,
 * auf das später eine Armee ziehen kann. Gibt die gewählte Region zurück, wenn der Server sie annahm.
 */
async function pickNear(
  page: Page,
  matchId: string,
  castle: number | null,
): Promise<number | null> {
  const board = page.getByTestId('match-board');
  const legal = await board
    .locator('.board-region.legal')
    .evaluateAll((all) => all.map((g) => Number(g.getAttribute('data-region'))));
  if (legal.length === 0) return null;
  const near = (id: number) => regionNeighbors(MAP, id).length;
  const choice =
    castle === null
      ? [...legal].sort((a, b) => near(b) - near(a) || a - b)[0]
      : (legal.find((id) => regionNeighbors(MAP, castle).includes(id)) ?? legal[0]);
  if (choice === undefined) return null;
  const ok = accepted(page, matchId, 'pick', 2_000);
  const done = await succeeds(
    board.locator(`.board-region[data-region="${choice}"]`).tap({ timeout: 2_000 }),
  );
  return (await ok) && done ? choice : null;
}

/** Ein eigener Angriff: das Ziel, die Zeilen der Lose im Blatt und ob das Feld frei war. */
interface Attack {
  readonly target: string;
  readonly lots: number;
  readonly free: boolean;
  /** Ein Feld ohne eigene Armee daneben wurde vorher angetippt und mit Grund abgelehnt. */
  readonly refused: 'NO_ARMY' | 'FAR' | null;
}

/**
 * Greift ein markiertes Feld an: mit `free` ein freies, wenn eines am eigenen Land liegt, sonst
 * ein fremdes, lieber eines ohne Burg, damit alle drei Reiche lange im Spiel bleiben. Der erste
 * Tipp zeigt nur das Ziel mit den Losen im Glücksrad; an den Server geht die Wahl erst mit
 * „Angreifen“. Angriff nur mit Armee (ADR-064): Markiert ist nur, was neben einer eigenen Armee
 * liegt; ein anderes fremdes oder freies Feld nennt beim Antippen den Grund und geht nicht an den
 * Server.
 */
async function attackFirst(page: Page, matchId: string, free: boolean): Promise<Attack | null> {
  let sent = 0;
  const count = (request: { method(): string; url(): string }) => {
    if (request.method() === 'POST' && request.url().endsWith(`/matches/${matchId}/pick`)) {
      sent += 1;
    }
  };
  page.on('request', count);
  try {
    const board = page.getByTestId('match-board');
    // Eigene Felder lassen sich beim Angriff nicht antippen; ihr Name nennt die Armeen
    const shown = await board.locator('.board-region').evaluateAll((all) => {
      const ids = (list: Element[]) => list.map((g) => Number(g.getAttribute('data-region')));
      return {
        legal: ids(all.filter((g) => g.classList.contains('legal'))),
        armed: ids(
          all.filter(
            (g) =>
              g.getAttribute('role') === 'img' &&
              /, [1-9]\d* Armeen?, /.test(g.getAttribute('aria-label') ?? ''),
          ),
        ),
      };
    });
    if (shown.legal.length === 0) return null;
    for (const id of shown.legal) {
      expect(
        regionNeighbors(MAP, id).some((near) => shown.armed.includes(near)),
        `Feld ${id} ist markiert, aber keine eigene Armee steht daneben`,
      ).toBe(true);
    }
    let refused: Attack['refused'] = null;
    const other = board.locator('.board-region[role="button"]:not(.legal)').first();
    if (await succeeds(other.tap({ timeout: 2_000 }))) {
      const note = page.getByTestId('match-target-refused');
      if (await succeeds(note.waitFor({ timeout: 2_000 }))) {
        const reach = await note.getAttribute('data-reach');
        expect(reach).toMatch(/^(NO_ARMY|FAR)$/);
        await expect(note).toContainText('Kein Ziel:');
        await expect(page.getByTestId('match-target')).toHaveCount(0);
        refused = reach === 'FAR' ? 'FAR' : 'NO_ARMY';
      }
    }
    expect(sent).toBe(0);
    const open = board.locator('.board-region.legal.free');
    const plain = board.locator('.board-region.legal:not(.free):not(.capital)');
    const owned = board.locator('.board-region.legal:not(.free)');
    let field = board.locator('.board-region.legal').first();
    for (const wanted of free ? [open, plain, owned] : [plain, owned]) {
      if ((await wanted.count()) === 0) continue;
      field = wanted.first();
      break;
    }
    const name = await field.getAttribute('aria-label', { timeout: 2_000 }).catch(() => null);
    const unowned = await field
      .evaluate((g) => g.classList.contains('free'), undefined, { timeout: 2_000 })
      .catch(() => null);
    if (name === null || unowned === null) return null;
    if (!(await succeeds(field.tap({ timeout: 2_000 })))) return null;
    const target = page.getByTestId('match-target');
    if (!(await succeeds(target.waitFor({ timeout: 2_000 })))) return null;
    const title = await target.locator('.feld-name').textContent();
    const lots = await page.getByTestId('match-lots').locator('.lot').count();
    const chance = await page.getByTestId('match-lots-chance').textContent();
    expect(title).toBe(name);
    // Mit dem Ziel ist der Grund des abgelehnten Felds wieder weg
    await expect(page.getByTestId('match-target-refused')).toHaveCount(0);
    expect(sent).toBe(0);
    // Unter den Losen steht, wie wahrscheinlich die Frage aus den eigenen Lieblingskategorien kommt
    expect(chance).toMatch(/^\d+ % für deine Lieblingskategorien\./);
    // Ein freies Feld steht als solches im Blatt: Niemand verteidigt es
    expect((await target.getAttribute('data-free')) !== null).toBe(unowned);
    if (unowned)
      await expect(page.getByTestId('match-pick')).toContainText(
        'Freies Feld, niemand verteidigt es',
      );
    const ok = accepted(page, matchId, 'pick');
    const attack = page.getByTestId('match-pick').getByRole('button', { name: 'Angreifen' });
    if (!(await succeeds(attack.tap({ timeout: 2_000 }))) || !(await ok)) return null;
    return { target: name, lots, free: unowned, refused };
  } finally {
    page.off('request', count);
  }
}

/** Was der Spieler in einer Rüstzeit befohlen hat. */
interface Prepared {
  readonly round: number;
  /** Feld, auf dem gebaut wurde. */
  readonly built: string | null;
  readonly bought: boolean;
  readonly moved: boolean;
  readonly traded: boolean;
  /** Der Server hat die Befehle angenommen. */
  readonly submitted: boolean;
}

/**
 * Chrome auf dem iPhone quer (ADR-068): Seine Leiste verdeckt einen Teil des Bildschirms, die
 * Medienabfragen sehen ihn trotzdem ganz. Macht die Bühne so lange 70 Punkte niedriger als das
 * Fenster: Sie meldet `data-low`, das Blatt rückt zusammen, und `inSight` muss weiter gelten. Mit
 * der Medienabfrage von vorher fehlte dann die Zeile „Ziehen“. Danach steht die Karte genau wie
 * vorher; was dazwischen war, zählt für „die Karte stand die ganze Partie an derselben Stelle“
 * nicht mit.
 */
async function underBar(page: Page, inSight: () => Promise<void>): Promise<void> {
  const quick = { timeout: 2_000 };
  const screen = page.getByTestId('match-screen');
  const board = page.getByTestId('match-board');
  const placeOf = () =>
    board.evaluate((svg) => {
      const rect = svg.getBoundingClientRect();
      return [
        ...[rect.x, rect.y, rect.width, rect.height].map(Math.round),
        svg.getAttribute('viewBox'),
      ].join(' ');
    });
  const place = await placeOf();
  const places = (await seenBy(page)).frames.length;
  const bar = await page.addStyleTag({
    content: 'html.match-playing{--u:0.9412px !important}.stage{inset:0 0 70px 0 !important}',
  });
  await expect(screen).toHaveAttribute('data-low', 'true', quick);
  await inSight();
  await bar.evaluate((style) => (style as HTMLStyleElement).remove());
  await expect(screen).not.toHaveAttribute('data-low', 'true', quick);
  await inSight();
  await expect.poll(placeOf, quick).toBe(place);
  await page.evaluate((count) => {
    (window as unknown as { seen: Seen }).seen.frames.length = count;
  }, places);
}

/**
 * Eine Rüstzeit: Runde 1 baut auf einem freien eigenen Feld (einmal gestrichen und neu befohlen)
 * und kauft eine Armee in der Burg; Runde 2 tauscht und zieht eine Armee aus der Burg auf ein
 * eigenes Nachbarfeld (erst ein falsches Feld, dann das richtige); Runde 3 tippt ein Feld an, das
 * nicht zum eigenen Reich gehört, öffnet „So geht's“ und gibt nichts ab außer „Fertig“; danach wird
 * gebaut, was geht.
 */
async function prepare(
  page: Page,
  matchId: string,
  round: number,
  castleId: number,
): Promise<Prepared> {
  const board = page.getByTestId('match-board');
  const blatt = page.getByTestId('match-prepare');
  const chips = page.getByTestId('prepare-orders').getByRole('listitem');
  const field = page.getByTestId('prepare-field');
  const quick = { timeout: 2_000 };
  let built: string | null = null;
  let bought = false;
  let moved = false;
  let traded = false;

  const castle = board.locator(`.board-region[data-region="${castleId}"]`);
  // In der Rüstzeit lässt sich jedes Feld antippen; die eigenen tragen die Farbe der eigenen Burg
  const mine = await castle.evaluate(
    (g) => [...g.classList].find((name) => name.startsWith('seat-')) ?? '',
  );
  expect(mine).toMatch(/^seat-\d$/);
  const own = board.locator(`.board-region.${mine}`);
  // Die drei festen Zeilen des Blatts: Jede trägt ihren Knopf, oder sie nennt den Grund
  const act = (kind: 'build' | 'buy' | 'move', label: string) =>
    blatt.locator(`[data-act="${kind}"]`).getByRole('button', { name: label, exact: true });
  const build = async () => {
    // Bauen geht auf jedem eigenen Feld unter der höchsten Stufe, solange der Vorrat reicht
    const plain = board.locator(`.board-region.${mine}[aria-label*=", kein Gebäude, "]`);
    for (let i = 0; i < Math.min(await plain.count(), 4) && built === null; i++) {
      const name = ((await plain.nth(i).getAttribute('aria-label')) ?? '').split(':')[0] ?? '';
      await plain.nth(i).tap(quick);
      await expect(field).toContainText(name, quick);
      await expect(page.getByTestId('prepare-acts').getByRole('listitem')).toHaveCount(3, quick);
      const go = act('build', 'Bauen');
      // Reicht der Vorrat nicht, steht statt des Knopfs der Grund da
      if ((await go.count()) === 0) continue;
      await go.tap(quick);
      await expect(act('build', 'Streichen')).toBeVisible(quick);
      built = name;
    }
  };

  if (round === 1) {
    // Vor dem ersten Tipp steht, was die Runde einbringt
    await expect(page.getByTestId('prepare-idle')).toContainText('Einkommen', quick);
    await expect(blatt).toContainText('Noch keine Befehle', quick);
    // Auch ohne gewähltes Feld stehen die drei Zeilen da, und die eigenen Felder leuchten auf
    await expect(page.getByTestId('prepare-acts').getByRole('listitem')).toHaveCount(3, quick);
    // Keine der drei Zeilen liegt unter dem Rand des Blatts, und „Fertig“ ist zu sehen
    const rows = page.getByTestId('prepare-acts').getByRole('listitem');
    const screen = page.getByTestId('match-screen');
    const inSight = async () => {
      for (let i = 0; i < 3; i++) {
        await expect(rows.nth(i)).toBeInViewport({ ratio: 0.95, ...quick });
      }
      await expect(blatt.locator('.blatt-go')).toBeInViewport({ ratio: 0.95, ...quick });
    };
    await inSight();
    await expect(screen).not.toHaveAttribute('data-low', 'true', quick);
    await underBar(page, inSight);
    await expect(board.locator('.plan-hint')).toHaveCount(await own.count(), quick);
    // Unter dem Band steht, was läuft und was danach kommt
    const flow = page.getByTestId('match-flow').getByRole('listitem');
    await expect(flow).toHaveText(['Rüsten', 'Aufdecken', 'Angriffe'], quick);
    await expect(page.getByTestId('match-flow').locator('[aria-current="step"]')).toHaveText(
      'Rüsten',
      quick,
    );
    const stock = page.getByTestId('prepare-stock');
    const before = await stock.textContent();
    await build();
    if (built !== null) {
      // Der Vorrat zeigt, was nach dem Befehl bliebe; auf der Karte steht der Bau als Vorschau
      await expect(chips).toHaveCount(1, quick);
      await expect(stock).not.toHaveText(before ?? '', quick);
      await expect(board.locator('.building.ghost')).toHaveCount(1, quick);
      // Ein Feld ist gewählt: Das Aufleuchten ist vorbei
      await expect(board.locator('.plan-hint')).toHaveCount(0, quick);
      // Streichen nimmt den Befehl zurück, der Vorrat ist wieder voll
      await act('build', 'Streichen').tap(quick);
      await expect(blatt).toContainText('Noch keine Befehle', quick);
      await expect(stock).toHaveText(before ?? '', quick);
      await expect(board.locator('.building.ghost')).toHaveCount(0, quick);
      await act('build', 'Bauen').tap(quick);
      await expect(chips).toHaveCount(1, quick);
    }
    // Armeen entstehen nur in der Burg: erst „Kaufen“, danach steht dort der Zähler
    await castle.tap(quick);
    await expect(field).toContainText('Burg', quick);
    // Der gemeldete Zustand (ADR-068): Die Burg ist gewählt, und die Bühne ist niedriger als das
    // Fenster. Auch dann stehen alle drei Zeilen und „Fertig“ im Blatt
    await inSight();
    await underBar(page, inSight);
    const buy = act('buy', 'Kaufen');
    if ((await buy.count()) > 0) {
      await buy.tap(quick);
      bought = true;
      await expect(
        blatt.locator('[data-act="buy"]').getByRole('group', { name: 'Armeen kaufen' }),
      ).toBeVisible(quick);
      await expect(chips).toHaveCount(built === null ? 1 : 2, quick);
      await expect(board.locator('.army-plus')).toHaveCount(1, quick);
    }
  } else if (round === 2) {
    const trade = blatt.getByRole('button', { name: /^Tauschen, \d zu 1$/ });
    await trade.tap(quick);
    await expect(blatt).toContainText('geben, 1 bekommen', quick);
    const give = blatt.locator('[data-trade]').getByRole('button', { name: 'mehr' });
    for (let i = 0; i < (await give.count()) && !traded; i++) {
      if (!(await give.nth(i).isEnabled())) continue;
      await give.nth(i).tap(quick);
      traded = true;
      await expect(chips).toHaveCount(1, quick);
      await expect(chips.first()).toContainText('→', quick);
    }
    await trade.tap(quick);
    // Ziehen in zwei Tipps: Burg antippen, „Ziehen“, dann ein leuchtendes eigenes Nachbarfeld
    const owned = await own.evaluateAll((all) =>
      all.map((g) => Number(g.getAttribute('data-region'))),
    );
    const near = regionNeighbors(MAP, castleId);
    const to = near.find((id) => owned.includes(id));
    await castle.tap(quick);
    await expect(field).toContainText('Burg', quick);
    const go = act('move', 'Ziehen');
    if (to !== undefined && (await go.count()) > 0) {
      await go.tap(quick);
      const where = page.getByTestId('prepare-moving');
      await expect(where).toContainText('Wohin?', quick);
      await expect(where).toContainText('Tippe ein leuchtendes Nachbarfeld an.', quick);
      await expect(board.locator('.plan-target').first()).toBeAttached(quick);
      // Ein Feld, das nicht an der Burg liegt, ist kein Ziel: Das Blatt sagt warum, nichts zieht
      const far = MAP.regions.map((r) => r.id).find((id) => id !== castleId && !near.includes(id));
      if (far !== undefined) {
        await board.locator(`.board-region[data-region="${far}"]`).tap(quick);
        await expect(where).toHaveAttribute('data-refused', /^(FOREIGN|FREE|TOO_FAR)$/, quick);
        await expect(chips).toHaveCount(traded ? 1 : 0, quick);
      }
      await board.locator(`.board-region[data-region="${to}"]`).tap(quick);
      // Eine Armee ist gezogen, „Ziehen“ ist wieder zu, und der Befehl steht in der Zeile unten
      await expect(where).toHaveCount(0, quick);
      await expect(chips).toHaveCount(traded ? 2 : 1, quick);
      await expect(
        page.getByTestId('prepare-orders').getByRole('button', { name: / nach .+ ziehen/ }),
      ).toHaveCount(1, quick);
      moved = true;
    }
  } else if (round === 3) {
    // Ein Feld, das mir nicht gehört, sagt, dass hier jetzt nichts geht und was später geht
    const other = board.locator(`.board-region:not(.${mine})`).first();
    await other.tap(quick);
    await expect(page.getByTestId('prepare-foreign')).toContainText(
      'In der Rüstzeit geht hier nichts.',
      quick,
    );
    // Dazu, ob es im Feldzug ein Ziel wäre: nur neben einer eigenen Armee (ADR-064)
    await expect(page.getByTestId('prepare-foreign')).toHaveAttribute(
      'data-reach',
      /^(TARGET|NO_ARMY|FAR)$/,
      quick,
    );
    // „?“ öffnet „So geht's“ auch während der Rüstzeit; an der Tastatur schließt es Escape
    await page.getByTestId('match-help-open').tap(quick);
    await expect(page.getByTestId('match-help').locator('.help-card')).toHaveCount(4, quick);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('match-help')).toHaveCount(0, quick);
  } else if (round > 3) {
    await build();
  }

  const ok = accepted(page, matchId, 'orders', 5_000);
  await blatt.getByRole('button', { name: 'Fertig' }).tap(quick);
  return { round, built, bought, moved, traded, submitted: await ok };
}

test('Partie mit Ausbau am Handy quer: Lieblingskategorien, Rüstzeit, Glücksrad und Angriff bis zur Abrechnung', async ({
  browser,
}, testInfo) => {
  test.setTimeout(330_000);
  const page = await newPlayer(browser, { viewport: ACROSS, hasTouch: true, isMobile: true });
  await recordSeen(page);

  // Spielart wählen und eine Testpartie zu dritt mit kurzen Zeiten eröffnen
  await page
    .getByTestId('match-mode')
    .getByLabel(/^Mit Ausbau/)
    .check();
  const setup = page.getByTestId('test-match');
  await setup.getByLabel('Zu dritt').check();
  await setup.getByLabel('Bot 1').selectOption('EASY');
  await setup.getByLabel('Bot 2').selectOption('HARD');
  await setup.getByLabel(/^Kurze Zeiten/).check();
  await setup.getByRole('button', { name: 'Testpartie eröffnen' }).tap();
  await expect(page).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  const matchId = matchIdOf(page);
  const screen = page.getByTestId('match-screen');
  await expect(screen).toHaveAttribute('data-mode', 'REALM');
  await expect(screen).toHaveAttribute('data-state', 'lobby');

  // Vor der ersten Partie öffnet sich „So geht's“ von selbst: vier Bilder, „Alles klar“ schließt es
  const help = page.getByTestId('match-help');
  await expect(help).toBeVisible();
  await expect(help.locator('.help-card')).toHaveCount(4);
  await expect(help).toContainText('Wer nach 5 Runden die meisten Punkte hat, gewinnt.');
  await page.getByTestId('match-help-close').tap();
  await expect(help).toHaveCount(0);

  // Aufstellung: erst die Lieblingskategorien; die Wahl gilt, sobald alle vier stehen
  const favorites = page.getByTestId('match-favorites');
  await expect(favorites).toContainText('Deine Lieblingskategorien');
  // Darunter das Ziel in einem Satz; der Knopf daneben holt „So geht's“ zurück
  await expect(favorites).toContainText('Ziel: nach 5 Runden die meisten Punkte.');
  await page.getByTestId('lobby-help').tap();
  await expect(help).toBeVisible();
  await page.getByTestId('match-help-close').tap();
  await expect(help).toHaveCount(0);
  const count = page.getByTestId('fav-count');
  await expect(count).toHaveText('0 von 4 gewählt');
  const open = favorites.locator('.fav[data-available="true"]');
  expect(await open.count()).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < 3; i++) await open.nth(i).tap();
  await expect(count).toHaveText('3 von 4 gewählt');
  // Scheitert das Speichern, steht die Wahl nicht als gewählt da und lässt sich noch einmal speichern
  const mine = favorites.getByTestId('fav-seat');
  const toFavorites = (url: URL) => url.pathname.endsWith(`/matches/${matchId}/favorites`);
  const cut = (route: Route) => route.abort('connectionfailed');
  await page.route(toFavorites, cut);
  await open.nth(3).tap();
  await expect(count).toHaveText('4 von 4 gewählt');
  await expect(mine).toContainText('nicht gespeichert');
  await expect(count).not.toHaveClass(/full/);
  await expect(page.getByTestId('fav-failed')).toContainText(
    'Deine Wahl ist noch nicht gespeichert.',
  );
  await page.unroute(toFavorites, cut);
  const saved = accepted(page, matchId, 'favorites', 5_000);
  await page.getByTestId('fav-retry').tap();
  expect(await saved).toBe(true);
  await expect(page.getByTestId('fav-failed')).toHaveCount(0);
  // Mehr als vier gehen nicht; eine abwählen und eine andere nehmen geht
  await expect(open.nth(4)).toBeDisabled();
  await expect(favorites.locator('.fav.on')).toHaveCount(4);
  await expect(mine).toHaveCount(1);
  // „Gewählt“ steht beim eigenen Namen erst, wenn der Server die Wahl bestätigt hat
  await expect(mine).toContainText('4 gewählt');
  await expect(count).toHaveClass(/full/);
  // Zweites Blatt: Mitspieler, Einladungscode und Bots wie in der Partie ohne Ausbau
  await page.getByTestId('lobby-to-seats').tap();
  await expect(page.getByTestId('invite-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.getByTestId('match-lobby')).toContainText(
    '2 freie Plätze gehen beim Start an Bots.',
  );
  await page.getByTestId('lobby-to-favorites').tap();
  await expect(favorites.locator('.fav.on')).toHaveCount(4);
  await favorites.getByRole('button', { name: 'Partie starten' }).tap();

  // Die Karte steht im Vollbild; links die Reiche mit Vorrat, im Band der Abschnitt
  const board = page.getByTestId('match-board');
  await expect(board).toBeVisible();
  await expect(board.locator('.board-region')).toHaveCount(24);
  const seats = page.getByTestId('match-seats');
  await expect(seats.getByRole('listitem')).toHaveCount(3);
  await expect(seats).toContainText('Bot (leicht)');
  await expect(seats).toContainText('Bot (schwer)');
  await expect(page.getByTestId('match-step')).toHaveText('Startfrage');
  // Unter dem Band steht der Ablauf der Eröffnung
  await expect(page.getByTestId('match-flow').getByRole('listitem')).toHaveText([
    'Burg',
    'Dorf',
    'Landnahme',
  ]);
  // Ein zweites Mal öffnet sich „So geht's“ auf diesem Gerät nicht von selbst
  expect(await page.evaluate(() => localStorage.getItem('rdw.help.realm'))).toBe('seen');

  /** Bühne in einem Zug gelesen, damit Zustand, Schritt und Frage zusammenpassen. */
  const read = () =>
    page.evaluate(() => {
      const main = document.querySelector('[data-testid="match-screen"]');
      return {
        state: main?.getAttribute('data-state') ?? '',
        step: main?.getAttribute('data-step') ?? '',
        seq: Number(main?.getAttribute('data-seq') ?? 0),
        label: document.querySelector('[data-testid="match-step"]')?.textContent ?? '',
      };
    });

  const answered = new Set<number>();
  let castleId: number | null = null;
  const picks = new Map<string, number>();
  const attacks: Attack[] = [];
  const labels = new Set<string>();
  const prepared = new Map<number, Prepared>();
  const until = Date.now() + 270_000;
  for (;;) {
    if (Date.now() > until) throw new Error('Die Partie endet nicht rechtzeitig');
    const { state, step, seq, label } = await read();
    labels.add(label);
    if (state === 'finished') break;
    if (state === 'abandoned') throw new Error('Die Partie wurde abgebrochen');
    if (state === 'question' && !answered.has(seq)) {
      if (await answerRight(page, matchId, seq, 'tap')) answered.add(seq);
    } else if (state === 'pick' && step === 'CAMPAIGN_TARGET') {
      // Einmal ein freies Feld, danach fremde: So kommen beide Arten des Angriffs vor
      const attack = await attackFirst(page, matchId, !attacks.some((a) => a.free));
      if (attack) attacks.push(attack);
    } else if (state === 'pick') {
      const picked = await pickNear(page, matchId, step === 'CASTLE_PICK' ? null : castleId);
      if (picked !== null) {
        picks.set(step, (picks.get(step) ?? 0) + 1);
        if (step === 'CASTLE_PICK') castleId = picked;
      }
    } else if (state === 'prepare' && castleId !== null) {
      const round = Number(/^Runde (\d) von 5$/.exec(label)?.[1] ?? 0);
      if (round > 0 && !prepared.has(round)) {
        prepared.set(round, await prepare(page, matchId, round, castleId));
      }
    }
    await page.waitForTimeout(100);
  }

  // Aufbau: eine Burg und ein Dorf gesetzt, in der Landnahme mitgewählt; Startfrage und
  // Schätzfragen auf dem Ziffernfeld beantwortet
  expect(picks.get('CASTLE_PICK')).toBe(1);
  expect(picks.get('VILLAGE_PICK')).toBe(1);
  expect(picks.get('LAND_PICK') ?? 0).toBeGreaterThan(0);
  // Die Landnahme endet nach zwei Runden (ADR-062): höchstens zwei Wahlen je Runde, und im Band
  // steht, die wievielte Runde läuft
  expect(picks.get('LAND_PICK') ?? 0).toBeLessThanOrEqual(4);
  const land = [...labels].filter((l) => l.startsWith('Landnahme')).sort();
  expect(land).toEqual(['Landnahme · 1 von 2', 'Landnahme · 2 von 2']);
  expect(answered.size).toBeGreaterThan(5);

  // Jede Runde beginnt mit einer Rüstzeit; der Server hat jede Abgabe angenommen. Fünf Runden sind
  // es, solange nicht vorher nur noch ein Reich steht
  const rounds = prepared.size;
  expect(rounds).toBeGreaterThanOrEqual(3);
  expect([...prepared.keys()]).toEqual(Array.from({ length: rounds }, (_, i) => i + 1));
  expect([...prepared.values()].every((p) => p.submitted)).toBe(true);
  const [first, second] = [prepared.get(1), prepared.get(2)];
  expect(first?.built).not.toBeNull();
  expect(first?.bought).toBe(true);
  expect(second?.traded).toBe(true);
  expect(second?.moved).toBe(true);

  const seen = await seenBy(page);
  // Schlägt eine Prüfung fehl, liegt der Mitschnitt bei den Testergebnissen
  await testInfo.attach('gezeigt.json', {
    body: JSON.stringify({ seen, prepared: [...prepared.values()], attacks }, null, 2),
    contentType: 'application/json',
  });
  // Aufgedeckt: je Runde eine Zeile für jedes Reich, das noch steht; beim eigenen steht, was
  // befohlen wurde
  expect(Object.keys(seen.orders)).toHaveLength(rounds);
  for (const shown of Object.values(seen.orders)) {
    expect(shown.rows).toBe(shown.alive);
    expect(shown.rows).toBeGreaterThanOrEqual(2);
  }
  expect(seen.orders['Runde 1 von 5']?.mine).toContain(`Dorf in ${first?.built}`);
  expect(seen.orders['Runde 1 von 5']?.mine).toContain('1 gekauft');
  expect(seen.orders['Runde 2 von 5']?.mine).toContain('1 gezogen');
  expect(seen.orders['Runde 2 von 5']?.mine).toContain('1 mal getauscht');
  expect(seen.orders['Runde 3 von 5']?.mine).toContain('rüstet nicht');

  // Angriff in zwei Schritten: Vor „Angreifen“ standen das Ziel und die Lose im Rad, gegen ein
  // Reich die beider Seiten und die freien, gegen ein freies Feld nur die eigenen und die freien
  expect(attacks.length).toBeGreaterThan(0);
  expect(attacks.every((a) => a.lots === (a.free ? 2 : 3))).toBe(true);
  // Angriff nur mit Armee (ADR-064): Ein Feld ohne eigene Armee daneben nannte den Grund
  expect(attacks.some((a) => a.refused !== null)).toBe(true);
  // Nach zwei Runden Landnahme ist die halbe Karte frei: Ein freies Feld liegt am eigenen Land
  expect(attacks.filter((a) => a.free)).toHaveLength(1);

  // Glücksrad vor jeder Wissensfrage eines Duells: die Scheibe mitten auf der Karte, im Blatt die
  // Lose und am Ende die Kategorie
  expect(seen.wheels.length).toBeGreaterThanOrEqual(attacks.length);
  expect(seen.wheels.every((w) => w.disc && w.segments > 0)).toBe(true);
  expect(seen.wheels.every((w) => w.text.includes('Lose im Rad'))).toBe(true);
  expect(seen.wheels.filter((w) => w.category !== null).length).toBeGreaterThan(0);

  // Ausgang jedes Duells im Blatt, auf der Karte ein Zeichen am Feld
  expect(seen.outcomes.length).toBeGreaterThanOrEqual(attacks.length);
  for (const outcome of seen.outcomes) {
    expect(outcome.effect).toMatch(
      /^(CONQUERED|BUILDING_DAMAGED|CASTLE_HIT|CASTLE_DESTROYED|TAKEOVER|FORTIFIED|CLAIMED|UNCLAIMED)$/,
    );
    expect(outcome.text.length).toBeGreaterThan(20);
    expect(outcome.sign).toBe(true);
  }
  // Wer richtig antwortet, gewinnt als Angreifer mindestens ein Duell
  expect(seen.outcomes.some((o) => !['FORTIFIED', 'UNCLAIMED'].includes(o.effect))).toBe(true);
  // Das freie Feld: allein gefragt, richtig geantwortet, genommen
  const claimed = seen.outcomes.filter((o) => o.effect === 'CLAIMED');
  expect(claimed.some((o) => o.text.includes('Feld genommen'))).toBe(true);

  // Wer schon geantwortet hat: je Sitz der Frage eine Zeile, bei einem freien Feld nur die des
  // Angreifers; die eigene Antwort zählt sofort
  expect(seen.answers.length).toBeGreaterThan(0);
  expect(seen.answers.every((a) => a.rows >= 1 && a.rows <= 3)).toBe(true);
  expect(seen.answers.some((a) => a.rows === 1)).toBe(true);
  expect(seen.answers.some((a) => a.mine)).toBe(true);
  expect(seen.answers.some((a) => !a.mine)).toBe(true);

  // Fragen, an denen nur Bots gefragt sind, stehen für ihre Bedenkzeit offen (O-43): Wer zuschaut,
  // liest sie mit, ohne etwas antippen zu können
  expect(seen.watched.length).toBeGreaterThan(0);
  for (const card of seen.watched) {
    expect(card.text).toContain('Du schaust zu');
    expect(card.buttons).toBe(0);
    expect(card.options).toBe(card.kind === 'TRIVIA' ? 4 : 0);
    expect(card.sheet).toContain('Wer was gewählt hat, zeigt die Auflösung.');
  }

  // Jede Phase kam vor, in der Reihenfolge der Regeln
  const states = seen.states.map((s) => s.split(':')[0]);
  expect(states).toEqual(
    expect.arrayContaining([
      'lobby',
      'question',
      'pick',
      'prepare',
      'orders',
      'wheel',
      'reveal',
      'finished',
    ]),
  );
  const firstOf = (entry: string) => seen.states.findIndex((s) => s.startsWith(entry));
  expect(firstOf('question:START_ESTIMATE')).toBeGreaterThan(-1);
  expect(firstOf('pick:CASTLE_PICK')).toBeGreaterThan(firstOf('question:START_ESTIMATE'));
  expect(firstOf('pick:VILLAGE_PICK')).toBeGreaterThan(firstOf('pick:CASTLE_PICK'));
  expect(firstOf('prepare:PREPARE')).toBeGreaterThan(firstOf('pick:VILLAGE_PICK'));
  expect(firstOf('orders:')).toBeGreaterThan(firstOf('prepare:PREPARE'));
  expect(firstOf('wheel:DUEL_TRIVIA')).toBeGreaterThan(firstOf('orders:'));

  // Ein fester Bildschirm: Nichts scrollt, und die Karte stand die ganze Partie an derselben Stelle
  expect(seen.scroll).toBeLessThanOrEqual(0);
  expect(seen.frames).toHaveLength(1);

  // Abrechnung mitten auf der Karte
  const result = page.getByTestId('match-result');
  await expect(result.locator('tbody tr')).toHaveCount(3);
  await expect(result).toContainText('(du)');
  await expect(result).toContainText('Burgen');
  await expect(result).toContainText('Testpartie: Sie zählt nicht in der Statistik.');
  await expect(page.getByTestId('match-step')).toHaveText('Abrechnung');
  await result.getByRole('button', { name: 'Neue Partie' }).tap();
  await expect(page).toHaveURL(/\/partie$/);
  await page.context().close();
});
