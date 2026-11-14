import { expect, test, type Page } from '@playwright/test';
import { closeAnswerDb, testDb } from './answers.ts';
import { answerRight, matchIdOf, newPlayer, pickFirst, succeeds } from './match-kit.ts';

/**
 * Partie im Browser (Abnahme M4, TEST_PLAN §5): eine ganze Testpartie zu dritt gegen zwei Bots,
 * eine normale Partie am quer gehaltenen Handy allein mit Bots aus der Aufstellung (ADR-052,
 * ADR-059), der Einladungslink, eine normale Partie zu zweit in zwei Browser-Kontexten und eine
 * zu zweit mit einem Bot, in der jeder dem anderen zuschaut (ADR-065), die Partien mit
 * Spieltestzeiten.
 * Jeder Spieler wählt die erste markierte Region und antwortet richtig; die Lösung liest nur der
 * Test aus der Datenbank. Ansagen und Auflösungen (ADR-053) stehen nur kurz: Die Seite schreibt
 * selbst mit, was sie gezeigt hat. Die Ablaufsteuerung läuft im Testserver wie im api-Prozess.
 */

test.afterAll(async () => {
  await closeAnswerDb();
});

/** Was die Seite in einer Ansage oder Auflösung gezeigt hat (ADR-053, ADR-055, ADR-069). */
interface Shown {
  /**
   * `reveal`: das Blatt mit den Antworten. Hat die Frage ein Duell entschieden, folgen `outcome`
   * (die Karte spielt den Ausgang) und `settled` (das Ergebnis steht).
   */
  readonly state: 'announce' | 'reveal' | 'outcome' | 'settled';
  readonly text: string;
  /** Ansage eines Duells (sonst: eine gezeigte Wahl). */
  readonly duel: boolean;
  /** Hervorhebung auf der Karte: Ring um die gewählte Region. */
  readonly ring: boolean;
  /** Szene des Duells auf der Karte, falls eines steht. */
  readonly scene: string | null;
  /** Aufstellung auf der Karte: Wappen des Angreifers und Pfeil zum Ziel. */
  readonly arrow: boolean;
  /** Plättchen mit Wappen: an den Antworten der Auflösung oder in der Ansage. */
  readonly chips: number;
  /** Das Band „Du bist dran!“ steht noch über der Karte. */
  readonly turnBanner: boolean;
  /** Auflösung einer Wissensfrage mit markierter richtiger Antwort. */
  readonly correctOption: boolean;
  /** Abschnitt im Band der Kopfzeile. */
  readonly step: string;
  /** Die Zugfolge steht, und alle waren schon dran: so nur nach dem letzten Duell der Partie. */
  readonly allDone: boolean;
}

/**
 * Lässt die Seite jede Ansage und jede Auflösung mitschreiben, sobald sie erscheint. Mit
 * Spieltestzeiten stehen sie nur Bruchteile einer Sekunde, zu kurz für eine Abfrage von außen.
 */
async function recordShown(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Shown[] = [];
    (window as unknown as { shown: Shown[] }).shown = seen;
    const note = () => {
      const screen = document.querySelector('[data-testid="match-screen"]');
      const state = screen?.getAttribute('data-state');
      if (state !== 'announce' && state !== 'reveal') return;
      // Erst das Blatt mit den Antworten, dann sagt das Blatt rechts den Ausgang eines Duells
      // (ADR-069): Welcher Takt läuft, sagt die Bühne
      const beat = state === 'reveal' ? screen?.getAttribute('data-beat') : null;
      const answers = document.querySelector('[data-testid="match-reveal"]');
      const outcome =
        beat === 'outcome' || (beat === 'settled' && !answers)
          ? document.querySelector('[data-testid="match-outcome"]')
          : null;
      const card =
        outcome ??
        (state === 'announce' ? document.querySelector('[data-testid="match-announce"]') : answers);
      if (!card) return;
      // Ohne die ablaufende Zeit: Ihr Text zählt die Sekunden herunter, während das Blatt steht.
      // Mit ihm stünde dasselbe Blatt mehrfach in der Liste, sobald eine Sekunde umspringt.
      const still = card.cloneNode(true) as Element;
      for (const timer of still.querySelectorAll('[role="timer"]')) timer.remove();
      const entry: Shown = {
        state: outcome ? (beat === 'settled' ? 'settled' : 'outcome') : state,
        text: still.textContent ?? '',
        duel: card.classList.contains('announce-duel'),
        ring: document.querySelector('.spot-ring') !== null,
        scene:
          document.querySelector('[data-testid="match-board"]')?.getAttribute('data-duel') ?? null,
        arrow:
          document.querySelector('.duel-stage .duel-token.attacker') !== null &&
          document.querySelector('.duel-stage .duel-arrow') !== null,
        chips: card.querySelectorAll('.seat-chip').length,
        turnBanner: document.querySelector('.turn-banner.moment-gold') !== null,
        correctOption: card.querySelector('.reveal-option.correct') !== null,
        step: document.querySelector('[data-testid="match-step"]')?.textContent ?? '',
        allDone:
          document.querySelector('[data-testid="match-turns"] li') !== null &&
          document.querySelector('[data-testid="match-turns"] li:not([data-status="DONE"])') ===
            null,
      };
      const last = seen.at(-1);
      if (last?.state === entry.state && last.text === entry.text) seen[seen.length - 1] = entry;
      else seen.push(entry);
    };
    new MutationObserver(note).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-beat'],
    });
  });
}

