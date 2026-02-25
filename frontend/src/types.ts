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

export interface GroupOverview {
  groupKey: string;
  onlineCount: number;
  presence: PresenceUser[];
  config: GroupConfig;
}

export interface AppSettings {
  defaultLanguageMode: LanguageMode;
  timeFormat24h: boolean;
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
