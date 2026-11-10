import { createDb, type Db } from '@rdw/db';
import { createTestDatabase, type TestDatabase } from '@rdw/db/testing';
import { TEST_WORLD_SEED, testWorldPreset } from '@rdw/game-core';
import { API_PREFIX } from '@rdw/protocol';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { buildApp, createWorld, type CreatedWorld, type ServerConfig } from '../src/index.ts';

/** Testhelfer für den Server: eigene Datenbank je Datei, Anfragen per `inject` mit Cookie-Speicher. */

export const ORIGIN = 'http://localhost:5173';
export const TEST_RNG_SECRET = new Uint8Array(32).fill(7);

export function testConfig(databaseUrl: string): ServerConfig {
  return {
    appEnv: 'test',
    databaseUrl,
    host: '127.0.0.1',
    port: 0,
    publicOrigin: ORIGIN,
    cookieSecure: false,
    rngSecret: TEST_RNG_SECRET,
    rngKeyId: 'test',
    logLevel: 'silent',
  };
}

export interface TestServer {
  readonly app: FastifyInstance;
  readonly db: Db;
  readonly database: TestDatabase;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const database = await createTestDatabase();
  // kein db.destroy(): drop() beendet den Pool
  const db = createDb(database.pool);
  const app = await buildApp({ db, config: testConfig(database.url), logger: false });
  return {
    app,
    db,
    database,
    close: async () => {
      await app.close();
      await database.drop();
    },
  };
}

let worldCounter = 0;

export async function createTestWorld(
  db: Db,
  options: { capacity?: number; seed?: bigint } = {},
): Promise<CreatedWorld> {
  worldCounter += 1;
  return createWorld(db, {
    slug: `test-${worldCounter}-${randomUUID().slice(0, 8)}`,
    nameKey: 'world.test',
    mode: 'ETERNAL',
    seed: options.seed ?? TEST_WORLD_SEED,
    preset: testWorldPreset(),
    capacity: options.capacity ?? 50,
  });
}

interface RequestOptions {
  readonly headers?: Record<string, string>;
  readonly payload?: InjectOptions['payload'];
  /** `null` = ohne Origin-Header; Standard bei POST: die Client-Herkunft. */
  readonly origin?: string | null;
}

/** Ein Browser im Kleinen: hält Cookies (ohne Pfadprüfung) und setzt Origin bei POST. */
export class TestClient {
  readonly cookies = new Map<string, string>();
  constructor(private readonly app: FastifyInstance) {}

  async request(method: 'GET' | 'POST', path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { ...options.headers };
    const origin =
      options.origin === undefined ? (method === 'GET' ? null : ORIGIN) : options.origin;
    if (origin !== null) headers.origin = origin;
    const response = await this.app.inject({
      method,
      url: `${API_PREFIX}${path}`,
      headers,
      cookies: Object.fromEntries(this.cookies),
      ...(options.payload === undefined ? {} : { payload: options.payload }),
    });
    for (const cookie of response.cookies as {
      name: string;
      value: string;
      maxAge?: number;
      expires?: Date;
    }[]) {
      const expired =
        cookie.maxAge === 0 ||
        (cookie.expires !== undefined && cookie.expires.getTime() <= Date.now());
      if (expired) this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
    return response;
  }

  get(path: string, options?: RequestOptions) {
    return this.request('GET', path, options);
  }

  post(path: string, options?: RequestOptions) {
    return this.request('POST', path, options);
  }

  /** Bootstrap und Gastkonto in einem Schritt. */
  async signUpGuest(): Promise<string> {
    await this.get('/auth/bootstrap');
    const response = await this.post('/auth/guest');
    if (response.statusCode !== 201)
      throw new Error(`Gastkonto: ${response.statusCode} ${response.body}`);
    return response.json<{ user: { id: string } }>().user.id;
  }

  join(worldId: string, key: string = randomUUID()) {
    return this.post(`/worlds/${worldId}/join`, { headers: { 'idempotency-key': key } });
  }
}

export function setCookieHeader(
  response: LightMyRequestResponse,
  name: string,
): string | undefined {
  const raw = response.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return all.find((value) => value.startsWith(`${name}=`));
}
