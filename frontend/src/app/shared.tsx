import { ApiError } from '../api';
import type {
  AdminSystemStatus,
  AppSettings,
  CanonicalEvent,
  DeviceStatus,
  EventCategory,
  GroupConfig,
  GroupOverview,
  PresenceUser,
  SystemDataPart,
  SystemStatusEventRatePoint,
  TaskCapabilities,
  TaskInfo,
  TimestampValue,
  VirtualDeviceState
} from '../types';
import type { I18nKey, Language } from '../i18n';
import type {
  AdminPage,
  AdminViewData,
  CounterResetTarget,
  DeviceTelemetrySnapshot,
  EventDetailsViewMode,
  FeedViewMode,
  MetricIconKind,
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft,
  StudentViewData,
  VirtualDevicePatch,
  WsConnectionState
} from './shared-types';
import { AdminIcon, MetricIcon, SettingsIcon } from './shared-icons';
import { parsePipelineScenarioOverlays } from './pipeline-scenarios';

const TOKEN_STORAGE_KEY = 'epl.sessionToken';
const LANGUAGE_STORAGE_KEY = 'epl.languageOverride';
const MAX_FEED_EVENTS = 200;
const SYSTEM_DATA_PART_ORDER: SystemDataPart[] = [
  'APP_SETTINGS',
  'TASK_STATE',
  'GROUP_STATE',
  'AUTH_ACCOUNTS',
  'DEVICE_STATUS',
  'VIRTUAL_DEVICE_STATE',
  'EVENT_DATA'
];

function isAdminFeedHotPage(page: AdminPage): boolean {
  return page === 'feed' || page === 'dashboard';
}

const CATEGORY_OPTIONS: Array<EventCategory | 'ALL'> = [
  'ALL',
  'BUTTON',
  'COUNTER',
  'SENSOR',
  'STATUS',
  'INTERNAL',
  'COMMAND',
  'ACK'
];

function createSystemDataPartSelection(defaultChecked: boolean): Record<SystemDataPart, boolean> {
  const next = {} as Record<SystemDataPart, boolean>;
  for (const part of SYSTEM_DATA_PART_ORDER) {
    next[part] = defaultChecked;
  }
  return next;
}

function selectedSystemDataParts(selection: Record<SystemDataPart, boolean>): SystemDataPart[] {
  return SYSTEM_DATA_PART_ORDER.filter((part) => selection[part]);
}

function systemDataPartLabel(part: SystemDataPart, t: (key: I18nKey) => string): string {
  switch (part) {
    case 'APP_SETTINGS':
      return t('partAppSettings');
    case 'TASK_STATE':
      return t('partTaskState');
    case 'GROUP_STATE':
      return t('partGroupState');
    case 'AUTH_ACCOUNTS':
      return t('partAuthAccounts');
    case 'DEVICE_STATUS':
      return t('partDeviceStatus');
    case 'VIRTUAL_DEVICE_STATE':
      return t('partVirtualDeviceState');
    case 'EVENT_DATA':
      return t('partEventData');
    default:
      return part;
  }
}

function timestampToEpochMillis(value: TimestampValue): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.abs(value) < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Math.abs(numeric) < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function compareByNewestIngestTs(a: CanonicalEvent, b: CanonicalEvent): number {
  const aEpoch = timestampToEpochMillis(a.ingestTs) ?? Number.MIN_SAFE_INTEGER;
  const bEpoch = timestampToEpochMillis(b.ingestTs) ?? Number.MIN_SAFE_INTEGER;
  if (aEpoch === bEpoch) {
    return b.id.localeCompare(a.id);
  }
  return bEpoch - aEpoch;
}

function mergeEventsBounded(
  existing: CanonicalEvent[],
  incoming: CanonicalEvent[],
  maxSize: number
): CanonicalEvent[] {
  if (incoming.length === 0) {
    return existing;
  }

  const byId = new Map(existing.map((event) => [event.id, event]));
  let changed = false;
  for (const event of incoming) {
    if (byId.has(event.id)) {
      continue;
    }
    byId.set(event.id, event);
    changed = true;
  }
  if (!changed) {
    return existing;
  }

  const merged = Array.from(byId.values()).sort(compareByNewestIngestTs).slice(0, maxSize);
  if (
    merged.length === existing.length &&
    merged.every((event, index) => event.id === existing[index]?.id)
  ) {
    return existing;
  }
  return merged;
}