function shownBy(page: Page): Promise<Shown[]> {
  return page.evaluate(() => (window as unknown as { shown?: Shown[] }).shown ?? []);
}

interface Played {
  readonly picks: number;
  readonly answers: number;
  readonly reveals: number;
}

/**
 * Spielt bis zur Abrechnung: wählt, wenn eigene Regionen markiert sind, und beantwortet jede
 * eigene Frage richtig. Mit `reloadOnce` lädt der Spieler die Seite bei der ersten Frage neu und
 * bekommt dieselbe Frage mit dem Hinweis, dass jetzt die Serverzeit zählt.
 */
async function playToEnd(page: Page, options: { reloadOnce?: boolean } = {}): Promise<Played> {
  const matchId = matchIdOf(page);
  const screen = page.getByTestId('match-screen');
  const answered = new Set<number>();
  const revealed = new Set<number>();
  let picks = 0;
  let reload = options.reloadOnce ?? false;
  const until = Date.now() + 200_000;
  for (;;) {
    if (Date.now() > until) throw new Error('Die Partie endet nicht rechtzeitig');
    const state = await screen.getAttribute('data-state');
    const seq = Number((await screen.getAttribute('data-seq')) ?? 0);
    if (state === 'finished') break;
    if (state === 'abandoned') throw new Error('Die Partie wurde abgebrochen');
    if (state === 'pick') {
      if (await pickFirst(page, matchId, 'click')) picks += 1;
    } else if (state === 'question' && !answered.has(seq)) {
      const question = page.getByTestId('match-question');
      if (reload) {
        reload = false;
        await page.reload();
        await expect(question).toBeVisible();
        await expect(question).toContainText('Die Seite wurde neu geladen');
      }
      if (await answerRight(page, matchId, seq)) answered.add(seq);
    } else if (state === 'reveal' && !revealed.has(seq)) {
      // Die Auflösung steht nur kurz; ohne Warten zählen, ob sie zu sehen war
      const text = await page
        .getByTestId('match-reveal')
        .textContent({ timeout: 500 })
        .catch(() => null);
      if (text?.includes('Auflösung')) revealed.add(seq);
    }
    await page.waitForTimeout(100);
  }
  return { picks, answers: answered.size, reveals: revealed.size };
}

async function statistics(page: Page) {
  const matchId = matchIdOf(page);
  return testDb()
    .selectFrom('match_players as p')
    .innerJoin('player_statistics as s', 's.user_id', 'p.user_id')
    .select(['p.seat', 's.matches_played', 's.matches_won'])
    .where('p.match_id', '=', matchId)
    .orderBy('p.seat')
    .execute();
}

