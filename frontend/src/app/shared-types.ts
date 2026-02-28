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
export type StudentFeedSource = 'BEFORE_PIPELINE' | 'AFTER_PIPELINE';
export type AdminFeedSource = 'AFTER_DISTURBANCES' | 'BEFORE_DISTURBANCES' | 'AFTER_PIPELINE';
export type AdminPage =
  | 'dashboard'
  | 'devices'
  | 'virtualDevices'
  | 'feed'
  | 'tasks'
  | 'groups'
  | 'scenarios'
  | 'pipeline'
  | 'systemStatus'
  | 'settings';
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

export type MqttComposerTargetType = 'physical' | 'virtual' | 'custom';
export type MqttComposerTemplate =
  | 'button'
  | 'counter'
  | 'led'
  | 'temperature'
  | 'humidity'
  // Legacy value, kept for compatibility with old drafts/configs.
  | 'dht22'
  | 'ldr'
  | 'heartbeat'
  | 'wifi'
  | 'custom';
export type MqttComposerMode = 'guided' | 'raw';

export interface MqttEventDraft {
  targetType: MqttComposerTargetType;
  template: MqttComposerTemplate;
  deviceId: string;
  buttonColor: 'red' | 'black';
  buttonPressed: boolean;
  ledColor: 'green' | 'orange';
  ledOn: boolean;
  counterValue: number;
  temperatureC: number;
  humidityPct: number;
  brightnessV: number;
  uptimeSec: number;
  rssi: number;
  customTopic: string;
  customPayload: string;
  rawTopic: string;
  rawPayload: string;
  qos: 0 | 1 | 2;
  retained: boolean;
}

export type MetricIconKind =
  | 'temperature'
  | 'humidity'
  | 'brightness'
  | 'counter'
  | 'buttons'
  | 'leds';
