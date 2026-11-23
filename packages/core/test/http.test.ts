import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from '../src';

afterEach(() => vi.unstubAllGlobals());

describe('json', () => {
  it('shows the reason given by the agent', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"Application introuvable"}', { status: 502 }));
    await expect(json('http://pc:47100/launch')).rejects.toThrow('Application introuvable');
  });

  it('never shows the query string, which can hold a key', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const error = await json('https://shelly.test/get?auth_key=SECRET').catch((e: Error) => e);
    expect(String(error)).toContain('500');
    expect(String(error)).not.toContain('SECRET');
  });
});
