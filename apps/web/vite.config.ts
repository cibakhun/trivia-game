import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * Entwicklungsserver und Build des Clients (ADR-006). `/api` geht an den api-Prozess; der
 * Browser sieht nur eine Herkunft, deshalb gelten Sitzungscookie und Origin-Prüfung unverändert.
 * `API_ORIGIN` überschreibt das Ziel (z. B. in E2E-Tests); es wird wie bei den übrigen Befehlen aus
 * der `.env` im Hauptordner gelesen, gesetzte Umgebungsvariablen haben Vorrang.
 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // nur `API_*`: nichts aus der .env landet ungewollt in der Konfiguration oder im Client
  const env = loadEnv(mode, REPO_ROOT, 'API_');
  const fromEnv = env.API_ORIGIN?.trim();
  const apiOrigin = fromEnv === undefined || fromEnv === '' ? 'http://127.0.0.1:3000' : fromEnv;
  return {
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: apiOrigin, changeOrigin: false } },
    },
    preview: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: apiOrigin, changeOrigin: false } },
    },
    oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
    build: {
      target: 'es2023',
      sourcemap: true,
      // pixi.js allein hat minifiziert gut 500 kB (gzip ~145 kB); die Warnung gilt den eigenen Chunks
      chunkSizeWarningLimit: 600,
      // Bibliotheken als eigene Chunks: ändern sich selten und bleiben im Browser-Cache
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'pixi', test: /node_modules[\\/](pixi\.js|@pixi)[\\/]/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
