import { matchMap, regionNeighbors } from '@rdw/game-core';
import { expect, test, type Page, type Route } from '@playwright/test';
import { closeAnswerDb } from './answers.ts';
import { answerRight, matchIdOf, newPlayer, succeeds } from './match-kit.ts';

/**
 * Partie mit Ausbau im Browser (MATCH_RULES §11, ADR-060, TEST_PLAN §5): eine ganze Testpartie am
 * quer gehaltenen Handy gegen zwei Bots, mit Spieltestzeiten. Der Spieler wählt seine
 * Lieblingskategorien, setzt Burg und Dorf, baut, kauft, zieht und tauscht in der Rüstzeit, greift
 * in zwei Schritten an (Ziel antippen, dann „Angreifen“) und antwortet richtig; die Lösung liest nur
 * der Test aus der Datenbank. Die Landnahme endet nach zwei Runden; der erste eigene Angriff geht
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
    };
    (window as unknown as { seen: Seen }).seen = seen;
    let key = '';
    let outcomeSeq = '';
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
      if (board) {
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
}

/**
 * Greift ein markiertes Feld an: mit `free` ein freies, wenn eines am eigenen Land liegt, sonst
 * ein fremdes, lieber eines ohne Burg, damit alle drei Reiche lange im Spiel bleiben. Der erste
 * Tipp zeigt nur das Ziel mit den Losen im Glücksrad; an den Server geht die Wahl erst mit
 * „Angreifen“.
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
    const open = board.locator('.board-region.legal.free');
    const plain = board.locator('.board-region.legal:not(.free):not(.capital)');
    const owned = board.locator('.board-region.legal:not(.free)');
    let field = board.getByRole('button').first();
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
    const shown = await target.locator('.feld-name').textContent();
    const lots = await page.getByTestId('match-lots').locator('.lot').count();
    expect(shown).toBe(name);
    expect(sent).toBe(0);
    // Ein freies Feld steht als solches im Blatt: Niemand verteidigt es
    expect((await target.getAttribute('data-free')) !== null).toBe(unowned);
    if (unowned)
      await expect(page.getByTestId('match-pick')).toContainText(
        'Freies Feld, niemand verteidigt es',
      );
    const ok = accepted(page, matchId, 'pick');
    const attack = page.getByTestId('match-pick').getByRole('button', { name: 'Angreifen' });
    if (!(await succeeds(attack.tap({ timeout: 2_000 }))) || !(await ok)) return null;
    return { target: name, lots, free: unowned };
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
 * Eine Rüstzeit: Runde 1 baut auf einem freien eigenen Feld (einmal gestrichen und neu befohlen)
 * und kauft eine Armee in der Burg; Runde 2 tauscht und zieht eine Armee aus der Burg auf ein
 * eigenes Nachbarfeld; Runde 3 gibt nichts ab außer „Fertig“; danach wird gebaut, was geht.
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
  const build = async () => {
    // Bauen geht auf jedem eigenen Feld unter der höchsten Stufe, solange der Vorrat reicht
    const plain = board.getByRole('button', { name: /, kein Gebäude, / });
    for (let i = 0; i < Math.min(await plain.count(), 4) && built === null; i++) {
      const name = ((await plain.nth(i).getAttribute('aria-label')) ?? '').split(':')[0] ?? '';
      await plain.nth(i).tap(quick);
      await expect(field).toContainText(name, quick);
      const go = blatt.getByRole('button', { name: 'Bauen', exact: true }).last();
      if (!(await go.isEnabled())) continue;
      await go.tap(quick);
      await expect(blatt.getByRole('button', { name: 'Streichen' })).toBeVisible(quick);
      built = name;
    }
  };

  if (round === 1) {
    // Vor dem ersten Tipp steht, was die Runde einbringt
    await expect(blatt).toContainText('Einkommen', quick);
    await expect(blatt).toContainText('Noch keine Befehle', quick);
    const stock = page.getByTestId('prepare-stock');
    const before = await stock.textContent();
    await build();
    if (built !== null) {
      // Der Vorrat zeigt, was nach dem Befehl bliebe; auf der Karte steht der Bau als Vorschau
      await expect(chips).toHaveCount(1, quick);
      await expect(stock).not.toHaveText(before ?? '', quick);
      await expect(board.locator('.building.ghost')).toHaveCount(1, quick);
      // Streichen nimmt den Befehl zurück, der Vorrat ist wieder voll
      await blatt.getByRole('button', { name: 'Streichen' }).tap(quick);
      await expect(blatt).toContainText('Noch keine Befehle', quick);
      await expect(stock).toHaveText(before ?? '', quick);
      await expect(board.locator('.building.ghost')).toHaveCount(0, quick);
      await blatt.getByRole('button', { name: 'Bauen', exact: true }).last().tap(quick);
      await expect(chips).toHaveCount(1, quick);
    }
    // Armeen entstehen nur in der Burg
    await castle.tap(quick);
    await expect(field).toContainText('Burg', quick);
    await blatt.locator('[data-tab="buy"]').tap(quick);
    const more = blatt.getByRole('group', { name: 'Kaufen' }).getByRole('button', { name: 'mehr' });
    if (await more.isEnabled()) {
      await more.tap(quick);
      bought = true;
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
    // Ziehen: Burg antippen, „Ziehen“, dann ein markiertes eigenes Nachbarfeld
    const own = await board
      .getByRole('button')
      .evaluateAll((all) => all.map((g) => Number(g.getAttribute('data-region'))));
    const to = regionNeighbors(MAP, castleId).find((id) => own.includes(id));
    await castle.tap(quick);
    const segment = blatt.locator('[data-tab="move"]');
    if (to !== undefined && (await segment.isEnabled())) {
      await segment.tap(quick);
      await expect(blatt).toContainText('Tippe ein markiertes Nachbarfeld an.', quick);
      await expect(board.locator('.plan-target').first()).toBeAttached(quick);
      await board.locator(`.board-region[data-region="${to}"]`).tap(quick);
      await expect(field).toContainText(' nach ', quick);
      await expect(chips).toHaveCount(traded ? 2 : 1, quick);
      moved = true;
    }
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

  // Aufstellung: erst die Lieblingskategorien; die Wahl gilt, sobald alle vier stehen
  const favorites = page.getByTestId('match-favorites');
  await expect(favorites).toContainText('Deine Lieblingskategorien');
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
