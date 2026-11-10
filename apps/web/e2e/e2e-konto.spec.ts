import { expect, test } from '@playwright/test';

/**
 * Konto sichern (O-03, Phase 2 Paket 2): Ein Gast tritt bei, sichert sein Konto mit Benutzername,
 * Passwort und gewähltem Spielernamen, meldet sich auf einem zweiten Gerät an und findet dort sein
 * Reich wieder. Abmelden beendet nur die Sitzung des einen Geräts. Die Weltwahl zeigt die eigene
 * Welt zum Weiterspielen.
 */

const PASSWORD = 'e2e-passwort-lang';

test('Konto: Gast sichert sein Konto und spielt auf einem zweiten Gerät weiter', async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  const world = page.getByTestId('world-e2e');
  await world.getByRole('button', { name: 'Beitreten' }).click();
  await world.getByRole('button', { name: 'Reich gründen' }).click();
  await expect(page).toHaveURL(/\/play\//);
  const playUrl = page.url();
  const kingdomName = (await page.getByRole('banner').locator('strong').innerText()).trim();

  await page.getByTestId('nav-account').click();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByRole('heading', { name: 'Du spielst als Gast' })).toBeVisible();
  const form = page.getByTestId('register-form');
  const username = `e2e_${Date.now().toString(36)}`;
  await form.getByLabel('Benutzername').fill(username);
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Passwort wiederholen').fill(`${PASSWORD}x`);
  await form.getByRole('button', { name: 'Konto sichern' }).click();
  await expect(form).toContainText('Die Passwörter stimmen nicht überein.');
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  const picker = form.getByTestId('player-name-picker');
  await expect(picker.getByRole('radio').first()).toBeChecked();
  const playerName = (await picker.locator('label').first().innerText()).trim();
  await form.getByRole('button', { name: 'Konto sichern' }).click();

  await expect(page.getByRole('status')).toHaveText('Dein Konto ist gesichert.');
  const summary = page.getByTestId('account-summary');
  await expect(summary).toContainText(`Angemeldet als ${username}`);
  await expect(summary).toContainText(`Spielername: ${playerName}`);

  // Zweites Gerät: falsches Passwort, dann richtig (Schreibweise des Namens egal)
  const other = await (await browser.newContext()).newPage();
  await other.goto('/');
  const login = other.getByTestId('login-form');
  await login.getByLabel('Benutzername').fill(username.toUpperCase());
  await login.getByLabel('Passwort').fill('falsches-passwort');
  await login.getByRole('button', { name: 'Anmelden' }).click();
  await expect(login.getByRole('alert')).toHaveText('Benutzername oder Passwort ist falsch.');
  await login.getByLabel('Passwort').fill(PASSWORD);
  await login.getByRole('button', { name: 'Anmelden' }).click();
  // Die Startseite bietet die Partie und die eigene Welt zum Weiterspielen (ADR-050)
  await expect(other.getByRole('button', { name: 'Partie spielen' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();
  await other.reload();
  await expect(other.getByRole('banner')).toContainText(kingdomName);
});