test('Partie: ganze Testpartie zu dritt gegen zwei Bots', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await newPlayer(browser);
  await recordShown(page);
  const setup = page.getByTestId('test-match');
  await setup.getByLabel('Zu dritt').check();
  await setup.getByLabel('Bot 1').selectOption('EASY');
  await setup.getByLabel('Bot 2').selectOption('HARD');
  await setup.getByLabel(/^Kurze Zeiten/).check();
  await setup.getByRole('button', { name: 'Testpartie eröffnen' }).click();
  await expect(page).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);

  const lobby = page.getByTestId('match-lobby');
  await expect(lobby).toContainText('2 freie Plätze gehen beim Start an Bots.');
  await expect(page.getByTestId('invite-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await lobby.getByRole('button', { name: 'Partie starten' }).click();

  await expect(page.getByTestId('match-board')).toBeVisible();
  const seats = page.getByTestId('match-seats');
  await expect(seats.getByRole('listitem')).toHaveCount(3);
  await expect(seats).toContainText('Bot (leicht)');
  await expect(seats).toContainText('Bot (schwer)');
  await expect(page.getByTestId('match-step')).toHaveText('Hauptstadtwahl');
  // Zu dritt auf der ganzen Wendelmark; die Zugfolge nennt alle drei
  await expect(page.getByTestId('match-board')).toHaveAttribute('aria-label', 'Karte: Wendelmark');
  await expect(page.getByTestId('match-board').locator('.board-region')).toHaveCount(24);
  const turns = page.getByTestId('match-turns');
  await expect(turns).toContainText('Hauptstadt wählen');
  await expect(turns.getByRole('listitem')).toHaveCount(3);

  const played = await playToEnd(page, { reloadOnce: true });
  expect(played.picks).toBeGreaterThan(0);
  expect(played.answers).toBeGreaterThan(0);
  expect(played.reveals).toBeGreaterThan(0);

  // Ansagen (ADR-053): Die Wahl eines Bots bleibt mit einem Ring auf der Karte stehen; vor jedem
  // Duell steht, wer wen wo angreift, und auf der Karte stehen Wappen und Pfeil (ADR-054)
  const shown = await shownBy(page);
  const picksShown = shown.filter((s) => s.state === 'announce' && !s.duel);
  expect(picksShown.length).toBeGreaterThan(3);
  expect(picksShown.every((s) => s.ring && !s.arrow)).toBe(true);
  expect(picksShown.some((s) => /^Bot \((leicht|schwer)\) (nimmt|wählt) /.test(s.text))).toBe(true);
  // „Du bist dran!“ gilt nur der eigenen Wahl: In keiner Ansage steht es noch über der Karte
  expect(shown.filter((s) => s.state === 'announce' && s.turnBanner)).toEqual([]);
  const duels = shown.filter((s) => s.state === 'announce' && s.duel);
  expect(duels.length).toBeGreaterThan(3);
  for (const duel of duels) {
    expect(duel.text).toMatch(/(angegriffen!|Angriff auf )/);
    expect(duel.text).toMatch(/ greift .+ an\./);
    expect(duel).toMatchObject({ scene: 'announce', arrow: true, ring: false, chips: 2 });
  }
  // Auflösung eines Duells (ADR-069): Erst stehen die Antworten, und die Karte zeigt das Duell
  // noch wie in der Frage. Danach spielt sie den Ausgang, mit einem Satz im Blatt
  const outcomes = shown.filter((s) => s.state === 'outcome');
  expect(outcomes.length).toBeGreaterThan(0);
  for (const outcome of outcomes) {
    expect(outcome.scene).toBe('outcome');
    expect(outcome.text).toMatch(/(erober|verlierst|triff|getroffen|nimm|fällt|scheitert|hält)/);
    expect(shown[shown.indexOf(outcome) - 1]).toMatchObject({ state: 'reveal', scene: 'duel' });
  }
  // Danach steht das Ergebnis, bis es weitergeht
  const settled = shown.filter((s) => s.state === 'settled');
  expect(settled.length).toBeGreaterThan(0);
  for (const result of settled) {
    expect(result.scene).toBe('settled');
    expect(shown[shown.indexOf(result) - 1]).toMatchObject({ state: 'outcome', text: result.text });
  }
  // Letztes Duell (ADR-055): Auch seine Auflösung steht ganz, erst die Antworten, dann der Ausgang.
  // Band und Zugfolge der letzten Runde bleiben so lange stehen; die Abrechnung kommt danach.
  const lastAt = shown.map((s) => s.state).lastIndexOf('outcome');
  const lastReveal = shown[lastAt - 1];
  const lastOutcome = shown[lastAt];
  expect(lastReveal).toMatchObject({ state: 'reveal', scene: 'duel', allDone: false });
  expect(lastOutcome).toMatchObject({ state: 'outcome', scene: 'outcome', allDone: true });
  expect(lastOutcome?.step).toMatch(/^Feldzug · Runde \d von 4$/);
  expect(lastReveal?.step).toBe(lastOutcome?.step);
  // Die Zugfolge ist erst mit dem Ausgang abgehakt, nicht schon mit den Antworten
  expect(shown.findIndex((s) => s.allDone)).toBe(lastAt);
  expect(shown.slice(lastAt + 1).every((s) => s.state === 'settled' && s.allDone)).toBe(true);
  // Auflösungen: Jeder Sitz der Frage steht mit seinem Wappen an seiner Antwort
  const reveals = shown.filter((s) => s.state === 'reveal');
  expect(reveals.length).toBeGreaterThan(5);
  expect(reveals.every((s) => s.chips >= 2 && s.chips <= 3)).toBe(true);
  expect(reveals.some((s) => s.correctOption)).toBe(true);
  expect(reveals.some((s) => s.text.includes('Richtige Antwort:'))).toBe(true);

  const result = page.getByTestId('match-result');
  await expect(result.locator('tbody tr')).toHaveCount(3);
  await expect(result).toContainText('(du)');
  await expect(result).toContainText('Testpartie: Sie zählt nicht in der Statistik.');
  await expect(page.getByTestId('match-step')).toHaveText('Abrechnung');
  // Testpartien zählen nicht (ADR-048)
  expect((await statistics(page)).every((s) => s.matches_played === 0 && s.matches_won === 0)).toBe(
    true,
  );

  // Nach dem Ende geht es zur nächsten Partie
  await result.getByRole('button', { name: 'Neue Partie' }).click();
  await expect(page).toHaveURL(/\/partie$/);
  await expect(page.getByRole('region', { name: 'Letzte Partien' })).toContainText('beendet');
});

