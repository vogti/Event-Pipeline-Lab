import type {
  AppSettings,
  CanonicalEvent,
  DeviceStatus,
  GroupConfig,
  GroupOverview,
  PresenceUser,
  TaskCapabilities,
  TaskInfo,
  TimestampValue,
  VirtualDeviceState
} from '../types';

export interface StudentViewData {
  activeTask: TaskInfo;
  capabilities: TaskCapabilities;
  groupConfig: GroupConfig;
  groupPresence: PresenceUser[];
  feed: CanonicalEvent[];
  virtualDevice: VirtualDeviceState | null;
  settings: AppSettings;
}

export interface AdminViewData {
  tasks: TaskInfo[];
  devices: DeviceStatus[];
  virtualDevices: VirtualDeviceState[];
  groups: GroupOverview[];
  events: CanonicalEvent[];
  settings: AppSettings;
}

export type WsConnectionState = 'connecting' | 'connected' | 'disconnected';
export type FeedViewMode = 'rendered' | 'raw';
export type EventDetailsViewMode = 'rendered' | 'raw';
export type AdminPage = 'dashboard' | 'devices' | 'virtualDevices' | 'feed' | 'groupsTasks' | 'systemStatus' | 'settings';
export type CounterResetTarget = { deviceId: string; isVirtual: boolean };

export interface VirtualDevicePatch {
  buttonRedPressed?: boolean;
  buttonBlackPressed?: boolean;
  ledGreenOn?: boolean;
  ledOrangeOn?: boolean;
  temperatureC?: number;
  humidityPct?: number;
  brightness?: number;
  counterValue?: number;
}

export interface DeviceTelemetrySnapshot {
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
}

export type MetricIconKind =
  | 'temperature'
  | 'humidity'
  | 'brightness'
  | 'counter'
  | 'buttons'
  | 'leds';

