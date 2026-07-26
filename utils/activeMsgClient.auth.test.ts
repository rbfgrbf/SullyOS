import { describe, expect, it, vi } from 'vitest';
import { withAuthorizationPatchedFetch } from './activeMsgClient';

describe('ActiveMsg scoped Authorization fetch patch', () => {
  it('does not add the ActiveMsg bearer token to non-ActiveMsg requests during the patch window', async () => {
    const originalWindow = (globalThis as any).window;
    const observed: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      observed.push({ url, authorization: headers.get('Authorization') });
      return new Response(JSON.stringify({ success: true, data: { userKey: '0'.repeat(64) } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    (globalThis as any).window = {
      fetch: fetchImpl,
      location: { href: 'http://localhost:5173/', hostname: 'localhost', protocol: 'http:' },
    };

    try {
      await withAuthorizationPatchedFetch('tenant-secret', 'http://localhost:5173/api/v1', async () => {
        await window.fetch('http://localhost:5173/api/v1/get-user-key');
        await window.fetch('http://127.0.0.1:18001/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      });
    } finally {
      (globalThis as any).window = originalWindow;
    }

    expect(observed).toEqual([
      { url: 'http://localhost:5173/api/v1/get-user-key', authorization: 'Bearer tenant-secret' },
      { url: 'http://127.0.0.1:18001/mcp', authorization: null },
    ]);
  });
});