function clampFeed(items: CanonicalEvent[]): CanonicalEvent[] {
  return mergeEventsBounded([], items, MAX_FEED_EVENTS);
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashPct(id: string, salt: string): number {
  return stableHash(`${id}::${salt}`) % 100;
}

function hashRange(id: string, salt: string, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  const span = max - min + 1;
  return min + (stableHash(`${id}::${salt}`) % span);
}

function withScenarioFlag(event: CanonicalEvent, flag: string): string {
  const raw = (event.scenarioFlags ?? '').trim();
  if (!raw || raw === '{}' || raw === '[]') {
    return flag;
  }
  if (raw.includes(flag)) {
    return raw;
  }
  return `${raw};${flag}`;
}

interface FeedScenarioDisturbanceResult {
  events: CanonicalEvent[];
  nextReleaseAt: number | null;
}

function buildFeedScenarioDisturbances(
  events: CanonicalEvent[],
  scenarioOverlays: string[] | null | undefined,
  nowEpochMs: number = Date.now()
): FeedScenarioDisturbanceResult {
  const scenarios = parsePipelineScenarioOverlays(scenarioOverlays);
  const duplicatesPct = scenarios.duplicates ?? 0;
  const delayMs = scenarios.delay ?? 0;
  const dropsPct = scenarios.drops ?? 0;
  const outOfOrderPct = scenarios.out_of_order ?? 0;
  const reorderBufferMs =
    outOfOrderPct > 0
      ? Math.max(0, scenarios.reorder_buffer ?? 1000)
      : 0;

  if (
    duplicatesPct <= 0 &&
    delayMs <= 0 &&
    dropsPct <= 0 &&
    outOfOrderPct <= 0
  ) {
    return { events, nextReleaseAt: null };
  }

  const effectiveNowEpochMs = Number.isFinite(nowEpochMs) ? nowEpochMs : Date.now();
  const visible: Array<{ event: CanonicalEvent; sortTs: number }> = [];
  let nextReleaseAt: number | null = null;

  const addIfReleased = (event: CanonicalEvent, releaseAt: number, sortTs: number): void => {
    if (releaseAt <= effectiveNowEpochMs) {
      visible.push({ event, sortTs });
      return;
    }
    if (nextReleaseAt === null || releaseAt < nextReleaseAt) {
      nextReleaseAt = releaseAt;
    }
  };

  for (const event of events) {
    const ingestEpoch = timestampToEpochMillis(event.ingestTs) ?? Number.MIN_SAFE_INTEGER;
    const eventId = event.id;

    if (dropsPct > 0 && hashPct(eventId, 'drop') < dropsPct) {
      continue;
    }

    const delayOffset = delayMs > 0 ? hashRange(eventId, 'delay', 0, delayMs) : 0;
    const reorderOffset =
      outOfOrderPct > 0 && reorderBufferMs > 0 && hashPct(eventId, 'ooo') < outOfOrderPct
        ? hashRange(eventId, 'ooodelta', -reorderBufferMs, reorderBufferMs)
        : 0;
    const releaseAt = ingestEpoch + delayOffset + reorderBufferMs + reorderOffset;

    addIfReleased(
      {
        ...event,
        scenarioFlags: withScenarioFlag(event, 'disturbed')
      },
      releaseAt,
      releaseAt
    );

    if (duplicatesPct > 0 && hashPct(eventId, 'duplicate') < duplicatesPct) {
      const duplicateReleaseAt = releaseAt + hashRange(eventId, 'dup_shift', 10, 350);
      addIfReleased(
        {
          ...event,
          id: `${event.id}::dup`,
          scenarioFlags: withScenarioFlag(event, 'duplicate')
        },
        duplicateReleaseAt,
        duplicateReleaseAt
      );
    }
  }

  const transformed = visible
    .sort((left, right) => {
      if (left.sortTs === right.sortTs) {
        return right.event.id.localeCompare(left.event.id);
      }
      return right.sortTs - left.sortTs;
    })
    .map((entry) => entry.event)
    .slice(0, MAX_FEED_EVENTS);

  return { events: transformed, nextReleaseAt };
}

function applyFeedScenarioDisturbances(
  events: CanonicalEvent[],
  scenarioOverlays: string[] | null | undefined,
  nowEpochMs?: number
): CanonicalEvent[] {
  return buildFeedScenarioDisturbances(events, scenarioOverlays, nowEpochMs).events;
}

function nextFeedScenarioReleaseAt(
  events: CanonicalEvent[],
  scenarioOverlays: string[] | null | undefined,
  nowEpochMs?: number
): number | null {
  return buildFeedScenarioDisturbances(events, scenarioOverlays, nowEpochMs).nextReleaseAt;
}

function isLikelyEpochTimestamp(value: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  if (value >= 946_684_800_000 && value <= 4_102_444_800_000) {
    return true;
  }
  if (value >= 946_684_800 && value <= 4_102_444_800) {
    return true;
  }
  return false;
}

function isCounterEvent(event: CanonicalEvent): boolean {
  const lowerTopic = event.topic.toLowerCase();
  const lowerEventType = event.eventType.toLowerCase();
  return (
    event.category === 'COUNTER' ||
    lowerTopic.includes('/counter') ||
    lowerEventType.includes('counter')
  );
}

function extractCounterValueFromPayload(payload: unknown, allowLooseValue: boolean): number | null {
  const strictCounter =
    firstNumber(payload, [
      ['counter'],
      ['count'],
      ['total'],
      ['counterValue'],
      ['counter_value'],
      ['blueCounter'],
      ['params', 'counter:0', 'value'],
      ['params', 'counter:100', 'value']
    ]) ??
    findNumberByKeys(payload, [
      'counter',
      'count',
      'total',
      'counterValue',
      'counter_value',
      'blueCounter'
    ]);

  if (strictCounter !== null) {
    return isLikelyEpochTimestamp(strictCounter) ? null : strictCounter;
  }

  if (!allowLooseValue) {
    return null;
  }

  const looseValue = firstNumber(payload, [['value']]);
  if (looseValue === null) {
    return null;
  }
  return isLikelyEpochTimestamp(looseValue) ? null : looseValue;
}

function looksLikeIpAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const ipv4Match = trimmed.match(/^(\d{1,3})(?:\.(\d{1,3})){3}$/);
  if (ipv4Match) {
    const parts = trimmed.split('.');
    return parts.every((part) => {
      const parsed = Number(part);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
    });
  }

  if (trimmed.includes(':') && /^[0-9a-fA-F:]+$/.test(trimmed)) {
    return true;
  }
  return false;
}

function ipAddressToHref(ipAddress: string): string | null {
  const trimmed = ipAddress.trim();
  if (!looksLikeIpAddress(trimmed)) {
    return null;
  }
  if (trimmed.includes(':')) {
    return `http://[${trimmed}]`;
  }
  return `http://${trimmed}`;
}