test('Partie am Handy quer: allein mit Bots, die Karte steht fest, ein Tipp wählt die Region', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Hochkant wie in der Hand; quer bleiben in Safari etwa 844 × 340 für die Seite
  const UPRIGHT = { width: 390, height: 664 };
  const ACROSS = { width: 844, height: 340 };
  const page = await newPlayer(browser, { viewport: UPRIGHT, hasTouch: true, isMobile: true });
  /** Breite des Inhalts: Ragt etwas seitlich hinaus, ist die Seite breiter als der Bildschirm. */
  const contentWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await contentWidth()).toBeLessThanOrEqual(UPRIGHT.width);

  // Normale Partie eröffnen: Übersicht und Eröffnen gehen auch hochkant
  const create = page.getByRole('region', { name: 'Neue Partie' });
  await create.getByLabel(/^Kurze Zeiten/).check();
  await create.getByRole('button', { name: 'Partie eröffnen' }).tap();
  await expect(page).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);

  // Die Partie spielt quer (ADR-059): Hochkant steht nur die Bitte, das Handy zu drehen
  const lobby = page.getByTestId('match-lobby');
  const hint = page.locator('.rotate-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('Bitte dreh dein Handy quer');
  await expect(lobby).toBeHidden();
  expect(await contentWidth()).toBeLessThanOrEqual(UPRIGHT.width);
  await page.setViewportSize(ACROSS);
  await expect(hint).toBeHidden();
  await expect(lobby).toBeVisible();

  /** Liegt ein Element ganz auf dem Bildschirm? */
  const onScreen = (selector: string) =>
    page.evaluate((sel) => {
      const rect = document.querySelector(sel)?.getBoundingClientRect();
      return (
        rect !== undefined &&
        rect.width > 0 &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth + 0.5 &&
        rect.bottom <= window.innerHeight + 0.5
      );
    }, selector);

  // Die Aufstellung mit dem Einladungscode passt ohne Scrollen auf den Bildschirm; allein lässt
  // sich die Partie nicht starten
  await expect(page.getByTestId('invite-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  expect(await onScreen('[data-testid="match-lobby"]')).toBe(true);
  expect(await contentWidth()).toBeLessThanOrEqual(ACROSS.width);
  const start = lobby.getByRole('button', { name: 'Partie starten' });
  await expect(start).toBeDisabled();
  await expect(lobby).toContainText('mindestens einen Mitspieler oder einen Bot');

  // Freie Plätze mit Bots füllen, Stärke ändern, entfernen und wieder hinzufügen
  const bots = lobby.locator('[data-testid="lobby-seat"].bot');
  await lobby.getByRole('button', { name: 'Bot dazu' }).first().tap();
  await expect(bots).toHaveCount(1);
  await expect(start).toBeEnabled();
  await lobby.getByRole('button', { name: 'Bot dazu' }).tap();
  await expect(bots).toHaveCount(2);
  await expect(lobby.getByRole('button', { name: 'Bot dazu' })).toHaveCount(0);
  await lobby.getByLabel('Stärke von Bot 2 (mittel)').selectOption('HARD');
  await expect(lobby).toContainText('Bot (schwer)');
  await lobby.getByRole('button', { name: 'Bot (schwer) entfernen' }).tap();
  await expect(bots).toHaveCount(1);
  await lobby.getByRole('button', { name: 'Bot dazu' }).tap();
  await expect(bots).toHaveCount(2);
  await expect(lobby).toContainText('Partien mit Bots zählen nicht in der Statistik.');
  expect(await onScreen('[data-testid="match-lobby"]')).toBe(true);
  await start.tap();
  await expect(page.getByTestId('match-board')).toBeVisible();
  await expect(page.getByTestId('match-seats').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('match-turns').getByRole('listitem')).toHaveCount(3);

  /** Bühne in einem Zug gelesen, damit Zustand und Lage zusammenpassen. */
  const read = () =>
    page.evaluate(() => {
      const main = document.querySelector('[data-testid="match-screen"]');
      const rectOf = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect();
      const box = (rect: DOMRect | undefined) =>
        rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(' ') : '';
      const regions = [...document.querySelectorAll('.board-region')].map((region) =>
        region.getBoundingClientRect(),
      );
      const land = {
        left: Math.min(...regions.map((r) => r.left)),
        top: Math.min(...regions.map((r) => r.top)),
        right: Math.max(...regions.map((r) => r.right)),
        bottom: Math.max(...regions.map((r) => r.bottom)),
      };
      const left = rectOf('[data-stage-rail="left"]');
      const right = rectOf('[data-stage-rail="right"]');
      const sheet = rectOf('.stage-centre .sheet');
      return {
        state: main?.getAttribute('data-state') ?? '',
        seq: Number(main?.getAttribute('data-seq') ?? 0),
        scrollY: Math.round(window.scrollY),
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        width: document.documentElement.scrollWidth,
        viewport: [window.innerWidth, window.innerHeight],
        // Karte samt Ausschnitt, Spielstand, Zugfolge und Blatt: Sie stehen in jedem Zustand gleich
        fixed: [
          box(rectOf('[data-testid="match-board"]')),
          document.querySelector('[data-testid="match-board"]')?.getAttribute('viewBox') ?? '',
          box(left),
          box(rectOf('[data-testid="match-turns"]')),
          box(right),
        ].join(' | '),
        land,
        rails: {
          left: left?.left ?? -1,
          leftEnd: left?.right ?? 0,
          right: right?.left ?? 0,
          rightEnd: right?.right ?? 0,
        },
        // Blatt mitten auf der Karte (Frage, Auflösung): zwischen den Rändern und ganz zu sehen
        sheet: sheet
          ? { left: sheet.left, top: sheet.top, right: sheet.right, bottom: sheet.bottom }
          : null,
        locked: document.documentElement.classList.contains('match-playing'),
        turns: [...document.querySelectorAll('[data-testid="match-turns"] li')].map((li) => ({
          status: li.getAttribute('data-status'),
          me: li.classList.contains('me'),
        })),
      };
    });

  const matchId = matchIdOf(page);
  /** Lage der Bühne je Zustand: Zwischen Wahl, Frage und Auflösung bewegt sich nichts. */
  const stages = new Map<string, string>();
  const answered = new Set<number>();
  let picks = 0;
  let myTurns = 0;
  const until = Date.now() + 100_000;
  while (picks < 3 || !stages.has('question') || !stages.has('reveal')) {
    if (Date.now() > until) throw new Error('Wahl, Frage und Auflösung kamen nicht rechtzeitig');
    const now = await read();
    const { state, seq } = now;
    if (state === 'finished' || state === 'abandoned') break;
    // Eine feste Bildschirmseite: nichts zu scrollen, also kann auch nichts springen
    expect(now.scrollY).toBe(0);
    expect(now.overflow).toBeLessThanOrEqual(0);
    expect(now.width).toBeLessThanOrEqual(ACROSS.width);
    expect(now.locked).toBe(true);
    stages.set(state, now.fixed);
    // Die Karte füllt den Bildschirm; das ganze Land liegt frei zwischen Spielstand und Blatt
    expect(now.rails.left).toBeGreaterThanOrEqual(0);
    expect(now.rails.rightEnd).toBeLessThanOrEqual(ACROSS.width);
    expect(now.land.left).toBeGreaterThanOrEqual(now.rails.leftEnd);
    expect(now.land.right).toBeLessThanOrEqual(now.rails.right);
    expect(now.land.top).toBeGreaterThanOrEqual(0);
    expect(now.land.bottom).toBeLessThanOrEqual(ACROSS.height);
    if (now.sheet) {
      expect(now.sheet.left).toBeGreaterThanOrEqual(now.rails.leftEnd);
      expect(now.sheet.right).toBeLessThanOrEqual(now.rails.right);
      expect(now.sheet.top).toBeGreaterThanOrEqual(0);
      expect(now.sheet.bottom).toBeLessThanOrEqual(ACROSS.height);
    }
    if (state === 'pick') {
      // Wer wählen darf, steht in der Zugfolge als Einziger auf „dran“
      expect(now.turns.filter((turn) => turn.status === 'NOW')).toEqual([
        { status: 'NOW', me: true },
      ]);
      myTurns += 1;
      if (await pickFirst(page, matchId, 'tap')) picks += 1;
    } else if (state === 'question' && !answered.has(seq)) {
      if (await answerRight(page, matchId, seq, 'tap')) answered.add(seq);
    }
    await page.waitForTimeout(100);
  }
  expect(picks).toBeGreaterThanOrEqual(3);
  expect(myTurns).toBeGreaterThanOrEqual(3);
  // Vor der ersten Landnahme steht eine Schätzfrage: Sie wurde auf dem Ziffernfeld getippt
  expect(answered.size).toBeGreaterThan(0);
  expect([...stages.keys()]).toEqual(expect.arrayContaining(['pick', 'question', 'reveal']));
  expect([...new Set(stages.values())]).toHaveLength(1);

  // Mitten in der Partie gedreht: wieder nur der Hinweis; zurück im Querformat steht alles wie vorher
  const [before] = stages.values();
  await page.setViewportSize(UPRIGHT);
  await expect(hint).toBeVisible();
  await expect(page.getByTestId('match-seats')).toBeHidden();
  expect(await contentWidth()).toBeLessThanOrEqual(UPRIGHT.width);
  await page.setViewportSize(ACROSS);
  await expect(hint).toBeHidden();
  await expect(page.getByTestId('match-seats')).toBeVisible();
  await expect.poll(async () => (await read()).fixed).toBe(before);
  await page.context().close();
});

test('Einladungslink: Wer ihn öffnet, tritt der Aufstellung bei', async ({ browser }) => {
  const host = await newPlayer(browser, { permissions: ['clipboard-read', 'clipboard-write'] });
  await host
    .getByRole('region', { name: 'Neue Partie' })
    .getByRole('button', { name: 'Partie eröffnen' })
    .click();
  await expect(host).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  const matchId = matchIdOf(host);
  const lobby = host.getByTestId('match-lobby');
  const taken = lobby.locator('[data-testid="lobby-seat"].taken');
  const code = (await host.getByTestId('invite-code').innerText()).trim();

  // Der Knopf kopiert den Link zur Adresse, unter der das Spiel gerade läuft
  await lobby.getByRole('button', { name: 'Link kopieren' }).click();
  await expect(lobby.getByRole('button', { name: 'Link kopiert' })).toBeVisible();
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toBe(`${new URL(host.url()).origin}/partie/beitreten/${code}`);

  // Mit Konto in diesem Browser: öffnen genügt
  const friend = await newPlayer(browser);
  await friend.goto(link);
  await expect(friend).toHaveURL(host.url());
  await expect(friend.getByTestId('match-lobby')).toContainText('Warte, bis');
  await expect(taken).toHaveCount(2);

  // Ohne Konto: Das Öffnen allein legt nichts an und belegt keinen Platz (Linkvorschauen)
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto('/partie/beitreten/abc');
  await expect(stranger.getByTestId('join-screen')).toContainText('unvollständig');
  await stranger.goto(link.replace(code, code.toLowerCase()));
  const invitation = stranger.getByTestId('join-screen');
  await expect(invitation).toContainText('Einladung zur Partie');
  await expect(invitation.getByTestId('invite-code')).toHaveText(code);
  const joinAsGuest = invitation.getByRole('button', { name: 'Als Gast beitreten' });
  await expect(joinAsGuest).toBeVisible();
  const seats = () =>
    testDb()
      .selectFrom('match_players')
      .select('join_order')
      .where('match_id', '=', matchId)
      .execute();
  expect(await seats()).toHaveLength(2);
  const session = (await stranger.context().cookies()).filter((c) => c.name === 'rdw_session');
  expect(session).toHaveLength(0);
  // Ein Tipp legt das Gastkonto an und tritt bei
  await joinAsGuest.click();
  await expect(stranger).toHaveURL(host.url());
  await expect(taken).toHaveCount(3);

  // Volle Partie: Der Link sagt es, statt still zur Startseite zu führen
  const late = await newPlayer(browser);
  await late.goto(link);
  await expect(late.getByTestId('join-screen')).toContainText('schon voll');
  expect(await seats()).toHaveLength(3);
});

test('Partie: normale Partie zu zweit in zwei Browsern', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);

  const create = host.getByRole('region', { name: 'Neue Partie' });
  await create.getByLabel(/^Kurze Zeiten/).check();
  await create.getByRole('button', { name: 'Partie eröffnen' }).click();
  await expect(host).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  // Ohne Bots in der Aufstellung bleibt es eine Partie unter Menschen
  await expect(host.getByTestId('match-lobby')).not.toContainText('zählen nicht in der Statistik');
  const code = (await host.getByTestId('invite-code').innerText()).trim();
  const start = host.getByRole('button', { name: 'Partie starten' });
  await expect(start).toBeDisabled();

  // Beitreten mit dem Code, Groß- und Kleinschreibung egal
  await guest.getByLabel('Einladungscode').fill(code.toLowerCase());
  await guest.getByRole('button', { name: 'Beitreten' }).click();
  await expect(guest).toHaveURL(host.url());
  await expect(guest.getByTestId('match-lobby')).toContainText('Warte, bis');
  await expect(
    host.getByTestId('match-lobby').locator('[data-testid="lobby-seat"].taken'),
  ).toHaveCount(2);
  await start.click();
  // Zu zweit wird auf der Kernmark gespielt: 16 Regionen statt 24
  for (const page of [host, guest]) {
    const board = page.getByTestId('match-board');
    await expect(board).toHaveAttribute('aria-label', 'Karte: Kernmark');
    await expect(board.locator('.board-region')).toHaveCount(16);
    await expect(page.getByTestId('match-turns').getByRole('listitem')).toHaveCount(2);
  }

  const [hostPlayed, guestPlayed] = await Promise.all([playToEnd(host), playToEnd(guest)]);
  expect(hostPlayed.answers).toBeGreaterThan(0);
  expect(guestPlayed.answers).toBeGreaterThan(0);

  for (const page of [host, guest]) {
    const result = page.getByTestId('match-result');
    await expect(result.locator('tbody tr')).toHaveCount(2);
    await expect(result).not.toContainText('Testpartie');
    await expect(result).not.toContainText('Partie mit Bots');
  }
  // Eine normale Partie zählt für beide, genau einer oder beide (geteilt) auf Platz 1
  const stats = await statistics(host);
  expect(stats.map((s) => s.matches_played)).toEqual([1, 1]);
  expect(stats.reduce((n, s) => n + s.matches_won, 0)).toBeGreaterThanOrEqual(1);
});

