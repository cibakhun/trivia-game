/**
 * Feste Adressen der E2E-Umgebung (ohne Abhängigkeiten, damit die Playwright-Konfiguration sie
 * laden kann, ohne Server-Code zu importieren). Überschreibbar, falls ein Port belegt ist.
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const text = raw === undefined || raw === '' ? String(fallback) : raw;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} muss ein Port zwischen 1 und 65535 sein, nicht „${text}“.`);
  }
  return value;
}

const apiPort = port('E2E_API_PORT', 3101);
const webPort = port('E2E_WEB_PORT', 4174);

export const E2E_API_PORT = apiPort;
export const E2E_WEB_PORT = webPort;
export const E2E_API_ORIGIN = `http://127.0.0.1:${apiPort}`;
export const E2E_WEB_ORIGIN = `http://127.0.0.1:${webPort}`;
