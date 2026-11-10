import { describe, expect, it } from 'vitest';
import { parseServerConfig } from '../src/index.ts';

const SECRET = Buffer.alloc(32, 1).toString('base64');
const base = {
  APP_ENV: 'local',
  DATABASE_URL: 'postgres://u@127.0.0.1:5432/rdw',
  PUBLIC_ORIGIN: 'http://localhost:5173/',
  RNG_SECRET: SECRET,
  RNG_KEY_ID: '1',
};

describe('Serverkonfiguration', () => {
  it('liest Werte mit Standardwerten', () => {
    const config = parseServerConfig(base);
    expect(config).toMatchObject({
      appEnv: 'local',
      host: '127.0.0.1',
      port: 3000,
      publicOrigin: 'http://localhost:5173',
      cookieSecure: true,
      rngKeyId: '1',
      logLevel: 'info',
    });
    expect(config.rngSecret).toHaveLength(32);
    expect(parseServerConfig({ ...base, PORT: '8080', COOKIE_SECURE: 'false' })).toMatchObject({
      port: 8080,
      cookieSecure: false,
    });
  });

  it('verlangt ein RNG-Geheimnis mit mindestens 32 Byte und nennt keine Werte', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    expect(() => parseServerConfig({ ...base, RNG_SECRET: short })).toThrow(/RNG_SECRET/);
    expect(() => parseServerConfig({ ...base, RNG_SECRET: undefined })).toThrow(/RNG_SECRET/);
    try {
      parseServerConfig({ ...base, RNG_SECRET: short });
    } catch (error) {
      expect(String(error)).not.toContain(short);
    }
    expect(() => parseServerConfig({ ...base, APP_ENV: undefined })).toThrow(/APP_ENV/);
  });

  it('verlangt in Staging und Produktion sichere Cookies und https', () => {
    const deployed = { ...base, APP_ENV: 'production', PUBLIC_ORIGIN: 'https://spiel.example' };
    expect(parseServerConfig(deployed).cookieSecure).toBe(true);
    expect(() => parseServerConfig({ ...deployed, COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(() =>
      parseServerConfig({ ...deployed, APP_ENV: 'staging', PUBLIC_ORIGIN: 'http://spiel.example' }),
    ).toThrow(/PUBLIC_ORIGIN/);
  });
});