/** Karte zum Mitlesen, wie sie ein Zuschauer vor der Antwort des Gefragten sah (ADR-065). */
interface Watched {
  readonly seq: number;
  readonly kind: string | null;
  readonly text: string;
  /** Antworten in der Reihenfolge der Karte, beim Zuschauer und beim Gefragten. */
  readonly options: readonly string[];
  readonly asked: readonly string[];
  /** Schaltflächen in der Karte: Zum Mitlesen gibt es keine. */
  readonly buttons: number;
  /** Blatt rechts: wer gefragt ist und der Hinweis fürs Zuschauen. */
  readonly sheet: string;
}

/**
 * Lässt die Seite mitschreiben, welche Antwortfelder die Auflösung ausgemalt hat: je Feld die
 * Sitze, die es gewählt haben, und die Zahl der Teile der Füllung. Die Seite steht schon, deshalb
 * `evaluate` und kein Skript beim Laden.
 */
async function recordFills(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fills: string[] = [];
    (window as unknown as { fills: string[] }).fills = fills;
    new MutationObserver(() => {
      const chosen = document.querySelectorAll(
        '[data-testid="match-reveal"] .reveal-option.chosen',
      );
      for (const option of chosen) {
        const parts = option.querySelectorAll('.reveal-fill i').length;
        const entry = `${option.getAttribute('data-chosen-by') ?? ''}|${parts}`;
        if (!fills.includes(entry)) fills.push(entry);
      }
    }).observe(document, { subtree: true, childList: true });
  });
}

