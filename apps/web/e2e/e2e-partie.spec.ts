import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { closeAnswerDb, matchSolution, testDb } from './answers.ts';

/**
 * Partie im Browser (Abnahme M4, TEST_PLAN §5): eine ganze Testpartie zu dritt gegen zwei Bots,
 * eine normale Partie am Handy allein mit Bots aus der Aufstellung (ADR-052), der Einladungslink
 * und eine normale Partie zu zweit in zwei Browser-Kontexten, die Partien mit Spieltestzeiten. Jeder Spieler wählt die
 * erste markierte Region und antwortet richtig; die Lösung liest nur der Test aus der Datenbank.
 * Die Ablaufsteuerung läuft im Testserver wie im api-Prozess.
 */

test.afterAll(async () => {
  await closeAnswerDb();
});

/** Gast anlegen und zur Partie-Übersicht gehen. */
async function newPlayer(browser: Browser, context: BrowserContextOptions = {}): Promise<Page> {
  const page = await (await browser.newContext(context)).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  await page.getByRole('button', { name: 'Partie spielen' }).click();
  await expect(page).toHaveURL(/\/partie$/);
  return page;
}

function matchIdOf(page: Page): string {
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

/** `true`, wenn die Aktion gelang; ein Fehlschlag heißt hier: der Schritt war schon vorbei. */
async function succeeds(action: Promise<unknown>): Promise<boolean> {
  return action.then(
    () => true,
    () => false,
  );
}

/**
 * Wählt die erste markierte Region. Zählt nur, wenn die Wahl beim Server ankommt: Liegt etwas über
 * der Region und schluckt den Tipp, wählt der Server nach Ablauf der Zeit zufällig.
 */
async function pickFirst(page: Page, matchId: string, how: 'click' | 'tap'): Promise<boolean> {
  const region = page.getByTestId('match-board').getByRole('button').first();
  const accepted = page
    .waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/matches/${matchId}/pick`),
      { timeout: 2_000 },
    )
    .then(
      (r) => r.ok(),
      () => false,
    );
  // Kommt die Abfrage dazwischen, ist die Wahl vielleicht schon vorbei: dann neu lesen
  const done = await succeeds(
    how === 'tap' ? region.tap({ timeout: 2_000 }) : region.click({ timeout: 2_000 }),
  );
  return (await accepted) && done;
}

/** Beantwortet die Frage `seq` richtig. `false` heißt: Die Frage war inzwischen vorbei. */
async function answerRight(page: Page, matchId: string, seq: number): Promise<boolean> {
  const question = page.getByTestId('match-question');
  const solution = await matchSolution(matchId, seq);
  return succeeds(
    solution.kind === 'TRIVIA'
      ? question
          .getByRole('button', { name: solution.optionText, exact: true })
          .click({ timeout: 5_000 })
      : question
          .getByLabel(/^Deine Schätzung/)
          .fill(solution.input, { timeout: 5_000 })
          .then(() =>
            question.getByRole('button', { name: 'Antwort abgeben' }).click({ timeout: 5_000 }),
          ),
  );
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

test('Partie am Handy: allein mit Bots, nichts verrutscht, ein Tipp wählt die Region', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const WIDTH = 390;
  const page = await newPlayer(browser, {
    viewport: { width: WIDTH, height: 664 },
    hasTouch: true,
    isMobile: true,
  });
  /** Breite des Inhalts: Ragt etwas seitlich hinaus, ist die Seite breiter als der Bildschirm. */
  const contentWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await contentWidth()).toBeLessThanOrEqual(WIDTH);

  // Normale Partie eröffnen: allein lässt sie sich nicht starten
  const create = page.getByRole('region', { name: 'Neue Partie' });
  await create.getByLabel(/^Kurze Zeiten/).check();
  await create.getByRole('button', { name: 'Partie eröffnen' }).tap();
  await expect(page).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  const lobby = page.getByTestId('match-lobby');
  await expect(page.getByTestId('invite-code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  // Die Aufstellung mit dem Einladungscode passt auf den Bildschirm
  expect(await contentWidth()).toBeLessThanOrEqual(WIDTH);
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
  expect(await contentWidth()).toBeLessThanOrEqual(WIDTH);
  await start.tap();
  await expect(page.getByTestId('match-board')).toBeVisible();
  await expect(page.getByTestId('match-seats').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('match-turns').getByRole('listitem')).toHaveCount(3);

  const matchId = matchIdOf(page);
  /** Lage von Karte und Zugfolge je Zustand: Zwischen Wahl, Frage und Auflösung bewegt sich nichts. */
  const boards = new Map<string, string>();
  const answered = new Set<number>();
  let picks = 0;
  let myTurns = 0;
  const until = Date.now() + 100_000;
  while (picks < 3 || !boards.has('question') || !boards.has('reveal')) {
    if (Date.now() > until) throw new Error('Wahl, Frage und Auflösung kamen nicht rechtzeitig');
    // Zustand, Lage und Zugfolge in einem Zug lesen, damit sie zusammenpassen
    const now = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="match-screen"]');
      const box = (selector: string) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(' ') : '';
      };
      return {
        state: main?.getAttribute('data-state') ?? '',
        seq: Number(main?.getAttribute('data-seq') ?? 0),
        scrollY: Math.round(window.scrollY),
        overflow: document.documentElement.scrollHeight - window.innerHeight,
        width: document.documentElement.scrollWidth,
        board: box('[data-testid="match-board"]'),
        turnsBox: box('[data-testid="match-turns"]'),
        turns: [...document.querySelectorAll('[data-testid="match-turns"] li')].map((li) => ({
          status: li.getAttribute('data-status'),
          me: li.classList.contains('me'),
        })),
      };
    });
    const { state, seq } = now;
    if (state === 'finished' || state === 'abandoned') break;
    // Eine feste Bildschirmseite: nichts zu scrollen, also kann auch nichts springen
    expect(now.scrollY).toBe(0);
    expect(now.overflow).toBeLessThanOrEqual(0);
    expect(now.width).toBeLessThanOrEqual(WIDTH);
    if (now.board) boards.set(state, `${now.board} | ${now.turnsBox}`);
    if (state === 'pick') {
      // Wer wählen darf, steht in der Zugfolge als Einziger auf „dran“
      expect(now.turns.filter((turn) => turn.status === 'NOW')).toEqual([
        { status: 'NOW', me: true },
      ]);
      myTurns += 1;
      if (await pickFirst(page, matchId, 'tap')) picks += 1;
    } else if (state === 'question' && !answered.has(seq)) {
      if (await answerRight(page, matchId, seq)) answered.add(seq);
    }
    await page.waitForTimeout(100);
  }
  expect(picks).toBeGreaterThanOrEqual(3);
  expect(myTurns).toBeGreaterThanOrEqual(3);
  expect([...boards.keys()]).toEqual(expect.arrayContaining(['pick', 'question', 'reveal']));
  expect(new Set(boards.values()).size).toBe(1);
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