function findIpAddress(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null || node === undefined) {
    return null;
  }

  if (typeof node === 'string') {
    return looksLikeIpAddress(node) ? node.trim() : null;
  }
  if (typeof node === 'number' || typeof node === 'boolean') {
    return null;
  }
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findIpAddress(entry, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  }

  const objectNode = node as Record<string, unknown>;
  const priorityKeys = ['ip', 'ip_address', 'ipAddress', 'sta_ip', 'ipv4', 'address'];
  for (const key of priorityKeys) {
    if (!(key in objectNode)) {
      continue;
    }
    const found = findIpAddress(objectNode[key], depth + 1);
    if (found) {
      return found;
    }
  }

  for (const [key, value] of Object.entries(objectNode)) {
    if (key.toLowerCase().includes('ip')) {
      const found = findIpAddress(value, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  for (const value of Object.values(objectNode)) {
    const found = findIpAddress(value, depth + 1);
    if (found) {
      return found;
    }
  }
  return null;
}

function extractIpAddressFromDeviceStatus(device: DeviceStatus, events: CanonicalEvent[]): string | null {
  if (device.wifiPayloadJson) {
    const wifiPayload = tryParsePayload(device.wifiPayloadJson);
    const fromStatusPayload = findIpAddress(wifiPayload);
    if (fromStatusPayload) {
      return fromStatusPayload;
    }
  }

  for (const event of events) {
    if (event.deviceId !== device.deviceId) {
      continue;
    }
    const fromEventPayload = findIpAddress(tryParsePayload(event.payloadJson));
    if (fromEventPayload) {
      return fromEventPayload;
    }
  }
  return null;
}

function extractIpAddressesFromEvents(events: CanonicalEvent[]): Record<string, string> {
  const latestByDevice: Record<string, { value: string; ingestEpoch: number }> = {};

  for (const event of events) {
    const ipAddress = findIpAddress(tryParsePayload(event.payloadJson));
    if (!ipAddress) {
      continue;
    }
    const ingestEpoch = timestampToEpochMillis(event.ingestTs) ?? Number.MIN_SAFE_INTEGER;
    const current = latestByDevice[event.deviceId];
    if (!current || ingestEpoch >= current.ingestEpoch) {
      latestByDevice[event.deviceId] = { value: ipAddress, ingestEpoch };
    }
  }

  const output: Record<string, string> = {};
  for (const [deviceId, entry] of Object.entries(latestByDevice)) {
    output[deviceId] = entry.value;
  }
  return output;
}

function sameDeviceStatus(a: DeviceStatus, b: DeviceStatus): boolean {
  return (
    a.deviceId === b.deviceId &&
    a.online === b.online &&
    a.lastSeen === b.lastSeen &&
    a.rssi === b.rssi &&
    a.wifiPayloadJson === b.wifiPayloadJson &&
    a.updatedAt === b.updatedAt
  );
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function sameTaskCapabilities(a: TaskCapabilities, b: TaskCapabilities): boolean {
  return (
    a.canViewRoomEvents === b.canViewRoomEvents &&
    a.canSendDeviceCommands === b.canSendDeviceCommands &&
    a.canFilterByTopic === b.canFilterByTopic &&
    a.showInternalEventsToggle === b.showInternalEventsToggle &&
    sameStringArray(a.allowedConfigOptions, b.allowedConfigOptions) &&
    sameStringArray(a.studentCommandWhitelist, b.studentCommandWhitelist)
  );
}

function sameTaskInfo(a: TaskInfo, b: TaskInfo): boolean {
  return (
    a.id === b.id &&
    a.titleDe === b.titleDe &&
    a.titleEn === b.titleEn &&
    a.descriptionDe === b.descriptionDe &&
    a.descriptionEn === b.descriptionEn &&
    a.active === b.active
  );
}

function sameGroupConfigMeta(a: GroupConfig, b: GroupConfig): boolean {
  return (
    a.groupKey === b.groupKey &&
    a.revision === b.revision &&
    a.updatedAt === b.updatedAt &&
    a.updatedBy === b.updatedBy
  );
}

function samePresenceUser(a: PresenceUser, b: PresenceUser): boolean {
  return (
    a.username === b.username &&
    a.displayName === b.displayName &&
    a.lastSeen === b.lastSeen
  );
}

function samePresenceList(a: PresenceUser[], b: PresenceUser[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!samePresenceUser(a[index], b[index])) {
      return false;
    }
  }
  return true;
}

function sameGroupOverview(a: GroupOverview, b: GroupOverview): boolean {
  return (
    a.groupKey === b.groupKey &&
    a.onlineCount === b.onlineCount &&
    a.hasProgress === b.hasProgress &&
    samePresenceList(a.presence, b.presence) &&
    sameGroupConfigMeta(a.config, b.config)
  );
}

function sameGroupOverviewList(a: GroupOverview[], b: GroupOverview[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (!sameGroupOverview(a[index], b[index])) {
      return false;
    }
  }
  return true;
}

function sameAppSettings(a: AppSettings, b: AppSettings): boolean {
  return (
    a.defaultLanguageMode === b.defaultLanguageMode &&
    a.timeFormat24h === b.timeFormat24h &&
    a.studentVirtualDeviceVisible === b.studentVirtualDeviceVisible &&
    a.adminDeviceId === b.adminDeviceId &&
    a.updatedAt === b.updatedAt &&
    a.updatedBy === b.updatedBy
  );
}

function sameEventRateSeries(
  a: SystemStatusEventRatePoint[],
  b: SystemStatusEventRatePoint[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].minuteTs !== b[index].minuteTs || a[index].eventCount !== b[index].eventCount) {
      return false;
    }
  }
  return true;
}

