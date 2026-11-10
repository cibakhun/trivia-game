import { expect, test } from '@playwright/test';
import {
  closeAnswerDb,
  correctTriviaText,
  defenderTriviaCorrect,
  exactEstimateInput,
} from './answers.ts';

/**
 * E2E-01 Erste Eroberung (TEST_PLAN §5, Brief §17.3): Ein neuer Gast tritt der Testwelt bei,
 * erobert die Tutorial-Garnison und besitzt danach zwei Regionen, auch nach einem Reload. Die
 * Schätzfrage kommt nur, wenn auch die Garnison die Wissensfrage richtig hat (versiegelt, zufällig).
 */

test.afterAll(async () => {
  await closeAnswerDb();
});

test('E2E-01: Gast erobert die Tutorial-Garnison und besitzt danach zwei Regionen', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  await page.getByTestId('world-e2e').getByRole('button', { name: 'Beitreten' }).click();

  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByTestId('kingdom-rank')).toHaveText('Siedlung');
  await expect(page.getByTestId('kingdom-regions')).toHaveText('1 Region');

  await page.getByRole('button', { name: 'Garnison ansehen' }).click();
  await page.getByRole('button', { name: 'Angreifen' }).click();
  await expect(page).toHaveURL(/\/challenge\//);
  const challengeId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Angriff auf');

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByTestId('question')).toContainText('Wissensfrage');
  await page
    .getByRole('button', { name: await correctTriviaText(challengeId), exact: true })
    .click();

  const resolution = page.getByTestId('resolution');
  if (await defenderTriviaCorrect(challengeId)) {
    // Gleichstand: die Schätzfrage entscheidet
    await expect(page.getByTestId('question')).toContainText('Schätzfrage');
    await page.getByLabel(/Deine Schätzung/).fill(await exactEstimateInput(challengeId));
    await page.getByRole('button', { name: 'Antwort abgeben' }).click();
  } else {
    // Garnison falsch: entschieden durch die Wissensfrage, ohne Schätzfrage
    await expect(resolution).toContainText(
      'Du lagst bei der Wissensfrage richtig, der Gegner nicht.',
    );
    await expect(page.getByLabel(/Deine Schätzung/)).toHaveCount(0);
  }
  await expect(resolution.getByRole('heading', { level: 1 })).toHaveText('Region erobert!');
  await resolution.getByRole('button', { name: 'Zur Karte' }).click();

  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByTestId('kingdom-regions')).toHaveText('2 Regionen');
  // Die Tutorial-Karte verschwindet nach der ersten Eroberung
  await expect(page.getByRole('button', { name: 'Garnison ansehen' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('kingdom-regions')).toHaveText('2 Regionen');
  await expect(page.getByTestId('kingdom-rank')).toHaveText('Siedlung');
});
