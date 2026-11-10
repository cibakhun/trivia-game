import cookie from '@fastify/cookie';
import { API_PREFIX } from '@rdw/protocol';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { sql } from 'kysely';
import type { AppContext } from './context.ts';
import { registerErrorHandling } from './infra/errors.ts';
import { registerOriginCheck } from './infra/origin.ts';
import { combatRoutes } from './modules/combat/routes.ts';
import { registerAuth } from './modules/identity/auth-hook.ts';
import { identityRoutes } from './modules/identity/routes.ts';
import { mapRoutes } from './modules/map/routes.ts';
import { worldRoutes } from './modules/world/routes.ts';

export interface BuildAppOptions extends AppContext {
  readonly logger?: FastifyServerOptions['logger'];
}

/**
 * HTTP-Anwendung der Rolle `api` (ARCHITECTURE §3). Reihenfolge der Hooks: Cookies lesen →
 * Herkunft prüfen (vor jedem Datenbankzugriff) → Sitzung prüfen → Route.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const ctx: AppContext = { db: options.db, config: options.config };
  const app = Fastify({
    logger: options.logger ?? { level: options.config.logLevel },
    bodyLimit: 16 * 1024,
    return503OnClosing: true,
  });
  registerErrorHandling(app);
  await app.register(cookie);
  registerOriginCheck(app, options.config.publicOrigin);
  registerAuth(app, ctx);
  // Antworten mit Konto- oder Spielzustand nie zwischenspeichern, sofern die Route nichts setzt.
  // Sicherheitsheader (SECURITY §2): Die API liefert nur JSON, daher eine CSP, die nichts lädt und
  // nicht eingebettet werden darf. Die CSP der Seite selbst setzt der statische Auslieferer
  // (Phase 4, Staging); HSTS nur, wenn die Verbindung https ist (COOKIE_SECURE).
  const hsts = options.config.cookieSecure;
  app.addHook('onSend', (_request, reply, payload, done) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    if (hsts) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    done(null, payload);
  });

  await app.register(
    (api, _options, done) => {
      api.get('/health', async () => {
        await sql`select 1`.execute(ctx.db);
        return { ok: true };
      });
      identityRoutes(api, ctx);
      worldRoutes(api, ctx);
      mapRoutes(api, ctx);
      combatRoutes(api, ctx);
      done();
    },
    { prefix: API_PREFIX },
  );
  return app;
}
