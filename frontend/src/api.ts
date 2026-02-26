import type {
  AdminSystemStatus,
  AppSettings,
  AuthMe,
  CanonicalEvent,
  DeviceCommandType,
  DevicePinInfo,
  ResetEventsResponse,
  SystemDataImportApplyResponse,
  SystemDataImportVerifyResponse,
  SystemDataPart,
  DeviceStatus,
  GroupConfig,
  GroupOverview,
  LanguageMode,
  StudentBootstrap,
  TaskInfo,
  VirtualDeviceState
} from './types';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    params.set(key, String(value));
  });

  const qs = params.toString();
  return qs.length === 0 ? path : `${path}?${qs}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function defaultMessageForStatus(status: number): string {
  if (status === 400) {
    return 'Bad request';
  }
  if (status === 401) {
    return 'Unauthorized';
  }
  if (status === 403) {
    return 'Forbidden';
  }
  if (status === 404) {
    return 'Not found';
  }
  return `HTTP ${status}`;
}

function messageFromErrorPayload(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>;
    if (typeof data.message === 'string' && data.message.length > 0) {
      return data.message;
    }
    if (typeof data.error === 'string' && data.error.length > 0) {
      return data.error;
    }
  }
  if (typeof payload === 'string' && payload.length > 0) {
    return payload;
  }
  return fallback;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!headers.has('Content-Type') && options.body !== undefined && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('X-EPL-Session', token);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    const details = await parseResponseBody(response);
    const fallback = defaultMessageForStatus(response.status);
    throw new ApiError(response.status, messageFromErrorPayload(details, fallback), details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await parseResponseBody(response)) as T;
}

async function requestBlob(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<Blob> {
  const headers = new Headers(options.headers ?? {});
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!headers.has('Content-Type') && options.body !== undefined && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('X-EPL-Session', token);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  });

  if (!response.ok) {
    const details = await parseResponseBody(response);
    const fallback = defaultMessageForStatus(response.status);
    throw new ApiError(response.status, messageFromErrorPayload(details, fallback), details);
  }

  return response.blob();
}

export const api = {
  login(username: string, pin: string): Promise<AuthMe> {
    return request<AuthMe>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, pin })
    });
  },

  logout(token: string): Promise<void> {
    return request<void>(
      '/api/auth/logout',
      {
        method: 'POST'
      },
      token
    );
  },

  me(token: string): Promise<AuthMe> {
    return request<AuthMe>('/api/auth/me', undefined, token);
  },

  updateDisplayName(token: string, displayName: string): Promise<AuthMe> {
    return request<AuthMe>(
      '/api/auth/display-name',
      {
        method: 'POST',
        body: JSON.stringify({ displayName })
      },
      token
    );
  },

  studentBootstrap(token: string): Promise<StudentBootstrap> {
    return request<StudentBootstrap>('/api/student/bootstrap', undefined, token);
  },

  updateStudentConfig(token: string, config: Record<string, unknown>): Promise<GroupConfig> {
    return request<GroupConfig>(
      '/api/student/config',
      {
        method: 'POST',
        body: JSON.stringify({ config })
      },
      token
    );
  },

  sendStudentCommand(token: string, deviceId: string, command: DeviceCommandType, on?: boolean): Promise<void> {
    return request<void>(
      '/api/student/command',
      {
        method: 'POST',
        body: JSON.stringify({ deviceId, command, on })
      },
      token
    );
  },

  adminTasks(token: string): Promise<TaskInfo[]> {
    return request<TaskInfo[]>('/api/admin/tasks', undefined, token);
  },

  activateTask(token: string, taskId: string): Promise<TaskInfo> {
    return request<TaskInfo>(
      '/api/admin/task/activate',
      {
        method: 'POST',
        body: JSON.stringify({ taskId })
      },
      token
    );
  },

  adminDevices(token: string): Promise<DeviceStatus[]> {
    return request<DeviceStatus[]>('/api/admin/devices', undefined, token);
  },

  adminDeviceCommand(token: string, deviceId: string, command: DeviceCommandType, on?: boolean): Promise<void> {
    return request<void>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/command`,
      {
        method: 'POST',
        body: JSON.stringify({ command, on })
      },
      token
    );
  },

  adminDevicePin(token: string, deviceId: string): Promise<DevicePinInfo> {
    return request<DevicePinInfo>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/pin`,
      undefined,
      token
    );
  },

  updateAdminDevicePin(token: string, deviceId: string, pin: string): Promise<DevicePinInfo> {
    return request<DevicePinInfo>(
      `/api/admin/devices/${encodeURIComponent(deviceId)}/pin`,
      {
        method: 'POST',
        body: JSON.stringify({ pin })
      },
      token
    );
  },

  adminGroups(token: string): Promise<GroupOverview[]> {
    return request<GroupOverview[]>('/api/admin/groups', undefined, token);
  },

  adminSettings(token: string): Promise<AppSettings> {
    return request<AppSettings>('/api/admin/settings', undefined, token);
  },

  adminSystemStatus(token: string): Promise<AdminSystemStatus> {
    return request<AdminSystemStatus>('/api/admin/system-status', undefined, token);
  },

  adminExportSystemData(token: string, parts: SystemDataPart[]): Promise<Blob> {
    return requestBlob(
      '/api/admin/system-status/export',
      {
        method: 'POST',
        body: JSON.stringify({ parts })
      },
      token
    );
  },

  adminVerifySystemDataImport(
    token: string,
    file: File
  ): Promise<SystemDataImportVerifyResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return request<SystemDataImportVerifyResponse>(
      '/api/admin/system-status/import/verify',
      {
        method: 'POST',
        body: formData
      },
      token
    );
  },

  adminApplySystemDataImport(
    token: string,
    file: File,
    selectedParts: SystemDataPart[]
  ): Promise<SystemDataImportApplyResponse> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    for (const part of selectedParts) {
      formData.append('selectedParts', part);
    }
    return request<SystemDataImportApplyResponse>(
      '/api/admin/system-status/import/apply',
      {
        method: 'POST',
        body: formData
      },
      token
    );
  },

  adminResetEvents(token: string): Promise<ResetEventsResponse> {
    return request<ResetEventsResponse>(
      '/api/admin/system-status/events/reset',
      {
        method: 'POST',
        body: JSON.stringify({ confirm: true })
      },
      token
    );
  },

  updateAdminSettings(
    token: string,
    defaultLanguageMode: LanguageMode,
    timeFormat24h: boolean,
    studentVirtualDeviceVisible: boolean
  ): Promise<AppSettings> {
    return request<AppSettings>(
      '/api/admin/settings',
      {
        method: 'POST',
        body: JSON.stringify({ defaultLanguageMode, timeFormat24h, studentVirtualDeviceVisible })
      },
      token
    );
  },

  adminVirtualDevices(token: string): Promise<VirtualDeviceState[]> {
    return request<VirtualDeviceState[]>('/api/admin/virtual-devices', undefined, token);
  },

  adminVirtualDeviceControl(
    token: string,
    deviceId: string,
    patch: Partial<VirtualDeviceState>
  ): Promise<VirtualDeviceState> {
    return request<VirtualDeviceState>(
      `/api/admin/virtual-devices/${encodeURIComponent(deviceId)}/control`,
      {
        method: 'POST',
        body: JSON.stringify(patch)
      },
      token
    );
  },

  studentVirtualDeviceControl(
    token: string,
    patch: Partial<VirtualDeviceState>
  ): Promise<VirtualDeviceState> {
    return request<VirtualDeviceState>(
      '/api/student/virtual-device/control',
      {
        method: 'POST',
        body: JSON.stringify(patch)
      },
      token
    );
  },

  studentVirtualDevice(token: string): Promise<VirtualDeviceState> {
    return request<VirtualDeviceState>('/api/student/virtual-device', undefined, token);
  },

  eventsFeed(
    token: string,
    args: {
      limit?: number;
      topicContains?: string;
      category?: string;
      includeInternal?: boolean;
      deviceId?: string;
    } = {}
  ): Promise<CanonicalEvent[]> {
    return request<CanonicalEvent[]>(
      withQuery('/api/events/feed', {
        limit: args.limit,
        topicContains: args.topicContains,
        category: args.category,
        includeInternal: args.includeInternal,
        deviceId: args.deviceId
      }),
      undefined,
      token
    );
  }
};
