import { expect, test } from '@playwright/test';

/**
 * Konto sichern (O-03, Phase 2 Paket 2) auf der Kontoseite (ADR-080): Ein Gast tritt bei, öffnet
 * sein Konto, sichert es in zwei Schritten (Spielername aus Vorschlägen, dann Benutzername und
 * Passwort), meldet sich auf einem zweiten Gerät an und findet dort sein Reich wieder. Die
 * Ansichten der Kontoseite haben eigene Pfade; „Zurück“ im Browser schließt sie. Abmelden beendet
 * nur die Sitzung des einen Geräts. Die Weltwahl zeigt die eigene Welt zum Weiterspielen; ins
 * Hauptmenü kommt man ohne Sitzung über „Ich habe ein Konto“.
 */

const PASSWORD = 'e2e-passwort-lang';

test('Konto: Gast sichert sein Konto und spielt auf einem zweiten Gerät weiter', async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  // Die Welten stehen nicht im Hauptmenü (ADR-074), sie bleiben unter ihrem Pfad erreichbar
  await expect(page.getByRole('button', { name: 'Neue Partie' })).toBeVisible();
  await page.goto('/welten');
  const world = page.getByTestId('world-e2e');
  await world.getByRole('button', { name: 'Beitreten' }).click();
  await world.getByRole('button', { name: 'Reich gründen' }).click();
  await expect(page).toHaveURL(/\/play\//);
  const playUrl = page.url();
  const kingdomName = (await page.getByRole('banner').locator('strong').innerText()).trim();

  // Kontoseite als Blatt im Menü: Wappenseite, Bilanz ohne beendete Partie
  await page.getByTestId('nav-account').click();
  await expect(page).toHaveURL(/\/konto$/);
  const account = page.getByTestId('account');
  await expect(account.getByTestId('account-status')).toHaveText('Gast · nicht gesichert');
  await expect(account.getByTestId('account-tier')).toContainText('Holzwappen');
  await expect(account.getByText('Noch keine Partie beendet')).toBeVisible();
  await account.getByRole('tab', { name: 'Wissen' }).click();
  await expect(account.getByTestId('knowledge-rows').locator('li')).toHaveCount(11);

  // „Konto sichern“ hat einen eigenen Pfad; „Zurück“ im Browser schließt die Ansicht wieder
  await account.getByRole('tab', { name: 'Zugang' }).click();
  await account.getByRole('button', { name: /^Konto sichern/ }).click();
  await expect(page).toHaveURL(/\/konto\/sichern$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(account).toHaveAttribute('data-view', 'home');
  await expect(account.getByRole('tab', { name: 'Zugang' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await account.getByRole('button', { name: /^Konto sichern/ }).click();
  await expect(account).toHaveAttribute('data-view', 'secure');

  // Schritt 1: Spielername aus Vorschlägen; der erste ist gewählt und steht schon im Wappen
  const form = account.getByTestId('register-form');
  const picker = form.getByTestId('player-name-picker');
  await expect(picker.getByRole('radio').first()).toBeChecked();
  const chosen = picker.locator('label').nth(1);
  const playerName = (await chosen.innerText()).trim();
  await chosen.click();
  await expect(account.getByTestId('account-name')).toHaveText(playerName);
  await form.getByRole('button', { name: 'Weiter' }).click();

  // Schritt 2: Benutzername und Passwort; ein Tippfehler bei der Wiederholung hält auf
  const username = `e2e_${Date.now().toString(36)}`;
  await form.getByLabel('Benutzername').fill(username);
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Passwort wiederholen').fill(`${PASSWORD}x`);
  await form.getByRole('button', { name: 'Konto sichern' }).click();
  await expect(form).toContainText('Die Passwörter stimmen nicht überein.');
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await form.getByRole('button', { name: 'Konto sichern' }).click();

  await expect(account.getByTestId('account-notice')).toHaveText('Dein Konto ist gesichert.');
  await expect(page).toHaveURL(/\/konto$/);
  await expect(account.getByTestId('account-status')).toHaveText(`Gesichert · ${username}`);
  await expect(account.getByTestId('account-name')).toHaveText(playerName);
  await expect(account.locator('.acct-rows')).toContainText(username);
  await expect(account.locator('.acct-rows')).toContainText(playerName);
  await expect(page.getByTestId('menu-plate')).toContainText(playerName);

  // Zweites Gerät: falsches Passwort, dann richtig (Schreibweise des Namens egal)
  const other = await (await browser.newContext()).newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Ich habe ein Konto' }).click();
  const login = other.getByTestId('login-form');
  await login.getByLabel('Benutzername').fill(username.toUpperCase());
  await login.getByLabel('Passwort').fill('falsches-passwort');
  await login.getByRole('button', { name: 'Anmelden' }).click();
  await expect(login.getByRole('alert')).toHaveText('Benutzername oder Passwort ist falsch.');
  await login.getByLabel('Passwort').fill(PASSWORD);
  await login.getByRole('button', { name: 'Anmelden' }).click();
  // Angemeldet zeigt das Hauptmenü die Plakette mit dem Spielernamen; die Weltwahl bietet die
  // eigene Welt zum Weiterspielen (ADR-050)
  await expect(other.getByTestId('menu-plate')).toContainText(playerName);
  await expect(other.getByRole('button', { name: 'Neue Partie' })).toBeVisible();
  await other.goto('/welten');
  await other.getByTestId('world-e2e').getByRole('button', { name: 'Weiterspielen' }).click();
  await expect(other).toHaveURL(playUrl);
  await expect(other.getByRole('banner')).toContainText(kingdomName);
  await expect(other.getByTestId('nav-account')).toHaveText('Konto');

  // Weltwahl: die eigene Welt zum Weiterspielen, die andere zum Beitreten
  await other.getByRole('button', { name: 'Welten' }).click();
  await expect(other).toHaveURL(/\/welten$/);
  await expect(other.getByTestId('world-spieltest').getByRole('button')).toHaveText('Beitreten');
  await other.getByTestId('world-e2e').getByRole('button', { name: 'Weiterspielen' }).click();
  await expect(other).toHaveURL(playUrl);

  // Abmelden auf dem ersten Gerät; das zweite bleibt angemeldet
  await account.getByTestId('account-logout').click();
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();
  await other.reload();
  await expect(other.getByRole('banner')).toContainText(kingdomName);
});

test('Konto: Ein Gast wird vor dem Abmelden gewarnt und kann erst sichern', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  await page.getByTestId('menu-plate').click();
  const account = page.getByTestId('account');
  await expect(page).toHaveURL(/\/konto$/);
  await account.getByRole('tab', { name: 'Zugang' }).click();
  await account.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/konto\/abmelden$/);
  await expect(account).toContainText('Ohne Sicherung ist dein Gastkonto danach weg');
  // „Erst sichern“ ersetzt die Ansicht: „Zurück“ führt danach nicht zur Warnung
  await account.getByRole('button', { name: 'Erst sichern' }).click();
  await expect(page).toHaveURL(/\/konto\/sichern$/);
  await expect(account.getByTestId('register-form')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/konto$/);
  // Gesicherte Ansichten gibt es für Gäste nicht: Der Pfad führt zur Kontoseite zurück
  await page.goto('/konto/passwort');
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByTestId('account')).toHaveAttribute('data-view', 'home');
  // Bewusst abmelden: zurück zum Start
  await page.goto('/konto/abmelden');
  await page.getByRole('button', { name: 'Trotzdem abmelden' }).click();
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();
});
