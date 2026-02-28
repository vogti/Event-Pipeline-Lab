import type {
  AdminSystemStatus,
  AppSettings,
  AuthMe,
  CanonicalEvent,
  DeviceCommandType,
  DevicePinInfo,
  EventFeedStage,
  ResetEventsResponse,
  FeedScenarioConfig,
  StudentDeviceScope,
  SystemDataImportApplyResponse,
  SystemDataImportVerifyResponse,
  SystemDataPart,
  DeviceStatus,
  GroupConfig,
  GroupOverview,
  GroupResetProgressResponse,
  LanguageMode,
  PipelineInputSection,
  PipelineLogModeStatus,
  PipelineLogReplayResponse,
  PipelineCompareRow,
  PipelineProcessingSection,
  PipelineSinkSection,
  PipelineSinkRuntimeUpdate,
  TaskPipelineConfig,
  PipelineView,
  StudentBootstrap,
  StudentDeviceState,
  TaskInfo,
  VirtualDeviceTopicMode,
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

function isTransientGatewayError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
  }
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}

async function requestWithGatewayRetry<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
  maxAttempts = 3
): Promise<T> {
  const attempts = Math.max(1, Math.min(maxAttempts, 5));
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request<T>(path, options, token);
    } catch (error) {
      lastError = error;
      if (!isTransientGatewayError(error) || attempt >= attempts) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
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
    return requestWithGatewayRetry<AuthMe>('/api/auth/login', {
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

  studentPublishMqttEvent(
    token: string,
    topic: string,
    payload: string,
    qos: 0 | 1 | 2,
    retained: boolean,
    targetDeviceId: string
  ): Promise<void> {
    return request<void>(
      '/api/student/events/publish',
      {
        method: 'POST',
        body: JSON.stringify({ topic, payload, qos, retained, targetDeviceId })
      },
      token
    );
  },

  studentDeviceState(token: string, deviceId: string): Promise<StudentDeviceState> {
    return request<StudentDeviceState>(
      withQuery('/api/student/device-state', { deviceId }),
      undefined,
      token
    );
  },

  adminTasks(token: string): Promise<TaskInfo[]> {
    return request<TaskInfo[]>('/api/admin/tasks', undefined, token);
  },

  adminTaskPipelineConfig(token: string, taskId: string): Promise<TaskPipelineConfig> {
    return request<TaskPipelineConfig>(
      withQuery('/api/admin/task-pipeline-config', { taskId }),
      undefined,
      token
    );
  },

  updateAdminTaskPipelineConfig(
    token: string,
    taskId: string,
    visibleToStudents: boolean,
    slotCount: number,
    allowedProcessingBlocks: string[],
    scenarioOverlays: string[],
    studentEventVisibilityScope: StudentDeviceScope,
    studentCommandTargetScope: StudentDeviceScope,
    studentSendEventEnabled: boolean
  ): Promise<TaskPipelineConfig> {
    return request<TaskPipelineConfig>(
      '/api/admin/task-pipeline-config',
      {
        method: 'POST',
        body: JSON.stringify({
          taskId,
          visibleToStudents,
          slotCount,
          allowedProcessingBlocks,
          scenarioOverlays,
          studentEventVisibilityScope,
          studentCommandTargetScope,
          studentSendEventEnabled
        })
      },
      token
    );
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

  updateAdminTaskDetails(
    token: string,
    args: {
      taskId: string;
      titleDe: string;
      titleEn: string;
      descriptionDe: string;
      descriptionEn: string;
      activeDescriptionDe: string;
      activeDescriptionEn: string;
    }
  ): Promise<TaskInfo> {
    return request<TaskInfo>(
      '/api/admin/task/update',
      {
        method: 'POST',
        body: JSON.stringify(args)
      },
      token
    );
  },

  createAdminTask(
    token: string,
    args: {
      taskId?: string | null;
      titleDe: string;
      titleEn: string;
      descriptionDe: string;
      descriptionEn: string;
      activeDescriptionDe: string;
      activeDescriptionEn: string;
      templateTaskId?: string | null;
    }
  ): Promise<TaskInfo> {
    return request<TaskInfo>(
      '/api/admin/task/create',
      {
        method: 'POST',
        body: JSON.stringify(args)
      },
      token
    );
  },

  reorderAdminTasks(token: string, taskIds: string[]): Promise<TaskInfo[]> {
    return request<TaskInfo[]>(
      '/api/admin/task/reorder',
      {
        method: 'POST',
        body: JSON.stringify({ taskIds })
      },
      token
    );
  },

  deleteAdminTask(token: string, taskId: string): Promise<TaskInfo[]> {
    return request<TaskInfo[]>(
      '/api/admin/task/delete',
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

  adminResetGroupProgress(token: string, groupKey: string): Promise<GroupResetProgressResponse> {
    return request<GroupResetProgressResponse>(
      `/api/admin/groups/${encodeURIComponent(groupKey)}/reset-progress`,
      {
        method: 'POST'
      },
      token
    );
  },

  adminSettings(token: string): Promise<AppSettings> {
    return request<AppSettings>('/api/admin/settings', undefined, token);
  },

  scenarios(token: string): Promise<FeedScenarioConfig> {
    return request<FeedScenarioConfig>('/api/scenarios', undefined, token);
  },

  adminScenarios(token: string): Promise<FeedScenarioConfig> {
    return request<FeedScenarioConfig>('/api/admin/scenarios', undefined, token);
  },

  updateAdminScenarios(token: string, scenarioOverlays: string[]): Promise<FeedScenarioConfig> {
    return request<FeedScenarioConfig>(
      '/api/admin/scenarios',
      {
        method: 'POST',
        body: JSON.stringify({ scenarioOverlays })
      },
      token
    );
  },

  adminSystemStatus(token: string): Promise<AdminSystemStatus> {
    return request<AdminSystemStatus>('/api/admin/system-status', undefined, token);
  },

  adminPublishMqttEvent(
    token: string,
    topic: string,
    payload: string,
    qos: 0 | 1 | 2,
    retained: boolean
  ): Promise<void> {
    return request<void>(
      '/api/admin/events/publish',
      {
        method: 'POST',
        body: JSON.stringify({ topic, payload, qos, retained })
      },
      token
    );
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
    studentVirtualDeviceVisible: boolean,
    adminDeviceId: string | null,
    virtualDeviceTopicMode: VirtualDeviceTopicMode
  ): Promise<AppSettings> {
    return request<AppSettings>(
      '/api/admin/settings',
      {
        method: 'POST',
        body: JSON.stringify({
          defaultLanguageMode,
          timeFormat24h,
          studentVirtualDeviceVisible,
          adminDeviceId,
          virtualDeviceTopicMode
        })
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

  studentPipeline(token: string): Promise<PipelineView> {
    return request<PipelineView>('/api/student/pipeline', undefined, token);
  },

  updateStudentPipeline(
    token: string,
    processing: PipelineProcessingSection,
    sink: PipelineSinkSection
  ): Promise<PipelineView> {
    return request<PipelineView>(
      '/api/student/pipeline',
      {
        method: 'POST',
        body: JSON.stringify({ processing, sink })
      },
      token
    );
  },

  resetStudentPipelineState(token: string): Promise<PipelineView> {
    return request<PipelineView>(
      '/api/student/pipeline/state/reset',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'RESET_STATE' })
      },
      token
    );
  },

  resetStudentPipelineSinkCounter(token: string, sinkId: string): Promise<PipelineSinkRuntimeUpdate> {
    return request<PipelineSinkRuntimeUpdate>(
      '/api/student/pipeline/sink/reset',
      {
        method: 'POST',
        body: JSON.stringify({ sinkId })
      },
      token
    );
  },

  adminPipeline(token: string, groupKey: string): Promise<PipelineView> {
    return request<PipelineView>(
      withQuery('/api/admin/pipeline', { groupKey }),
      undefined,
      token
    );
  },

  adminPipelineCompare(token: string): Promise<PipelineCompareRow[]> {
    return request<PipelineCompareRow[]>(
      '/api/admin/pipeline/compare',
      undefined,
      token
    );
  },

  updateAdminPipeline(
    token: string,
    groupKey: string,
    input: PipelineInputSection,
    processing: PipelineProcessingSection,
    sink: PipelineSinkSection
  ): Promise<PipelineView> {
    return request<PipelineView>(
      '/api/admin/pipeline',
      {
        method: 'POST',
        body: JSON.stringify({ groupKey, input, processing, sink })
      },
      token
    );
  },

  controlAdminPipelineState(
    token: string,
    groupKey: string,
    action: 'RESET_STATE' | 'RESTART_STATE_LOST' | 'RESTART_STATE_RETAINED'
  ): Promise<PipelineView> {
    return request<PipelineView>(
      '/api/admin/pipeline/state/control',
      {
        method: 'POST',
        body: JSON.stringify({ groupKey, action })
      },
      token
    );
  },

  resetAdminPipelineSinkCounter(
    token: string,
    groupKey: string,
    sinkId: string
  ): Promise<PipelineSinkRuntimeUpdate> {
    return request<PipelineSinkRuntimeUpdate>(
      '/api/admin/pipeline/sink/reset',
      {
        method: 'POST',
        body: JSON.stringify({ groupKey, sinkId })
      },
      token
    );
  },

  adminPipelineLogModeStatus(token: string): Promise<PipelineLogModeStatus> {
    return request<PipelineLogModeStatus>(
      '/api/admin/pipeline/log-mode/status',
      undefined,
      token
    );
  },

  adminPipelineLogReplay(
    token: string,
    args: { groupKey: string; fromOffset?: number | null; maxRecords?: number | null }
  ): Promise<PipelineLogReplayResponse> {
    return request<PipelineLogReplayResponse>(
      '/api/admin/pipeline/log-mode/replay',
      {
        method: 'POST',
        body: JSON.stringify({
          groupKey: args.groupKey,
          fromOffset: args.fromOffset ?? null,
          maxRecords: args.maxRecords ?? null
        })
      },
      token
    );
  },

  eventsFeed(
    token: string,
    args: {
      limit?: number;
      topicContains?: string;
      category?: string;
      includeInternal?: boolean;
      deviceId?: string;
      stage?: EventFeedStage;
    } = {}
  ): Promise<CanonicalEvent[]> {
    return request<CanonicalEvent[]>(
      withQuery('/api/events/feed', {
        limit: args.limit,
        topicContains: args.topicContains,
        category: args.category,
        includeInternal: args.includeInternal,
        deviceId: args.deviceId,
        stage: args.stage
      }),
      undefined,
      token
    );
  }
};
