import { expect, test } from '@playwright/test';
import { newPlayer } from './match-kit.ts';

/**
 * Auffangschirm (ADR-061, TEST_PLAN §5, E2E-P6): Baut etwas außerhalb des Spiels die Seite um, wie
 * es die automatische Übersetzung des Browsers tut, findet React seine eigenen Stellen nicht mehr
 * und der Browser wirft `NotFoundError`. Ohne Auffangschirm bliebe ein leeres Blatt. Geprüft wird:
 * Die Seite sperrt die Übersetzung, statt des leeren Blatts steht die Meldung mit der vermuteten
 * Ursache, und „Neu laden“ bringt die Seite zurück.
 */

test('Auffangschirm: Nach einem fremden Umbau der Seite steht die Meldung statt eines leeren Blatts', async ({
  browser,
}) => {
  const page = await newPlayer(browser, {
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));

  // Die Seite bittet den Browser, sie nicht zu übersetzen
  await expect(page.locator('html')).toHaveAttribute('translate', 'no');
  await expect(page.locator('meta[name="google"]')).toHaveAttribute('content', 'notranslate');
  await expect(page.getByTestId('crash-screen')).toHaveCount(0);

  // Fremder Umbau: Jedes Element der Seite bekommt eine Hülle, wie sie die Übersetzung um Texte legt
  await page.evaluate(() => {
    for (const element of [...document.querySelectorAll('#root *')]) {
      const wrapper = document.createElement('font');
      element.replaceWith(wrapper);
      wrapper.appendChild(element);
    }
  });
  // Die nächste Änderung der Seite (zurück zum Start) will Elemente entfernen, die nicht mehr dort
  // liegen, wo React sie hingelegt hat
  await page.goBack();

  const crash = page.getByTestId('crash-screen');
  await expect(crash).toBeVisible();
  await expect(crash).toHaveAttribute('data-cause', 'foreign-dom');
  await expect(crash).toHaveAttribute('translate', 'no');
  await expect(crash.getByRole('heading', { level: 1 })).toHaveText(
    'Die Seite ist stehen geblieben',
  );
  await expect(crash).toContainText('Eine laufende Partie geht auf dem Server weiter');
  await expect(page.getByTestId('crash-cause')).toContainText(
    'die automatische Übersetzung des Browsers',
  );
  const report = page.getByTestId('crash-report');
  await expect(report).toContainText('Fehler: NotFoundError');
  await expect(report).toContainText('Seite: /');
  await expect(report).toContainText('Browser: ');
  await expect(report).toContainText('Zeit: 20');
  // Die Adresse des Servers steht nicht in der Meldung
  await expect(report).not.toContainText('127.0.0.1');
  // Der Schirm deckt die ganze Seite und passt ohne waagerechtes Scrollen auf das quer gehaltene Handy
  const box = await crash.boundingBox();
  expect(box).toEqual({ x: 0, y: 0, width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(844);
  await expect(crash.getByRole('button', { name: 'Neu laden' })).toBeInViewport();

  // „Neu laden“ bringt die Seite zurück: Das Gastkonto besteht weiter
  await crash.getByRole('button', { name: 'Neu laden' }).tap();
  await expect(page.getByTestId('crash-screen')).toHaveCount(0);
  await page.getByRole('button', { name: 'Partie spielen' }).tap();
  await expect(page).toHaveURL(/\/partie$/);
  await expect(page.getByTestId('match-mode')).toBeVisible();
  expect(errors.every((name) => name === 'NotFoundError')).toBe(true);
});
