export type AppRole = 'ADMIN' | 'STUDENT';

export type LanguageMode = 'DE' | 'EN' | 'BROWSER_EN_FALLBACK';

export type EventCategory =
  | 'BUTTON'
  | 'COUNTER'
  | 'SENSOR'
  | 'STATUS'
  | 'INTERNAL'
  | 'COMMAND'
  | 'ACK';

export type DeviceCommandType = 'LED_GREEN' | 'LED_ORANGE' | 'COUNTER_RESET';
export type TimestampValue = string | number | null;

export interface AuthMe {
  sessionToken: string;
  username: string;
  role: AppRole;
  groupKey: string | null;
  displayName: string;
  expiresAt: string;
}

export interface TaskInfo {
  id: string;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
  active: boolean;
}

export interface TaskCapabilities {
  canViewRoomEvents: boolean;
  canSendDeviceCommands: boolean;
  canFilterByTopic: boolean;
  showInternalEventsToggle: boolean;
  allowedConfigOptions: string[];
  studentCommandWhitelist: string[];
}

export interface GroupConfig {
  groupKey: string;
  config: Record<string, unknown>;
  revision: number;
  updatedAt: TimestampValue;
  updatedBy: string;
}

export interface PresenceUser {
  username: string;
  displayName: string;
  lastSeen: TimestampValue;
}

export interface CanonicalEvent {
  id: string;
  deviceId: string;
  topic: string;
  eventType: string;
  category: EventCategory;
  payloadJson: string;
  deviceTs: TimestampValue;
  ingestTs: TimestampValue;
  valid: boolean;
  validationErrors: string | null;
  isInternal: boolean;
  scenarioFlags: string;
  groupKey: string | null;
  sequenceNo: number | null;
}

export interface DeviceStatus {
  deviceId: string;
  online: boolean;
  lastSeen: TimestampValue;
  rssi: number | null;
  wifiPayloadJson: string | null;
  updatedAt: TimestampValue;
}

export interface DevicePinInfo {
  deviceId: string;
  pin: string;
}

export interface VirtualDeviceState {
  deviceId: string;
  groupKey: string;
  online: boolean;
  rssi: number;
  ipAddress: string;
  temperatureC: number;
  humidityPct: number;
  brightness: number;
  counterValue: number;
  buttonRedPressed: boolean;
  buttonBlackPressed: boolean;
  ledGreenOn: boolean;
  ledOrangeOn: boolean;
  updatedAt: TimestampValue;
}

export interface GroupOverview {
  groupKey: string;
  onlineCount: number;
  presence: PresenceUser[];
  config: GroupConfig;
}

export interface AppSettings {
  defaultLanguageMode: LanguageMode;
  timeFormat24h: boolean;
  studentVirtualDeviceVisible: boolean;
  updatedAt: TimestampValue;
  updatedBy: string;
}

export interface SystemStatusEventRatePoint {
  minuteTs: TimestampValue;
  eventCount: number;
}

export interface WebSocketSessionStats {
  admin: number;
  student: number;
  total: number;
}

export interface AdminSystemStatus {
  generatedAt: TimestampValue;
  eventsLast10Minutes: SystemStatusEventRatePoint[];
  cpuLoadPct: number | null;
  ramUsedBytes: number | null;
  ramTotalBytes: number | null;
  postgresSizeBytes: number;
  storedEventCount: number;
  websocketSessions: WebSocketSessionStats;
}

export interface ResetEventsResponse {
  deletedEvents: number;
  resetAt: TimestampValue;
}

export type SystemDataPart =
  | 'APP_SETTINGS'
  | 'TASK_STATE'
  | 'GROUP_STATE'
  | 'AUTH_ACCOUNTS'
  | 'DEVICE_STATUS'
  | 'VIRTUAL_DEVICE_STATE'
  | 'EVENT_DATA';

export interface SystemDataTransferDocument {
  schemaVersion: number;
  exportedAt: TimestampValue;
  parts: Record<string, unknown>;
}

export interface SystemDataImportPartInfo {
  part: SystemDataPart;
  rowCount: number;
}

export interface SystemDataImportVerifyResponse {
  valid: boolean;
  schemaVersion: number | null;
  exportedAt: TimestampValue;
  availableParts: SystemDataImportPartInfo[];
  errors: string[];
  warnings: string[];
}

export interface SystemDataImportApplyResponse {
  importedAt: TimestampValue;
  importedParts: SystemDataImportPartInfo[];
}

export interface PipelineInputSection {
  mode: string;
  deviceScope: string;
  ingestFilters: string[];
  scenarioOverlays: string[];
}

export interface PipelineSlot {
  index: number;
  blockType: string;
  config: Record<string, unknown>;
}

export interface PipelineProcessingSection {
  mode: string;
  slotCount: number;
  slots: PipelineSlot[];
}

export interface PipelineSinkSection {
  targets: string[];
  goal: string;
}

export interface PipelinePermissions {
  visible: boolean;
  inputEditable: boolean;
  processingEditable: boolean;
  sinkEditable: boolean;
  lecturerMode: boolean;
  allowedProcessingBlocks: string[];
  slotCount: number;
}

export interface PipelineView {
  taskId: string;
  groupKey: string;
  input: PipelineInputSection;
  processing: PipelineProcessingSection;
  sink: PipelineSinkSection;
  permissions: PipelinePermissions;
  revision: number;
  updatedAt: TimestampValue;
  updatedBy: string;
}

export interface StudentBootstrap {
  me: AuthMe;
  activeTask: TaskInfo;
  capabilities: TaskCapabilities;
  groupConfig: GroupConfig;
  groupPresence: PresenceUser[];
  recentFeed: CanonicalEvent[];
  virtualDevice: VirtualDeviceState | null;
  settings: AppSettings;
}

export interface WsEnvelope<T = unknown> {
  type: string;
  payload: T;
  ts: TimestampValue;
}

export interface TaskDefinitionPayload {
  id: string;
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
  studentCapabilities?: TaskCapabilities;
}
