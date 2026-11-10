import { expect, test, type Browser, type Page } from '@playwright/test';
import { closeAnswerDb, matchSolution, testDb } from './answers.ts';

/**
 * Partie im Browser (Abnahme M4, TEST_PLAN §5): eine ganze Testpartie zu dritt gegen zwei Bots
 * und eine normale Partie zu zweit in zwei Browser-Kontexten, beide mit Spieltestzeiten. Jeder
 * Spieler wählt die erste markierte Region und antwortet richtig; die Lösung liest nur der Test
 * aus der Datenbank. Die Ablaufsteuerung läuft im Testserver wie im api-Prozess.
 */

test.afterAll(async () => {
  await closeAnswerDb();
});

/** Gast anlegen und zur Partie-Übersicht gehen. */
async function newPlayer(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
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
      const region = page.getByTestId('match-board').getByRole('button').first();
      // Kommt die Abfrage dazwischen, ist die Wahl vielleicht schon vorbei: dann neu lesen
      if (await succeeds(region.click({ timeout: 2_000 }))) picks += 1;
    } else if (state === 'question' && !answered.has(seq)) {
      const question = page.getByTestId('match-question');
      if (reload) {
        reload = false;
        await page.reload();
        await expect(question).toBeVisible();
        await expect(question).toContainText('Die Seite wurde neu geladen');
      }
      const solution = await matchSolution(matchId, seq);
      // Eine Antwort kann nur scheitern, wenn die Frage inzwischen vorbei ist: dann neu lesen
      const sent =
        solution.kind === 'TRIVIA'
          ? question
              .getByRole('button', { name: solution.optionText, exact: true })
              .click({ timeout: 5_000 })
          : question
              .getByLabel(/^Deine Schätzung/)
              .fill(solution.input, { timeout: 5_000 })
              .then(() =>
                question.getByRole('button', { name: 'Antwort abgeben' }).click({ timeout: 5_000 }),
              );
      if (await succeeds(sent)) answered.add(seq);
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

test('Partie: normale Partie zu zweit in zwei Browsern', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await newPlayer(browser);
  const guest = await newPlayer(browser);

  const create = host.getByRole('region', { name: 'Neue Partie' });
  await create.getByLabel(/^Kurze Zeiten/).check();
  await create.getByRole('button', { name: 'Partie eröffnen' }).click();
  await expect(host).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  const code = (await host.getByTestId('invite-code').innerText()).trim();
  const start = host.getByRole('button', { name: 'Partie starten' });
  await expect(start).toBeDisabled();

  // Beitreten mit dem Code, Groß- und Kleinschreibung egal
  await guest.getByLabel('Einladungscode').fill(code.toLowerCase());
  await guest.getByRole('button', { name: 'Beitreten' }).click();
  await expect(guest).toHaveURL(host.url());
  await expect(guest.getByTestId('match-lobby')).toContainText('Warte, bis');
  await expect(host.getByTestId('match-lobby').locator('.lobby-players li')).toHaveCount(2);
  await start.click();

  const [hostPlayed, guestPlayed] = await Promise.all([playToEnd(host), playToEnd(guest)]);
  expect(hostPlayed.answers).toBeGreaterThan(0);
  expect(guestPlayed.answers).toBeGreaterThan(0);

  for (const page of [host, guest]) {
    const result = page.getByTestId('match-result');
    await expect(result.locator('tbody tr')).toHaveCount(2);
    await expect(result).not.toContainText('Testpartie');
  }
  // Eine normale Partie zählt für beide, genau einer oder beide (geteilt) auf Platz 1
  const stats = await statistics(host);
  expect(stats.map((s) => s.matches_played)).toEqual([1, 1]);
  expect(stats.reduce((n, s) => n + s.matches_won, 0)).toBeGreaterThanOrEqual(1);
});
