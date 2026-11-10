import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, registerErrorHandling } from '../src/infra/errors.ts';

/** Fehlerformat (API.md §5) ohne Datenbank: Fastify-Fehler, wiederholbare SQLSTATEs, Unerwartetes. */
const app = Fastify({ logger: false, bodyLimit: 64 });

beforeAll(async () => {
  registerErrorHandling(app);
  app.get('/fachlich', () => {
    throw new ApiError(409, 'REGION_UNDER_SIEGE', 'belagert', { regionId: '1' });
  });
  app.get('/serialisierung', () => {
    throw Object.assign(new Error('could not serialize access'), { code: '40001' });
  });
  app.get('/verklemmung', () => {
    throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
  });
  app.get('/anderer-sqlstate', () => {
    throw Object.assign(new Error('unique violation'), { code: '23505' });
  });
  app.get('/unerwartet', () => {
    throw new Error('geheimes Detail');
  });
  app.post('/echo', (request) => request.body);
  await app.ready();
});

afterAll(() => app.close());

function body(response: { json(): unknown }) {
  return (response.json() as { error: { code: string; message: string } }).error;
}

describe('Fehlerformat', () => {
  it('gibt fachliche Fehler mit Code und Details weiter', async () => {
    const response = await app.inject({ method: 'GET', url: '/fachlich' });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'REGION_UNDER_SIEGE', message: 'belagert', details: { regionId: '1' } },
    });
  });

  it('meldet Serialisierungsfehler und Verklemmungen als wiederholbar', async () => {
    for (const url of ['/serialisierung', '/verklemmung']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(409);
      expect(body(response).code).toBe('CONCURRENT_UPDATE');
    }
  });

  it('verrät bei unerwarteten Fehlern nichts', async () => {
    for (const url of ['/anderer-sqlstate', '/unerwartet']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(500);
      expect(body(response).code).toBe('INTERNAL_ERROR');
      expect(response.body).not.toMatch(/geheimes Detail|unique violation/);
    }
  });

  it('lehnt zu große Anfragen und andere Formate als JSON ab', async () => {
    const large = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ text: 'x'.repeat(200) }),
    });
    expect(large.statusCode).toBe(413);
    expect(body(large).code).toBe('PAYLOAD_TOO_LARGE');
    const xml = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/xml' },
      payload: '<a/>',
    });
    expect(xml.statusCode).toBe(415);
    expect(body(xml).code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const broken = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{kaputt',
    });
    expect(broken.statusCode).toBe(400);
    expect(body(broken).code).toBe('VALIDATION_FAILED');
  });

  it('antwortet auf unbekannte Pfade im selben Format', async () => {
    const response = await app.inject({ method: 'GET', url: '/gibt-es-nicht' });
    expect(response.statusCode).toBe(404);
    expect(body(response).code).toBe('NOT_FOUND');
  });
});