function sameAdminSystemStatus(
  a: AdminSystemStatus | null,
  b: AdminSystemStatus
): boolean {
  if (!a) {
    return false;
  }
  return (
    a.generatedAt === b.generatedAt &&
    sameEventRateSeries(a.eventsLast10Minutes, b.eventsLast10Minutes) &&
    a.cpuLoadPct === b.cpuLoadPct &&
    a.ramUsedBytes === b.ramUsedBytes &&
    a.ramTotalBytes === b.ramTotalBytes &&
    a.postgresSizeBytes === b.postgresSizeBytes &&
    a.storedEventCount === b.storedEventCount &&
    a.websocketSessions.admin === b.websocketSessions.admin &&
    a.websocketSessions.student === b.websocketSessions.student &&
    a.websocketSessions.total === b.websocketSessions.total
  );
}

function sameVirtualDeviceState(a: VirtualDeviceState, b: VirtualDeviceState): boolean {
  return (
    a.deviceId === b.deviceId &&
    a.groupKey === b.groupKey &&
    a.online === b.online &&
    a.rssi === b.rssi &&
    a.ipAddress === b.ipAddress &&
    a.temperatureC === b.temperatureC &&
    a.humidityPct === b.humidityPct &&
    a.brightness === b.brightness &&
    a.counterValue === b.counterValue &&
    a.buttonRedPressed === b.buttonRedPressed &&
    a.buttonBlackPressed === b.buttonBlackPressed &&
    a.ledGreenOn === b.ledGreenOn &&
    a.ledOrangeOn === b.ledOrangeOn &&
    a.updatedAt === b.updatedAt
  );
}

function sameVirtualDevicePatch(a: VirtualDevicePatch | null, b: VirtualDevicePatch | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.buttonRedPressed === b.buttonRedPressed &&
    a.buttonBlackPressed === b.buttonBlackPressed &&
    a.ledGreenOn === b.ledGreenOn &&
    a.ledOrangeOn === b.ledOrangeOn &&
    a.temperatureC === b.temperatureC &&
    a.humidityPct === b.humidityPct &&
    a.brightness === b.brightness &&
    a.counterValue === b.counterValue
  );
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function getStoredLanguageOverride(): Language | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (value === 'de' || value === 'en') {
    return value;
  }
  return null;
}

function setStoredLanguageOverride(value: Language | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (value === null) {
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  } else {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

function formatTimestamp(value: TimestampValue, language: Language, use24HourTime: boolean): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const epochMillis = timestampToEpochMillis(value);
  if (epochMillis === null) {
    return typeof value === 'string' ? value : String(value);
  }

  const parsed = new Date(epochMillis);
  const locale = language === 'de' ? 'de-CH' : 'en-US';
  return parsed.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: !use24HourTime
  });
}

function formatMinuteTimestamp(value: TimestampValue, language: Language, use24HourTime: boolean): string {
  const epochMillis = timestampToEpochMillis(value);
  if (epochMillis === null) {
    return '-';
  }
  const locale = language === 'de' ? 'de-CH' : 'en-US';
  return new Date(epochMillis).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24HourTime
  });
}

function formatBytes(value: number | null, language: Language): string {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = size >= 100 || unitIndex === 0 ? 0 : 1;
  const locale = language === 'de' ? 'de-CH' : 'en-US';
  return `${size.toLocaleString(locale, { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits })} ${units[unitIndex]}`;
}

function safeConfigMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function extractTaskInfo(payload: unknown): TaskInfo | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Partial<TaskInfo>;
  if (
    typeof data.id !== 'string' ||
    typeof data.titleDe !== 'string' ||
    typeof data.titleEn !== 'string' ||
    typeof data.descriptionDe !== 'string' ||
    typeof data.descriptionEn !== 'string'
  ) {
    return null;
  }

  return {
    id: data.id,
    titleDe: data.titleDe,
    titleEn: data.titleEn,
    descriptionDe: data.descriptionDe,
    descriptionEn: data.descriptionEn,
    active: typeof data.active === 'boolean' ? data.active : true
  };
}

function statusLabel(online: boolean, language: Language): string {
  if (online) {
    return language === 'de' ? 'Online' : 'Online';
  }
  return language === 'de' ? 'Offline' : 'Offline';
}

function sanitizeConfigForCapabilities(
  config: Record<string, unknown>,
  capabilities: TaskCapabilities
): Record<string, unknown> {
  if (capabilities.allowedConfigOptions.includes('*')) {
    return { ...config };
  }

  const allowed = new Set(capabilities.allowedConfigOptions);
  const next: Record<string, unknown> = {};
  Object.entries(config).forEach(([key, value]) => {
    if (allowed.has(key)) {
      next[key] = value;
    }
  });
  return next;
}

function feedMatchesTopic(event: CanonicalEvent, topicFilter: string): boolean {
  const filter = topicFilter.trim().toLowerCase();
  if (!filter) {
    return true;
  }

  return (
    event.topic.toLowerCase().includes(filter) ||
    event.eventType.toLowerCase().includes(filter) ||
    event.deviceId.toLowerCase().includes(filter)
  );
}

