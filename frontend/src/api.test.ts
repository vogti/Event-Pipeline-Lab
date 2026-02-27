import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

interface MockResponseInit {
  status: number;
  body: unknown;
}

function jsonResponse({ status, body }: MockResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

describe('api login retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries login once for a transient 502 and then succeeds', async () => {
    const auth = {
      sessionToken: 'token-123',
      username: 'admin',
      role: 'ADMIN',
      groupKey: null,
      displayName: 'Admin',
      expiresAt: '2026-02-27T12:00:00Z'
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 502, body: { message: 'Bad Gateway' } }))
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: auth }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await api.login('admin', 'admin123');

    expect(result).toEqual(auth);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry login for non-transient auth errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 401, body: { message: 'Unauthorized' } }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(api.login('admin', 'wrong')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails after max transient retry attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 502, body: { message: 'Bad Gateway' } }))
      .mockResolvedValueOnce(jsonResponse({ status: 503, body: { message: 'Unavailable' } }))
      .mockResolvedValueOnce(jsonResponse({ status: 504, body: { message: 'Gateway Timeout' } }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(api.login('admin', 'admin123')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
