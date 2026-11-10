import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  closeAnswerDb,
  correctTriviaText,
  exactEstimateInput,
  offEstimateInput,
} from './answers.ts';
import { makeNeighbours, playerInfo, type PlayerInfo } from './pvp-setup.ts';

/**
 * E2E-02 Trivia-Sieg und E2E-03 Schätzfrage (TEST_PLAN §5): zwei Spieler in eigenen
 * Browser-Kontexten in der Welt `spieltest` (Spieltest-Regeln, 10 min Frist). Der Angreifer
 * beantwortet beide Fragen, die Belagerung wird eröffnet, der Verteidiger sieht sie in der
 * Seitenleiste und verteidigt mit denselben Fragen. Lösungen liest nur der Test aus der Datenbank.
 */

test.afterAll(async () => {
  await closeAnswerDb();
});

interface Side {
  readonly page: Page;
  readonly info: PlayerInfo;
}

async function joinPlaytest(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  const world = page.getByTestId('world-spieltest');
  await world.getByRole('button', { name: 'Beitreten' }).click();
  await world.getByRole('button', { name: 'Reich gründen' }).click();
  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByTestId('kingdom-regions')).toHaveText('1 Region');
  return page;
}

/** Zwei Spieler; der Verteidiger besitzt eine Nachbarregion der Angreifer-Hauptstadt. */
async function setUpPair(browser: Browser): Promise<{ attacker: Side; defender: Side }> {
  const attackerPage = await joinPlaytest(browser);
  const defenderPage = await joinPlaytest(browser);
  const attacker = await playerInfo(attackerPage);
  const defender = await playerInfo(defenderPage);
  await makeNeighbours(attacker, defender);
  await attackerPage.reload();
  return {
    attacker: { page: attackerPage, info: attacker },
    defender: { page: defenderPage, info: defender },
  };
}

function challengeIdOf(page: Page): string {
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

/** Angreifer: Region des Verteidigers wählen, angreifen, beide Fragen beantworten. */
async function attackAndOpen(
  { page }: Side,
  defenderName: string,
  estimate: 'exact' | 'off',
): Promise<string> {
  await page.locator('.frontier button', { hasText: defenderName }).click();
  const panel = page.getByTestId('region-panel');
  // Der Angreifer hat noch Anfängerschutz: Warnung vor dem Angriff
  await expect(panel.getByTestId('ends-protection')).toBeVisible();
  await panel.getByRole('button', { name: 'Spieler angreifen' }).click();
  await expect(page).toHaveURL(/\/challenge\//);
  const challengeId = challengeIdOf(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Angriff auf');
  await expect(page.locator('.challenge-head')).toContainText(defenderName);

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('question')).toContainText('Wissensfrage');
  await page
    .getByRole('button', { name: await correctTriviaText(challengeId), exact: true })
    .click();
  // Im PvP kommt die Schätzfrage immer
  await expect(page.getByTestId('question')).toContainText('Schätzfrage');
  await expect(page.getByTestId('question')).toContainText(
    'Die Schätzung zählt nur, wenn ihr beide die Wissensfrage richtig habt.',
  );
  await page
    .getByLabel(/Deine Schätzung/)
    .fill(
      estimate === 'exact'
        ? await exactEstimateInput(challengeId)
        : await offEstimateInput(challengeId),
    );
  await page.getByRole('button', { name: 'Antwort abgeben' }).click();
  await expect(page.getByTestId('siege-opened')).toContainText('Belagerung eröffnet');
  await expect(page.getByTestId('siege-opened')).toContainText(defenderName);
  return challengeId;
}

/** Verteidiger: Belagerung in der Seitenleiste, Verteidigung beginnen, beide Fragen. */
async function defend(
  { page }: Side,
  attackerName: string,
  challengeId: string,
  play: { readonly trivia: 'correct' | 'wrong'; readonly estimate: 'exact' | 'off' },
): Promise<void> {
  await page.reload();
  const incoming = page.getByTestId('sieges-incoming');
  await expect(incoming).toContainText(`${attackerName} belagert`);
  await incoming.getByTestId('defend').click();
  await expect(page).toHaveURL(new RegExp(`/challenge/${challengeId}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Verteidigung von');
  await expect(page.getByTestId('defense-intro')).toContainText('Verteidigen bis');
  await page.getByRole('button', { name: 'Verteidigung beginnen' }).click();

  const question = page.getByTestId('question');
  await expect(question).toContainText('Wissensfrage');
  const correct = await correctTriviaText(challengeId);
  const option =
    play.trivia === 'correct'
      ? question.getByRole('button', { name: correct, exact: true })
      : question.locator('.options button').filter({ hasNotText: correct }).first();
  await option.click();
  await expect(question).toContainText('Schätzfrage');
  await page
    .getByLabel(/Deine Schätzung/)
    .fill(
      play.estimate === 'exact'
        ? await exactEstimateInput(challengeId)
        : await offEstimateInput(challengeId),
    );
  await page.getByRole('button', { name: 'Antwort abgeben' }).click();
}

test('E2E-02: Angreifer richtig, Verteidiger falsch – die Region wechselt', async ({ browser }) => {
  const { attacker, defender } = await setUpPair(browser);
  const challengeId = await attackAndOpen(attacker, defender.info.kingdomName, 'exact');

  await defend(defender, attacker.info.kingdomName, challengeId, {
    trivia: 'wrong',
    estimate: 'exact',
  });
  const result = defender.page.getByTestId('resolution');
  await expect(result.getByRole('heading', { level: 1 })).toHaveText('Region verloren');
  await expect(result).toContainText('Der Angreifer lag bei der Wissensfrage richtig, du nicht.');
  await expect(result.getByTestId('defense-points')).toHaveText(
    'Du erhältst 5 Verteidigungspunkte.',
  );

  // Angreifer: Auflösung aus seiner Sicht und eine Region mehr
  await attacker.page.goto(`/challenge/${challengeId}`);
  await expect(
    attacker.page.getByTestId('resolution').getByRole('heading', { level: 1 }),
  ).toHaveText('Region erobert!');
  await attacker.page.getByTestId('resolution').getByRole('button', { name: 'Zur Karte' }).click();
  await expect(attacker.page.getByTestId('kingdom-regions')).toHaveText('2 Regionen');
});

test('E2E-03: beide richtig – die genauere Schätzung des Verteidigers gewinnt', async ({
  browser,
}) => {
  const { attacker, defender } = await setUpPair(browser);
  const challengeId = await attackAndOpen(attacker, defender.info.kingdomName, 'off');

  await defend(defender, attacker.info.kingdomName, challengeId, {
    trivia: 'correct',
    estimate: 'exact',
  });
  const result = defender.page.getByTestId('resolution');
  await expect(result.getByRole('heading', { level: 1 })).toHaveText('Verteidigung erfolgreich!');
  await expect(result).toContainText('Entschieden durch die genauere Schätzung.');
  await expect(result.getByTestId('defense-points')).toHaveText(
    'Du erhältst 10 Verteidigungspunkte.',
  );
  await result.getByRole('button', { name: 'Zur Karte' }).click();
  await expect(defender.page.getByTestId('kingdom-regions')).toHaveText('2 Regionen');
  await expect(defender.page.getByTestId('sieges-recent')).toContainText('gewonnen');

  await attacker.page.goto(`/challenge/${challengeId}`);
  await expect(
    attacker.page.getByTestId('resolution').getByRole('heading', { level: 1 }),
  ).toHaveText('Angriff gescheitert');
});