function tryParsePayload(payloadJson: string): unknown | null {
  const initial = payloadJson.trim();
  if (!initial) {
    return null;
  }

  const looksLikeJsonLiteral = (value: string): boolean => {
    if (value.startsWith('{') || value.startsWith('[') || value.startsWith('"')) {
      return true;
    }
    if (value === 'true' || value === 'false' || value === 'null') {
      return true;
    }
    return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value);
  };

  let current = initial;
  for (let depth = 0; depth < 4; depth += 1) {
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed === 'string') {
        const next = parsed.trim();
        if (!next) {
          return '';
        }
        if (!looksLikeJsonLiteral(next) || next === current) {
          return parsed;
        }
        current = next;
        continue;
      }
      return parsed;
    } catch {
      const unescaped = current
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .trim();
      if (!unescaped || unescaped === current) {
        return null;
      }
      current = unescaped;
    }
  }
  return null;
}

function isTelemetryEvent(event: CanonicalEvent): boolean {
  const topic = event.topic.toLowerCase();
  const eventType = event.eventType.toLowerCase();
  return topic.includes('/telemetry') || eventType.includes('telemetry');
}

function isVirtualDeviceId(deviceId: string): boolean {
  return /^eplvd[0-9]+$/i.test(deviceId.trim());
}

