/**
 * Feste Adressen der E2E-Umgebung (ohne Abhängigkeiten, damit die Playwright-Konfiguration sie
 * laden kann, ohne Server-Code zu importieren). Überschreibbar, falls ein Port belegt ist.
 */
const apiPort = Number(process.env.E2E_API_PORT ?? 3101);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4174);

export const E2E_API_PORT = apiPort;
export const E2E_WEB_PORT = webPort;
export const E2E_API_ORIGIN = `http://127.0.0.1:${apiPort}`;
export const E2E_WEB_ORIGIN = `http://127.0.0.1:${webPort}`;