/**
 * Spielt wie `playToEnd`, wartet aber vor jeder eigenen Antwort kurz auf die andere Seite: Schaut
 * sie dieser Frage zu, muss dort die Karte zum Mitlesen liegen, ehe die Antwort die Frage auflöst.
 */
async function playWatched(page: Page, other: Page, watched: Watched[]): Promise<number> {
  const matchId = matchIdOf(page);
  const screen = page.getByTestId('match-screen');
  const theirs = other.getByTestId('match-screen');
  const answered = new Set<number>();
  const until = Date.now() + 200_000;
  for (;;) {
    if (Date.now() > until) throw new Error('Die Partie endet nicht rechtzeitig');
    const state = await screen.getAttribute('data-state');
    const seq = Number((await screen.getAttribute('data-seq')) ?? 0);
    if (state === 'finished') break;
    if (state === 'abandoned') throw new Error('Die Partie wurde abgebrochen');
    if (state === 'pick') {
      await pickFirst(page, matchId, 'click');
    } else if (state === 'question' && !answered.has(seq)) {
      const arrived = await succeeds(
        expect(theirs).toHaveAttribute('data-seq', String(seq), { timeout: 3_000 }),
      );
      if (arrived && (await theirs.getAttribute('data-state')) === 'spectating') {
        const card = other.getByTestId('match-question-watched');
        await expect(card).toBeVisible({ timeout: 3_000 });
        watched.push({
          seq,
          kind: await card.getAttribute('data-kind'),
          text: (await card.textContent()) ?? '',
          options: await card.locator('.option-text').allTextContents(),
          asked: await page.getByTestId('match-question').locator('.option-text').allTextContents(),
          buttons: await card.getByRole('button').count(),
          sheet: (await other.getByTestId('match-waiting').textContent()) ?? '',
        });
      }
      if (await answerRight(page, matchId, seq)) answered.add(seq);
    }
    await page.waitForTimeout(100);
  }
  return answered.size;
}