function formatScalar(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function extractEventValueFromPayload(node: unknown, depth = 0): string | null {
  if (depth > 4 || node === null || node === undefined) {
    return null;
  }

  const scalar = formatScalar(node);
  if (scalar !== null) {
    return scalar;
  }

  if (Array.isArray(node)) {
    for (const value of node) {
      const extracted = extractEventValueFromPayload(value, depth + 1);
      if (extracted !== null) {
        return extracted;
      }
    }
    return null;
  }

  if (typeof node !== 'object') {
    return null;
  }

  const objectNode = node as Record<string, unknown>;
  const priorityKeys = ['value', 'state', 'output', 'on', 'action', 'event', 'button', 'online'];

  for (const key of priorityKeys) {
    if (!(key in objectNode)) {
      continue;
    }
    const value = extractEventValueFromPayload(objectNode[key], depth + 1);
    if (value !== null) {
      return value;
    }
  }

  for (const value of Object.values(objectNode)) {
    const extracted = extractEventValueFromPayload(value, depth + 1);
    if (extracted !== null) {
      return extracted;
    }
  }

  return null;
}

function formatBrightnessMeasurement(value: number): string {
  return value > 5 ? `${Math.round(value)} lx` : `${value.toFixed(2)} V`;
}

function eventValueSummary(event: CanonicalEvent): string {
  if (isTelemetryEvent(event)) {
    return '';
  }

  const lowerEventType = event.eventType.toLowerCase();
  const lowerTopic = event.topic.toLowerCase();
  if (lowerEventType === 'status.system' || lowerEventType.startsWith('status.system.')) {
    return '';
  }
  if (lowerEventType.endsWith('.press')) {
    return 'pressed';
  }
  if (lowerEventType.endsWith('.release')) {
    return 'released';
  }

  const parsedPayload = tryParsePayload(event.payloadJson);
  if (parsedPayload === null) {
    return '';
  }

  if (lowerEventType === 'status.mqtt' || lowerEventType.startsWith('status.mqtt.')) {
    const mqttConnected = firstBoolean(parsedPayload, [
      ['params', 'mqtt', 'connected'],
      ['mqtt', 'connected'],
      ['connected']
    ]);
    if (mqttConnected !== null) {
      return String(mqttConnected);
    }
  }

  const temperature =
    firstNumber(parsedPayload, [
      ['temperature'],
      ['temp'],
      ['tC'],
      ['params', 'temperature:100', 'tC'],
      ['params', 'temperature:100', 'value']
    ]) ?? findNumberByKeys(parsedPayload, ['temperature', 'temp', 'tC']);

  const humidity =
    firstNumber(parsedPayload, [
      ['humidity'],
      ['hum'],
      ['rh'],
      ['params', 'humidity:100', 'rh'],
      ['params', 'humidity:100', 'value']
    ]) ?? findNumberByKeys(parsedPayload, ['humidity', 'hum', 'rh']);

  const brightness =
    firstNumber(parsedPayload, [
      ['brightness'],
      ['lux'],
      ['ldr'],
      ['voltage'],
      ['params', 'voltmeter:100', 'voltage'],
      ['params', 'voltmeter:100', 'value']
    ]) ?? findNumberByKeys(parsedPayload, ['brightness', 'lux', 'ldr', 'voltage']);

  const counter = extractCounterValueFromPayload(parsedPayload, true);

  if (lowerEventType.includes('temperature') && temperature !== null) {
    return `${temperature.toFixed(1)} °C`;
  }
  if (lowerEventType.includes('humidity') && humidity !== null) {
    return `${Math.round(humidity)} %`;
  }
  if ((lowerEventType.includes('ldr') || lowerTopic.includes('/sensor/ldr')) && brightness !== null) {
    return formatBrightnessMeasurement(brightness);
  }
  if (event.category === 'COUNTER' && counter !== null) {
    return Number.isInteger(counter) ? String(counter) : counter.toFixed(2);
  }

  if (event.category === 'SENSOR') {
    const sensorParts: string[] = [];
    if (temperature !== null) {
      sensorParts.push(`${temperature.toFixed(1)} °C`);
    }
    if (humidity !== null) {
      sensorParts.push(`${Math.round(humidity)} %`);
    }
    if (brightness !== null && sensorParts.length === 0) {
      sensorParts.push(formatBrightnessMeasurement(brightness));
    }
    if (sensorParts.length > 0) {
      return sensorParts.join(' / ');
    }
  }

  if (
    lowerEventType.includes('led.green.state_changed') ||
    lowerEventType.includes('led.orange.state_changed')
  ) {
    const ledState = firstBoolean(parsedPayload, [
      ['output'],
      ['state'],
      ['on'],
      ['value'],
      ['params', 'switch:0', 'output'],
      ['switch:0', 'output'],
      ['params', 'switch:1', 'output'],
      ['switch:1', 'output']
    ]);
    if (ledState !== null) {
      return ledState ? 'on' : 'off';
    }
  }

  const state = firstBoolean(parsedPayload, [['state'], ['output'], ['on'], ['online'], ['value']]);
  if (state !== null) {
    if (lowerEventType.includes('button')) {
      return state ? 'pressed' : 'released';
    }
    if (lowerEventType.includes('online') || lowerTopic.includes('/status/heartbeat')) {
      return state ? 'online' : 'offline';
    }
    return state ? 'on' : 'off';
  }

  const rssi =
    firstNumber(parsedPayload, [['rssi'], ['wifi', 'rssi'], ['params', 'wifi', 'rssi']]) ??
    findNumberByKeys(parsedPayload, ['rssi']);
  if (rssi !== null) {
    return `${Math.round(rssi)} dBm`;
  }

  return extractEventValueFromPayload(parsedPayload) ?? '';
}

function emptyDeviceTelemetrySnapshot(): DeviceTelemetrySnapshot {
  return {
    temperatureC: null,
    humidityPct: null,
    brightness: null,
    counterValue: null,
    buttonRedPressed: null,
    buttonBlackPressed: null,
    ledGreenOn: null,
    ledOrangeOn: null,
    uptimeMs: null,
    uptimeIngestTs: null
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'on', 'pressed', 'press', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'off', 'released', 'release', '0'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function readPath(root: unknown, path: string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    const next = (current as Record<string, unknown>)[segment];
    if (next === undefined) {
      return null;
    }
    current = next;
  }
  return current;
}

function firstNumber(root: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = toNumber(readPath(root, path));
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function firstBoolean(root: unknown, paths: string[][]): boolean | null {
  for (const path of paths) {
    const value = toBoolean(readPath(root, path));
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function findNumberByKeys(node: unknown, keys: string[], depth = 0): number | null {
  if (depth > 5 || node === null || node === undefined) {
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const value = findNumberByKeys(item, keys, depth + 1);
      if (value !== null) {
        return value;
      }
    }
    return null;
  }
  if (typeof node !== 'object') {
    return null;
  }
  const keySet = new Set(keys);
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (keySet.has(key)) {
      const parsed = toNumber(value);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const parsed = findNumberByKeys(value, keys, depth + 1);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function extractButtonState(event: CanonicalEvent, payload: unknown, channel: 'red' | 'black'): boolean | null {
  const prefix = `button.${channel}.`;
  if (event.eventType.startsWith(prefix)) {
    if (event.eventType.endsWith('.press')) {
      return true;
    }
    if (event.eventType.endsWith('.release')) {
      return false;
    }
  }
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (channel === 'red') {
    return firstBoolean(payload, [['params', 'input:0', 'state'], ['input:0', 'state']]);
  }
  return firstBoolean(payload, [['params', 'input:1', 'state'], ['input:1', 'state']]);
}

function extractLedState(event: CanonicalEvent, payload: unknown, channel: 'green' | 'orange'): boolean | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const isTargetEvent =
    (channel === 'green' &&
      (event.eventType.includes('green') || event.topic.includes('switch:0'))) ||
    (channel === 'orange' &&
      (event.eventType.includes('orange') || event.topic.includes('switch:1')));

  if (!isTargetEvent) {
    return null;
  }

  if (channel === 'green') {
    return firstBoolean(payload, [
      ['params', 'switch:0', 'output'],
      ['switch:0', 'output'],
      ['output'],
      ['on'],
      ['state']
    ]);
  }
  return firstBoolean(payload, [
    ['params', 'switch:1', 'output'],
    ['switch:1', 'output'],
    ['output'],
    ['on'],
    ['state']
  ]);
}

function extractUptimeMs(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const directMs = firstNumber(payload, [['ts_uptime_ms'], ['uptime_ms']]);
  if (directMs !== null && directMs >= 0) {
    return directMs;
  }

  const deepMs = findNumberByKeys(payload, ['ts_uptime_ms', 'uptime_ms']);
  if (deepMs !== null && deepMs >= 0) {
    return deepMs;
  }

  const seconds = firstNumber(payload, [['sys', 'uptime'], ['uptime']]);
  if (seconds !== null && seconds >= 0) {
    return seconds * 1000;
  }

  return null;
}

function buildDeviceTelemetrySnapshots(events: CanonicalEvent[]): Record<string, DeviceTelemetrySnapshot> {
  const byDevice: Record<string, DeviceTelemetrySnapshot> = {};

  for (const event of events) {
    if (!byDevice[event.deviceId]) {
      byDevice[event.deviceId] = emptyDeviceTelemetrySnapshot();
    }
    const snapshot = byDevice[event.deviceId];
    const payload = tryParsePayload(event.payloadJson);

    if (snapshot.temperatureC === null) {
      const temperature = firstNumber(payload, [
        ['temperature'],
        ['temp'],
        ['tC'],
        ['params', 'temperature:100', 'tC'],
        ['params', 'temperature:100', 'value']
      ]) ?? findNumberByKeys(payload, ['temperature', 'temp', 'tC']);
      if (temperature !== null) {
        snapshot.temperatureC = temperature;
      }
    }

    if (snapshot.humidityPct === null) {
      const humidity = firstNumber(payload, [
        ['humidity'],
        ['hum'],
        ['rh'],
        ['params', 'humidity:100', 'rh'],
        ['params', 'humidity:100', 'value']
      ]) ?? findNumberByKeys(payload, ['humidity', 'hum', 'rh']);
      if (humidity !== null) {
        snapshot.humidityPct = humidity;
      }
    }

    if (snapshot.brightness === null) {
      const brightness = firstNumber(payload, [
        ['brightness'],
        ['lux'],
        ['ldr'],
        ['voltage'],
        ['params', 'voltmeter:100', 'voltage'],
        ['params', 'voltmeter:100', 'value']
      ]) ?? findNumberByKeys(payload, ['brightness', 'lux', 'ldr', 'voltage']);
      if (brightness !== null) {
        snapshot.brightness = brightness;
      }
    }

    if (snapshot.counterValue === null && isCounterEvent(event)) {
      const counterValue = extractCounterValueFromPayload(payload, true);
      if (counterValue !== null) {
        snapshot.counterValue = counterValue;
      }
    }

    if (snapshot.buttonRedPressed === null) {
      const red = extractButtonState(event, payload, 'red');
      if (red !== null) {
        snapshot.buttonRedPressed = red;
      }
    }

    if (snapshot.buttonBlackPressed === null) {
      const black = extractButtonState(event, payload, 'black');
      if (black !== null) {
        snapshot.buttonBlackPressed = black;
      }
    }

    if (snapshot.ledGreenOn === null) {
      const green = extractLedState(event, payload, 'green');
      if (green !== null) {
        snapshot.ledGreenOn = green;
      }
    }

    if (snapshot.ledOrangeOn === null) {
      const orange = extractLedState(event, payload, 'orange');
      if (orange !== null) {
        snapshot.ledOrangeOn = orange;
      }
    }

    if (snapshot.uptimeMs === null) {
      const uptimeMs = extractUptimeMs(payload);
      if (uptimeMs !== null) {
        snapshot.uptimeMs = uptimeMs;
        snapshot.uptimeIngestTs = event.ingestTs;
      }
    }
  }

  return byDevice;
}

function sameTelemetrySnapshot(a: DeviceTelemetrySnapshot, b: DeviceTelemetrySnapshot): boolean {
  return (
    a.temperatureC === b.temperatureC &&
    a.humidityPct === b.humidityPct &&
    a.brightness === b.brightness &&
    a.counterValue === b.counterValue &&
    a.buttonRedPressed === b.buttonRedPressed &&
    a.buttonBlackPressed === b.buttonBlackPressed &&
    a.ledGreenOn === b.ledGreenOn &&
    a.ledOrangeOn === b.ledOrangeOn &&
    a.uptimeMs === b.uptimeMs &&
    a.uptimeIngestTs === b.uptimeIngestTs
  );
}

function mergeTelemetrySnapshotCache(
  previous: Record<string, DeviceTelemetrySnapshot>,
  latest: Record<string, DeviceTelemetrySnapshot>
): Record<string, DeviceTelemetrySnapshot> {
  const allDeviceIds = new Set([...Object.keys(previous), ...Object.keys(latest)]);
  const next: Record<string, DeviceTelemetrySnapshot> = {};
  let changed = false;

  for (const deviceId of allDeviceIds) {
    const previousSnapshot = previous[deviceId];
    const latestSnapshot = latest[deviceId];

    if (!previousSnapshot && latestSnapshot) {
      next[deviceId] = latestSnapshot;
      changed = true;
      continue;
    }
    if (previousSnapshot && !latestSnapshot) {
      next[deviceId] = previousSnapshot;
      continue;
    }
    if (!previousSnapshot || !latestSnapshot) {
      continue;
    }

    const merged: DeviceTelemetrySnapshot = {
      temperatureC: latestSnapshot.temperatureC ?? previousSnapshot.temperatureC,
      humidityPct: latestSnapshot.humidityPct ?? previousSnapshot.humidityPct,
      brightness: latestSnapshot.brightness ?? previousSnapshot.brightness,
      counterValue: latestSnapshot.counterValue ?? previousSnapshot.counterValue,
      buttonRedPressed: latestSnapshot.buttonRedPressed ?? previousSnapshot.buttonRedPressed,
      buttonBlackPressed: latestSnapshot.buttonBlackPressed ?? previousSnapshot.buttonBlackPressed,
      ledGreenOn: latestSnapshot.ledGreenOn ?? previousSnapshot.ledGreenOn,
      ledOrangeOn: latestSnapshot.ledOrangeOn ?? previousSnapshot.ledOrangeOn,
      uptimeMs: latestSnapshot.uptimeMs ?? previousSnapshot.uptimeMs,
      uptimeIngestTs:
        latestSnapshot.uptimeMs !== null
          ? latestSnapshot.uptimeIngestTs
          : previousSnapshot.uptimeIngestTs
    };

    next[deviceId] = merged;
    if (!sameTelemetrySnapshot(previousSnapshot, merged)) {
      changed = true;
    }
  }

  if (!changed && Object.keys(previous).length === Object.keys(next).length) {
    return previous;
  }
  return next;
}

function mergeIpAddressCache(
  previous: Record<string, string>,
  latest: Record<string, string>,
  activeDeviceIds: string[]
): Record<string, string> {
  const activeIds = new Set(activeDeviceIds);
  const next: Record<string, string> = {};
  let changed = false;

  for (const deviceId of activeIds) {
    const value = latest[deviceId] ?? previous[deviceId];
    if (!value) {
      continue;
    }
    next[deviceId] = value;
    if (previous[deviceId] !== value) {
      changed = true;
    }
  }

  for (const existingDeviceId of Object.keys(previous)) {
    if (!activeIds.has(existingDeviceId)) {
      changed = true;
      break;
    }
  }

  if (!changed && Object.keys(previous).length === Object.keys(next).length) {
    return previous;
  }
  return next;
}

function formatRoundedDuration(durationMs: number, language: Language): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return '-';
  }

  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  if (totalMinutes < 1) {
    return language === 'de' ? '<1 Min' : '<1 min';
  }
  if (totalMinutes < 60) {
    return language === 'de' ? `${totalMinutes} Min` : `${totalMinutes} min`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return language === 'de'
      ? `${totalHours} Std ${remainingMinutes} Min`
      : `${totalHours}h ${remainingMinutes}m`;
  }
  const days = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return language === 'de' ? `${days} T ${remainingHours} Std` : `${days}d ${remainingHours}h`;
}

function estimateUptimeNow(snapshot: DeviceTelemetrySnapshot | undefined, nowEpochMs: number): number | null {
  if (!snapshot || snapshot.uptimeMs === null) {
    return null;
  }
  const ingestEpochMs = timestampToEpochMillis(snapshot.uptimeIngestTs);
  if (ingestEpochMs === null) {
    return snapshot.uptimeMs;
  }
  return snapshot.uptimeMs + Math.max(0, nowEpochMs - ingestEpochMs);
}

function formatRelativeFromNow(value: TimestampValue, nowEpochMs: number, language: Language): string {
  const epochMillis = timestampToEpochMillis(value);
  if (epochMillis === null) {
    return '-';
  }
  const elapsed = Math.max(0, nowEpochMs - epochMillis);
  const duration = formatRoundedDuration(elapsed, language);
  if (duration === '-') {
    return '-';
  }
  return language === 'de' ? `vor ${duration}` : `${duration} ago`;
}

function rssiBars(rssi: number | null): number {
  if (rssi === null) {
    return 0;
  }
  if (rssi >= -55) {
    return 4;
  }
  if (rssi >= -67) {
    return 3;
  }
  if (rssi >= -75) {
    return 2;
  }
  if (rssi >= -85) {
    return 1;
  }
  return 0;
}

function rssiClassName(rssi: number | null): string {
  if (rssi === null) {
    return 'none';
  }
  if (rssi >= -67) {
    return 'good';
  }
  if (rssi >= -75) {
    return 'fair';
  }
  if (rssi >= -85) {
    return 'weak';
  }
  return 'bad';
}

function patchFromVirtualDevice(state: VirtualDeviceState): VirtualDevicePatch {
  return {
    buttonRedPressed: state.buttonRedPressed,
    buttonBlackPressed: state.buttonBlackPressed,
    ledGreenOn: state.ledGreenOn,
    ledOrangeOn: state.ledOrangeOn,
    temperatureC: state.temperatureC,
    humidityPct: state.humidityPct,
    brightness: state.brightness,
    counterValue: state.counterValue
  };
}


export {
  TOKEN_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  MAX_FEED_EVENTS,
  SYSTEM_DATA_PART_ORDER,
  isAdminFeedHotPage,
  CATEGORY_OPTIONS,
  createSystemDataPartSelection,
  selectedSystemDataParts,
  systemDataPartLabel,
  MetricIcon,
  SettingsIcon,
  AdminIcon,
  timestampToEpochMillis,
  compareByNewestIngestTs,
  mergeEventsBounded,
  clampFeed,
  applyFeedScenarioDisturbances,
  nextFeedScenarioReleaseAt,
  isLikelyEpochTimestamp,
  isCounterEvent,
  extractCounterValueFromPayload,
  looksLikeIpAddress,
  ipAddressToHref,
  findIpAddress,
  extractIpAddressFromDeviceStatus,
  extractIpAddressesFromEvents,
  sameDeviceStatus,
  sameStringArray,
  sameTaskCapabilities,
  sameTaskInfo,
  sameGroupConfigMeta,
  samePresenceUser,
  samePresenceList,
  sameGroupOverview,
  sameGroupOverviewList,
  sameAppSettings,
  sameEventRateSeries,
  sameAdminSystemStatus,
  sameVirtualDeviceState,
  sameVirtualDevicePatch,
  getStoredToken,
  getStoredLanguageOverride,
  setStoredLanguageOverride,
  toErrorMessage,
  formatTimestamp,
  formatMinuteTimestamp,
  formatBytes,
  safeConfigMap,
  extractTaskInfo,
  statusLabel,
  sanitizeConfigForCapabilities,
  feedMatchesTopic,
  tryParsePayload,
  isTelemetryEvent,
  isVirtualDeviceId,
  formatScalar,
  extractEventValueFromPayload,
  formatBrightnessMeasurement,
  eventValueSummary,
  emptyDeviceTelemetrySnapshot,
  toNumber,
  toBoolean,
  readPath,
  firstNumber,
  firstBoolean,
  findNumberByKeys,
  extractButtonState,
  extractLedState,
  extractUptimeMs,
  buildDeviceTelemetrySnapshots,
  sameTelemetrySnapshot,
  mergeTelemetrySnapshotCache,
  mergeIpAddressCache,
  formatRoundedDuration,
  estimateUptimeNow,
  formatRelativeFromNow,
  rssiBars,
  rssiClassName,
  patchFromVirtualDevice
};

export type {
  StudentViewData,
  AdminViewData,
  WsConnectionState,
  FeedViewMode,
  EventDetailsViewMode,
  AdminPage,
  CounterResetTarget,
  VirtualDevicePatch,
  DeviceTelemetrySnapshot,
  MetricIconKind,
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft,
  FeedScenarioDisturbanceResult
};
