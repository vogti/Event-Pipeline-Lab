export type AppRole = 'ADMIN' | 'STUDENT';

export type LanguageMode = 'DE' | 'EN' | 'BROWSER_EN_FALLBACK';
export type VirtualDeviceTopicMode = 'OWN_TOPIC' | 'PHYSICAL_TOPIC';

export type EventCategory =
  | 'BUTTON'
  | 'COUNTER'
  | 'SENSOR'
  | 'STATUS'
  | 'INTERNAL'
  | 'COMMAND'
  | 'ACK';

export type EventFeedStage = 'BEFORE_PIPELINE' | 'AFTER_PIPELINE';

export type DeviceCommandType = 'LED_GREEN' | 'LED_ORANGE' | 'COUNTER_RESET';
export type StudentDeviceScope =
  | 'OWN_DEVICE'
  | 'OWN_AND_ADMIN_DEVICE'
  | 'ADMIN_DEVICE'
  | 'ALL_DEVICES';
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
  lecturerMode: boolean;
  deletable: boolean;
}

export interface TaskPipelineConfig {
  taskId: string;
  visibleToStudents: boolean;
  slotCount: number;
  allowedProcessingBlocks: string[];
  scenarioOverlays: string[];
  studentEventVisibilityScope: StudentDeviceScope;
  studentCommandTargetScope: StudentDeviceScope;
  availableProcessingBlocks: string[];
  minSlotCount: number;
  maxSlotCount: number;
  lecturerMode: boolean;
  overrideActive: boolean;
  updatedAt: TimestampValue;
  updatedBy: string | null;
}

export interface TaskCapabilities {
  canViewRoomEvents: boolean;
  canSendDeviceCommands: boolean;
  canFilterByTopic: boolean;
  showInternalEventsToggle: boolean;
  allowedConfigOptions: string[];
  studentCommandWhitelist: string[];
  studentEventVisibilityScope: StudentDeviceScope;
  studentCommandTargetScope: StudentDeviceScope;
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
  hasProgress: boolean;
}

export interface GroupResetProgressResponse {
  groupKey: string;
  hadProgress: boolean;
  resetPipelineStateRows: number;
  resetVirtualDevice: boolean;
  resetAt: TimestampValue;
}

export interface AppSettings {
  defaultLanguageMode: LanguageMode;
  timeFormat24h: boolean;
  studentVirtualDeviceVisible: boolean;
  adminDeviceId: string | null;
  virtualDeviceTopicMode: VirtualDeviceTopicMode;
  updatedAt: TimestampValue;
  updatedBy: string;
}

export interface FeedScenarioConfig {
  scenarioOverlays: string[];
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
  nodes: PipelineSinkNode[];
  targets: string[];
  goal: string;
}

export interface PipelineSinkNode {
  id: string;
  type: 'EVENT_FEED' | 'SEND_EVENT' | 'VIRTUAL_SIGNAL' | string;
  config: Record<string, unknown>;
}

export interface PipelineSinkRuntimeNode {
  sinkId: string;
  sinkType: string;
  receivedCount: number;
  lastReceivedAt: TimestampValue;
}

export interface PipelineSinkRuntimeSection {
  nodes: PipelineSinkRuntimeNode[];
}

export interface PipelinePermissions {
  visible: boolean;
  inputEditable: boolean;
  processingEditable: boolean;
  sinkEditable: boolean;
  stateResetAllowed: boolean;
  stateRestartAllowed: boolean;
  lecturerMode: boolean;
  allowedProcessingBlocks: string[];
  slotCount: number;
}

export interface PipelineSampleEvent {
  traceId: string;
  observedAt: TimestampValue;
  ingestTs: TimestampValue;
  deviceTs: TimestampValue;
  deviceId: string;
  topic: string;
  inputEventType: string;
  outputEventType: string | null;
  dropped: boolean;
  dropReason: string | null;
  inputPayloadJson: string;
  outputPayloadJson: string | null;
}

export interface PipelineBlockObservability {
  slotIndex: number;
  blockType: string;
  stateType: string;
  stateEntryCount: number;
  stateTtlSeconds: number | null;
  stateMemoryBytes: number;
  inCount: number;
  outCount: number;
  dropCount: number;
  errorCount: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  backlogDepth: number;
  dropReasons: Record<string, number>;
  samples: PipelineSampleEvent[];
}

export interface PipelineObservability {
  sampleEvery: number;
  maxSamplesPerBlock: number;
  observedEvents: number;
  statePersistenceMode: string;
  restartCount: number;
  lastRestartAt: TimestampValue;
  lastRestartMode: string | null;
  blocks: PipelineBlockObservability[];
}

export interface PipelineView {
  taskId: string;
  groupKey: string;
  input: PipelineInputSection;
  processing: PipelineProcessingSection;
  sink: PipelineSinkSection;
  sinkRuntime: PipelineSinkRuntimeSection;
  permissions: PipelinePermissions;
  observability: PipelineObservability;
  revision: number;
  updatedAt: TimestampValue;
  updatedBy: string;
}

export interface PipelineSinkRuntimeUpdate {
  taskId: string;
  groupKey: string;
  sinkRuntime: PipelineSinkRuntimeSection;
}

export interface PipelineObservabilityUpdate {
  taskId: string;
  groupKey: string;
  observability: PipelineObservability;
}

export interface PipelineCompareRow {
  taskId: string;
  groupKey: string;
  revision: number;
  updatedAt: TimestampValue;
  updatedBy: string;
  slotBlocks: string[];
}

export interface PipelineLogModeStatus {
  enabled: boolean;
  connected: boolean;
  kafkaBacked: boolean;
  topic: string;
  earliestOffset: number | null;
  latestOffset: number | null;
  replayDefaultMaxRecords: number;
  featureBadges: string[];
  message: string;
}

export interface PipelineLogReplayRecord {
  partition: number;
  offset: number;
  timestamp: TimestampValue;
  event: CanonicalEvent;
}

export interface PipelineLogReplayResponse {
  topic: string;
  groupKey: string;
  requestedFromOffset: number | null;
  nextOffset: number | null;
  returnedCount: number;
  records: PipelineLogReplayRecord[];
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

export interface StudentDeviceState {
  deviceId: string;
  online: boolean;
  lastSeen: TimestampValue;
  rssi: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  brightness: number | null;
  counterValue: number | null;
  buttonRedPressed: boolean | null;
  buttonBlackPressed: boolean | null;
  ledGreenOn: boolean | null;
  ledOrangeOn: boolean | null;
  uptimeMs: number | null;
  uptimeIngestTs: TimestampValue;
  updatedAt: TimestampValue;
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
