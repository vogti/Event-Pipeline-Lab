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
      expiresAt: '2026-02-27T12:00:00Z',
      deploymentGitHash: 'abc1234',
      deploymentCommitUrl: 'https://github.com/example/repo/commit/abc1234',
      deploymentBuildTs: '2026-02-27T11:59:00Z',
      deploymentDirty: false
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

describe('events feed limit clamping', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clamps requested limit to backend max to avoid validation failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await api.eventsFeed('token-1', { limit: 2000, includeInternal: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(path, 'http://localhost');
    expect(parsed.pathname).toBe('/api/events/feed');
    expect(parsed.searchParams.get('limit')).toBe('500');
  });
});

describe('admin password update api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends current and new password to auth endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: null }));
    vi.stubGlobal('fetch', fetchMock);

    await api.updateAdminPassword('token-admin', 'old-pass', 'new-pass');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/auth/admin-password');
    expect(requestInit.method).toBe('POST');

    const body = JSON.parse(String(requestInit.body)) as Record<string, string>;
    expect(body.currentPassword).toBe('old-pass');
    expect(body.newPassword).toBe('new-pass');
  });
});

describe('system data import apply api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends selected parts as a single multipart field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 200, body: { importedAt: '2026-03-08T21:00:00Z', importedParts: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Blob(['{}'], { type: 'application/json' })], 'export.zip', {
      type: 'application/zip'
    });
    await api.adminApplySystemDataImport('token-admin', file, [
      'APP_SETTINGS',
      'TASK_STATE',
      'TASK_DEFINITION_STATE'
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.method).toBe('POST');
    expect(requestInit.body).toBeInstanceOf(FormData);

    const body = requestInit.body as FormData;
    expect(body.getAll('selectedParts')).toEqual(['APP_SETTINGS,TASK_STATE,TASK_DEFINITION_STATE']);
  });
});