test('Partie: Wer zuschaut, liest die Frage mit; die Auflösung malt die Antwortfelder aus (ADR-065)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);

  const create = host.getByRole('region', { name: 'Neue Partie' });
  await create.getByLabel(/^Kurze Zeiten/).check();
  await create.getByRole('button', { name: 'Partie eröffnen' }).click();
  await expect(host).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  const lobby = host.getByTestId('match-lobby');
  const code = (await host.getByTestId('invite-code').innerText()).trim();
  await guest.getByLabel('Einladungscode').fill(code);
  await guest.getByRole('button', { name: 'Beitreten' }).click();
  await expect(guest).toHaveURL(host.url());
  const taken = lobby.locator('[data-testid="lobby-seat"].taken');
  await expect(taken).toHaveCount(2);
  // Der Bot auf dem dritten Platz greift nur Menschen an: Dann schaut der andere Mensch zu
  await lobby.getByRole('button', { name: 'Bot dazu' }).click();
  await expect(taken).toHaveCount(3);
  for (const page of [host, guest]) await recordFills(page);
  await host.getByRole('button', { name: 'Partie starten' }).click();

  const watched: Watched[] = [];
  const [hostAnswers, guestAnswers] = await Promise.all([
    playWatched(host, guest, watched),
    playWatched(guest, host, watched),
  ]);
  expect(hostAnswers).toBeGreaterThan(0);
  expect(guestAnswers).toBeGreaterThan(0);

  // Mindestens einmal hat ein Mensch dem anderen zugeschaut und dabei die Frage gelesen
  expect(watched.length).toBeGreaterThan(0);
  for (const card of watched) {
    expect(card.text).toContain('Du schaust zu');
    expect(card.buttons).toBe(0);
    expect(card.sheet).toContain('Wer was gewählt hat, zeigt die Auflösung.');
    // Dieselbe Frage wie beim Gefragten, die Antworten in derselben Reihenfolge
    expect(card.options).toEqual(card.asked);
    if (card.kind === 'TRIVIA') expect(card.options).toHaveLength(4);
  }
  expect(watched.some((card) => card.kind === 'TRIVIA')).toBe(true);

  // In der Auflösung trägt jedes gewählte Feld so viele Teile wie Sitze, die es gewählt haben
  for (const page of [host, guest]) {
    const fills = await page.evaluate(() => (window as unknown as { fills?: string[] }).fills);
    expect(fills?.length).toBeGreaterThan(0);
    for (const fill of fills ?? []) {
      const [seats = '', parts] = fill.split('|');
      expect(seats).not.toBe('');
      expect(Number(parts)).toBe(seats.split(' ').length);
    }
  }
});
