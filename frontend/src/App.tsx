import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './api';
import {
  type AppSettings,
  type AuthMe,
  type CanonicalEvent,
  type DeviceCommandType,
  type DeviceStatus,
  type EventCategory,
  type GroupConfig,
  type GroupOverview,
  type LanguageMode,
  type PresenceUser,
  type TimestampValue,
  type TaskCapabilities,
  type TaskDefinitionPayload,
  type TaskInfo,
  type WsEnvelope
} from './types';
import { type I18nKey, type Language, resolveLanguageFromMode, taskDescription, taskTitle, tr } from './i18n';

const TOKEN_STORAGE_KEY = 'epl.sessionToken';
const LANGUAGE_STORAGE_KEY = 'epl.languageOverride';
const MAX_FEED_EVENTS = 200;

interface StudentViewData {
  activeTask: TaskInfo;
  capabilities: TaskCapabilities;
  groupConfig: GroupConfig;
  groupPresence: PresenceUser[];
  feed: CanonicalEvent[];
  settings: AppSettings;
}

interface AdminViewData {
  tasks: TaskInfo[];
  devices: DeviceStatus[];
  groups: GroupOverview[];
  events: CanonicalEvent[];
  settings: AppSettings;
}

type WsConnectionState = 'connecting' | 'connected' | 'disconnected';
type FeedViewMode = 'rendered' | 'raw';
type EventDetailsViewMode = 'rendered' | 'raw';
type AdminPage = 'dashboard' | 'devices' | 'feed' | 'groupsTasks' | 'settings';

function isAdminFeedHotPage(page: AdminPage): boolean {
  return page === 'feed' || page === 'dashboard';
}

interface DeviceTelemetrySnapshot {
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

type MetricIconKind =
  | 'temperature'
  | 'humidity'
  | 'brightness'
  | 'counter'
  | 'buttons'
  | 'leds';

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

function MetricIcon({ kind }: { kind: MetricIconKind }) {
  if (kind === 'temperature') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M10 4a2 2 0 1 1 4 0v8.4a4.6 4.6 0 1 1-4 0V4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="12" y1="10" x2="12" y2="16.2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === 'humidity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 3.6C9.6 6.6 6.5 9.9 6.5 13.5a5.5 5.5 0 0 0 11 0c0-3.6-3.1-6.9-5.5-9.9Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'brightness') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <line x1="12" y1="3.5" x2="12" y2="6" stroke="currentColor" strokeWidth="1.8" />
        <line x1="12" y1="18" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.8" />
        <line x1="3.5" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="1.8" />
        <line x1="18" y1="12" x2="20.5" y2="12" stroke="currentColor" strokeWidth="1.8" />
        <line x1="6.3" y1="6.3" x2="8" y2="8" stroke="currentColor" strokeWidth="1.8" />
        <line x1="16" y1="16" x2="17.7" y2="17.7" stroke="currentColor" strokeWidth="1.8" />
        <line x1="6.3" y1="17.7" x2="8" y2="16" stroke="currentColor" strokeWidth="1.8" />
        <line x1="16" y1="8" x2="17.7" y2="6.3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === 'buttons') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="8" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === 'counter') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4.2" y="6.5" width="15.6" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <line x1="8.4" y1="10" x2="15.6" y2="10" stroke="currentColor" strokeWidth="1.8" />
        <line x1="8.4" y1="14" x2="15.6" y2="14" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4.4" y="8.2" width="6.3" height="7.6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.3" y="8.2" width="6.3" height="7.6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M10.3 3.5h3.4l.5 2.1 1.9.8 1.9-1.1 2.4 2.4-1.1 1.9.8 1.9 2.1.5v3.4l-2.1.5-.8 1.9 1.1 1.9-2.4 2.4-1.9-1.1-1.9.8-.5 2.1h-3.4l-.5-2.1-1.9-.8-1.9 1.1-2.4-2.4 1.1-1.9-.8-1.9-2.1-.5v-3.4l2.1-.5.8-1.9-1.1-1.9 2.4-2.4 1.9 1.1 1.9-.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
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

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [session, setSession] = useState<AuthMe | null>(null);
  const [booting, setBooting] = useState(true);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPin, setLoginPin] = useState('');

  const [studentData, setStudentData] = useState<StudentViewData | null>(null);
  const [studentConfigDraft, setStudentConfigDraft] = useState<Record<string, unknown>>({});
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [studentTopicFilter, setStudentTopicFilter] = useState('');
  const [studentShowInternal, setStudentShowInternal] = useState(false);
  const [studentFeedPaused, setStudentFeedPaused] = useState(false);

  const [adminData, setAdminData] = useState<AdminViewData | null>(null);
  const [adminTopicFilter, setAdminTopicFilter] = useState('');
  const [adminCategoryFilter, setAdminCategoryFilter] = useState<EventCategory | 'ALL'>('ALL');
  const [adminDeviceFilter, setAdminDeviceFilter] = useState('');
  const [adminIncludeInternal, setAdminIncludeInternal] = useState(false);
  const [adminFeedPaused, setAdminFeedPaused] = useState(false);
  const [adminSettingsDraftMode, setAdminSettingsDraftMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [adminSettingsDraftTimeFormat24h, setAdminSettingsDraftTimeFormat24h] = useState(true);
  const [adminDeviceSnapshots, setAdminDeviceSnapshots] = useState<Record<string, DeviceTelemetrySnapshot>>({});
  const [adminDeviceIpById, setAdminDeviceIpById] = useState<Record<string, string>>({});

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [wsConnection, setWsConnection] = useState<WsConnectionState>('disconnected');

  const [defaultLanguageMode, setDefaultLanguageMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [timeFormat24h, setTimeFormat24h] = useState(true);
  const [languageOverride, setLanguageOverride] = useState<Language | null>(() => getStoredLanguageOverride());
  const [feedViewMode, setFeedViewMode] = useState<FeedViewMode>('rendered');
  const [selectedEvent, setSelectedEvent] = useState<CanonicalEvent | null>(null);
  const [eventDetailsViewMode, setEventDetailsViewMode] = useState<EventDetailsViewMode>('rendered');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());
  const [counterResetDeviceId, setCounterResetDeviceId] = useState<string | null>(null);
  const [pinEditorDeviceId, setPinEditorDeviceId] = useState<string | null>(null);
  const [pinEditorValue, setPinEditorValue] = useState('');
  const [pinEditorLoading, setPinEditorLoading] = useState(false);
  const [adminPage, setAdminPage] = useState<AdminPage>('dashboard');
  const [recentFeedEventIds, setRecentFeedEventIds] = useState<Record<string, true>>({});

  const studentPauseRef = useRef(studentFeedPaused);
  const adminPauseRef = useRef(adminFeedPaused);
  const adminDataRef = useRef<AdminViewData | null>(null);
  const adminPageRef = useRef(adminPage);
  const deferredAdminFeedRef = useRef<CanonicalEvent[]>([]);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const recentFeedClearTimerRef = useRef<number | null>(null);

  const reportBackgroundError = useCallback((context: string, error: unknown) => {
    const message = toErrorMessage(error);
    console.warn(`[EPL UI background] ${context}: ${message}`);
  }, []);

  const clearRecentFeedHighlights = useCallback(() => {
    if (recentFeedClearTimerRef.current !== null) {
      window.clearTimeout(recentFeedClearTimerRef.current);
      recentFeedClearTimerRef.current = null;
    }
    setRecentFeedEventIds((previous) => (Object.keys(previous).length === 0 ? previous : {}));
  }, []);

  const markFeedEventsRecent = useCallback((events: CanonicalEvent[]) => {
    if (events.length === 0) {
      return;
    }
    setRecentFeedEventIds((previous) => {
      const next = { ...previous };
      for (const event of events) {
        next[event.id] = true;
      }
      return next;
    });
    if (recentFeedClearTimerRef.current !== null) {
      window.clearTimeout(recentFeedClearTimerRef.current);
    }
    recentFeedClearTimerRef.current = window.setTimeout(() => {
      recentFeedClearTimerRef.current = null;
      setRecentFeedEventIds((previous) => (Object.keys(previous).length === 0 ? previous : {}));
    }, 1000);
  }, []);

  const queueDeferredAdminFeedEvents = useCallback((events: CanonicalEvent[]) => {
    if (events.length === 0) {
      return;
    }
    deferredAdminFeedRef.current = mergeEventsBounded(
      deferredAdminFeedRef.current,
      events,
      MAX_FEED_EVENTS
    );
  }, []);

  const flushDeferredAdminFeedEvents = useCallback(
    (highlight: boolean) => {
      if (!adminDataRef.current) {
        return;
      }
      const deferredEvents = deferredAdminFeedRef.current;
      if (deferredEvents.length === 0) {
        return;
      }

      deferredAdminFeedRef.current = [];
      if (highlight) {
        markFeedEventsRecent(deferredEvents);
      }
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        const nextFeed = mergeEventsBounded(previous.events, deferredEvents, MAX_FEED_EVENTS);
        if (nextFeed === previous.events) {
          return previous;
        }
        return {
          ...previous,
          events: nextFeed
        };
      });
    },
    [markFeedEventsRecent]
  );

  useEffect(() => {
    studentPauseRef.current = studentFeedPaused;
  }, [studentFeedPaused]);

  useEffect(() => {
    adminPageRef.current = adminPage;
  }, [adminPage]);

  useEffect(() => {
    adminDataRef.current = adminData;
  }, [adminData]);

  useEffect(() => {
    if (!isAdminFeedHotPage(adminPage)) {
      return;
    }
    flushDeferredAdminFeedEvents(adminPage === 'feed');
  }, [adminPage, flushDeferredAdminFeedEvents]);

  useEffect(() => {
    if (adminPage !== 'devices') {
      return;
    }
    const deferredEvents = deferredAdminFeedRef.current;
    if (deferredEvents.length === 0) {
      return;
    }

    const latestSnapshots = buildDeviceTelemetrySnapshots(deferredEvents);
    if (Object.keys(latestSnapshots).length > 0) {
      setAdminDeviceSnapshots((previous) => mergeTelemetrySnapshotCache(previous, latestSnapshots));
    }

    const latestIpByDeviceId = extractIpAddressesFromEvents(deferredEvents);
    if (Object.keys(latestIpByDeviceId).length > 0) {
      setAdminDeviceIpById((previous) => {
        const activeDeviceIds =
          adminDataRef.current?.devices.map((device) => device.deviceId) ??
          Array.from(new Set([...Object.keys(previous), ...Object.keys(latestIpByDeviceId)]));
        return mergeIpAddressCache(previous, latestIpByDeviceId, activeDeviceIds);
      });
    }
  }, [adminPage]);

  useEffect(() => {
    return () => {
      clearRecentFeedHighlights();
    };
  }, [clearRecentFeedHighlights]);

  useEffect(() => {
    adminPauseRef.current = adminFeedPaused;
  }, [adminFeedPaused]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setErrorMessage(null);
    }, 6000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [errorMessage]);

  const language = useMemo<Language>(() => {
    if (languageOverride) {
      return languageOverride;
    }
    const browserLanguages =
      typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
    return resolveLanguageFromMode(defaultLanguageMode, browserLanguages);
  }, [defaultLanguageMode, languageOverride]);

  const t = useCallback(
    (key: I18nKey): string => {
      return tr(language, key);
    },
    [language]
  );

  const clearRoleState = useCallback(() => {
    setStudentData(null);
    setStudentConfigDraft({});
    setDisplayNameDraft('');
    setStudentTopicFilter('');
    setStudentShowInternal(false);
    setStudentFeedPaused(false);

    setAdminData(null);
    setAdminTopicFilter('');
    setAdminCategoryFilter('ALL');
    setAdminDeviceFilter('');
    setAdminIncludeInternal(false);
    setAdminFeedPaused(false);
    setAdminSettingsDraftMode('BROWSER_EN_FALLBACK');
    setAdminSettingsDraftTimeFormat24h(true);
    setAdminDeviceSnapshots({});
    setAdminDeviceIpById({});
    setCounterResetDeviceId(null);
    setPinEditorDeviceId(null);
    setPinEditorValue('');
    setPinEditorLoading(false);
    setAdminPage('dashboard');
    adminDataRef.current = null;
    deferredAdminFeedRef.current = [];
    clearRecentFeedHighlights();
  }, [clearRecentFeedHighlights]);

  const clearAuth = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    setToken(null);
    setSession(null);
    setUserMenuOpen(false);
    setWsConnection('disconnected');
    clearRoleState();
  }, [clearRoleState]);

  const refreshAdminGroups = useCallback(async (activeToken: string) => {
    const groups = await api.adminGroups(activeToken);
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      return { ...previous, groups };
    });
  }, []);

  const refreshAdminTasks = useCallback(async (activeToken: string) => {
    const tasks = await api.adminTasks(activeToken);
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      return { ...previous, tasks };
    });
  }, []);

  const loadDashboards = useCallback(async (auth: AuthMe, activeToken: string) => {
    if (auth.role === 'STUDENT') {
      const bootstrap = await api.studentBootstrap(activeToken);
      setStudentData({
        activeTask: bootstrap.activeTask,
        capabilities: bootstrap.capabilities,
        groupConfig: bootstrap.groupConfig,
        groupPresence: bootstrap.groupPresence,
        feed: clampFeed(bootstrap.recentFeed),
        settings: bootstrap.settings
      });
      setStudentConfigDraft(safeConfigMap(bootstrap.groupConfig.config));
      setDisplayNameDraft(bootstrap.me.displayName);
      setDefaultLanguageMode(bootstrap.settings.defaultLanguageMode);
      setTimeFormat24h(bootstrap.settings.timeFormat24h);
      return;
    }

    const [tasks, devices, groups, settings, events] = await Promise.all([
      api.adminTasks(activeToken),
      api.adminDevices(activeToken),
      api.adminGroups(activeToken),
      api.adminSettings(activeToken),
      api.eventsFeed(activeToken, { limit: MAX_FEED_EVENTS, includeInternal: true })
    ]);

    setAdminData({
      tasks,
      devices,
      groups,
      settings,
      events: clampFeed(events)
    });
    deferredAdminFeedRef.current = [];
    setAdminSettingsDraftMode(settings.defaultLanguageMode);
    setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
    setDefaultLanguageMode(settings.defaultLanguageMode);
    setTimeFormat24h(settings.timeFormat24h);
    setAdminPage('dashboard');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapFromToken(): Promise<void> {
      if (!token) {
        setSession(null);
        clearRoleState();
        setBooting(false);
        return;
      }

      setBooting(true);
      setErrorMessage(null);

      try {
        const me = await api.me(token);
        if (cancelled) {
          return;
        }

        setSession(me);
        await loadDashboards(me, token);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(toErrorMessage(error));
        clearAuth();
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    bootstrapFromToken().catch((error) => {
      if (!cancelled) {
        setErrorMessage(toErrorMessage(error));
        clearAuth();
        setBooting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clearAuth, clearRoleState, loadDashboards, token]);

  useEffect(() => {
    if (!studentData || studentData.capabilities.showInternalEventsToggle) {
      return;
    }
    setStudentShowInternal(false);
  }, [studentData]);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedEvent(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedEvent]);

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current) {
        return;
      }
      if (userMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setUserMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!counterResetDeviceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeCounterResetModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [counterResetDeviceId]);

  useEffect(() => {
    if (!pinEditorDeviceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePinEditor();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pinEditorDeviceId]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowEpochMs(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (!adminData) {
      setAdminDeviceSnapshots({});
      setAdminDeviceIpById({});
    }
  }, [adminData]);

  useEffect(() => {
    if (!adminData || adminPage !== 'devices') {
      return;
    }

    const latestSnapshots = buildDeviceTelemetrySnapshots(adminData.events);
    if (Object.keys(latestSnapshots).length > 0) {
      setAdminDeviceSnapshots((previous) => mergeTelemetrySnapshotCache(previous, latestSnapshots));
    }

    const latestIpByDeviceId: Record<string, string> = {};
    for (const device of adminData.devices) {
      const ipAddress = extractIpAddressFromDeviceStatus(device, adminData.events);
      if (ipAddress) {
        latestIpByDeviceId[device.deviceId] = ipAddress;
      }
    }
    setAdminDeviceIpById((previous) =>
      mergeIpAddressCache(
        previous,
        latestIpByDeviceId,
        adminData.devices.map((device) => device.deviceId)
      )
    );
  }, [adminData?.events, adminPage]);

  useEffect(() => {
    if (!adminData || adminPage !== 'devices') {
      return;
    }

    const latestWifiIpByDeviceId: Record<string, string> = {};
    for (const device of adminData.devices) {
      if (!device.wifiPayloadJson) {
        continue;
      }
      const ipAddress = findIpAddress(tryParsePayload(device.wifiPayloadJson));
      if (ipAddress) {
        latestWifiIpByDeviceId[device.deviceId] = ipAddress;
      }
    }
    if (Object.keys(latestWifiIpByDeviceId).length === 0) {
      return;
    }
    setAdminDeviceIpById((previous) =>
      mergeIpAddressCache(
        previous,
        latestWifiIpByDeviceId,
        adminData.devices.map((device) => device.deviceId)
      )
    );
  }, [adminData?.devices, adminPage]);

  useEffect(() => {
    if (!session || !token) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let groupRefreshTimer: number | null = null;
    let studentFeedFlushTimer: number | null = null;
    let adminFeedFlushTimer: number | null = null;
    let adminDeviceStatusFlushTimer: number | null = null;
    let studentFeedQueue: CanonicalEvent[] = [];
    let adminFeedQueue: CanonicalEvent[] = [];
    const adminDeviceStatusQueue = new Map<string, DeviceStatus>();
    let closed = false;

    const rolePath = session.role === 'ADMIN' ? '/ws/admin' : '/ws/student';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const scheduleGroupRefresh = () => {
      if (groupRefreshTimer !== null) {
        return;
      }
      groupRefreshTimer = window.setTimeout(() => {
        groupRefreshTimer = null;
        refreshAdminGroups(token).catch((error) => reportBackgroundError('refreshAdminGroups', error));
      }, 350);
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer !== null) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1500);
    };

    const flushStudentFeedQueue = () => {
      studentFeedFlushTimer = null;
      if (studentFeedQueue.length === 0) {
        return;
      }
      const queued = studentFeedQueue;
      studentFeedQueue = [];
      markFeedEventsRecent(queued);
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        const nextFeed = mergeEventsBounded(previous.feed, queued, MAX_FEED_EVENTS);
        if (nextFeed === previous.feed) {
          return previous;
        }
        return {
          ...previous,
          feed: nextFeed
        };
      });
    };

    const queueStudentFeedEvent = (eventPayload: CanonicalEvent) => {
      studentFeedQueue.push(eventPayload);
      if (studentFeedFlushTimer !== null) {
        return;
      }
      studentFeedFlushTimer = window.setTimeout(flushStudentFeedQueue, 180);
    };

    const flushAdminFeedQueue = () => {
      adminFeedFlushTimer = null;
      if (adminFeedQueue.length === 0) {
        return;
      }
      const queued = adminFeedQueue;
      adminFeedQueue = [];

      queueDeferredAdminFeedEvents(queued);

      const currentPage = adminPageRef.current;
      if (currentPage === 'devices') {
        const latestSnapshots = buildDeviceTelemetrySnapshots(queued);
        if (Object.keys(latestSnapshots).length > 0) {
          setAdminDeviceSnapshots((previous) =>
            mergeTelemetrySnapshotCache(previous, latestSnapshots)
          );
        }

        const latestIpByDeviceId = extractIpAddressesFromEvents(queued);
        if (Object.keys(latestIpByDeviceId).length > 0) {
          setAdminDeviceIpById((previous) => {
            const activeDeviceIds =
              adminDataRef.current?.devices.map((device) => device.deviceId) ??
              Array.from(new Set([...Object.keys(previous), ...Object.keys(latestIpByDeviceId)]));
            return mergeIpAddressCache(previous, latestIpByDeviceId, activeDeviceIds);
          });
        }
      }

      if (isAdminFeedHotPage(currentPage)) {
        flushDeferredAdminFeedEvents(currentPage === 'feed');
      }
    };

    const queueAdminFeedEvent = (eventPayload: CanonicalEvent) => {
      adminFeedQueue.push(eventPayload);
      if (adminFeedFlushTimer !== null) {
        return;
      }
      adminFeedFlushTimer = window.setTimeout(flushAdminFeedQueue, 180);
    };

    const flushAdminDeviceStatusQueue = () => {
      adminDeviceStatusFlushTimer = null;
      if (adminDeviceStatusQueue.size === 0) {
        return;
      }
      const queuedStatuses = Array.from(adminDeviceStatusQueue.values());
      adminDeviceStatusQueue.clear();
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        const nextDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));
        let changed = false;
        for (const queuedDevice of queuedStatuses) {
          const existing = nextDevices.get(queuedDevice.deviceId);
          if (existing && sameDeviceStatus(existing, queuedDevice)) {
            continue;
          }
          nextDevices.set(queuedDevice.deviceId, queuedDevice);
          changed = true;
        }
        if (!changed) {
          return previous;
        }
        return {
          ...previous,
          devices: Array.from(nextDevices.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId))
        };
      });
    };

    const queueAdminDeviceStatus = (deviceStatus: DeviceStatus) => {
      adminDeviceStatusQueue.set(deviceStatus.deviceId, deviceStatus);
      if (adminDeviceStatusFlushTimer !== null) {
        return;
      }
      adminDeviceStatusFlushTimer = window.setTimeout(flushAdminDeviceStatusQueue, 240);
    };

    const handleEnvelope = (envelope: WsEnvelope<unknown>) => {
      if (session.role === 'STUDENT') {
        if (envelope.type === 'event.feed.append') {
          if (studentPauseRef.current) {
            return;
          }
          queueStudentFeedEvent(envelope.payload as CanonicalEvent);
          return;
        }

        if (envelope.type === 'group.presence.updated') {
          const presence = Array.isArray(envelope.payload)
            ? (envelope.payload as PresenceUser[])
            : [];
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              groupPresence: presence
            };
          });
          return;
        }

        if (envelope.type === 'group.config.updated') {
          const nextConfig = envelope.payload as GroupConfig;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              groupConfig: nextConfig
            };
          });
          setStudentConfigDraft(safeConfigMap(nextConfig.config));
          return;
        }

        if (envelope.type === 'capabilities.updated') {
          const nextCapabilities = envelope.payload as TaskCapabilities;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              capabilities: nextCapabilities
            };
          });
          return;
        }

        if (envelope.type === 'task.updated') {
          if (!envelope.payload || typeof envelope.payload !== 'object') {
            return;
          }
          const taskLike = envelope.payload as TaskDefinitionPayload | TaskInfo;
          const task = extractTaskInfo(taskLike);
          if (!task) {
            return;
          }
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              activeTask: task,
              capabilities:
                (taskLike as TaskDefinitionPayload).studentCapabilities ?? previous.capabilities
            };
          });
          return;
        }

        if (envelope.type === 'error.notification') {
          setErrorMessage(String(envelope.payload));
          return;
        }

        if (envelope.type === 'settings.updated') {
          const settings = envelope.payload as AppSettings;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              settings
            };
          });
          setDefaultLanguageMode(settings.defaultLanguageMode);
          setTimeFormat24h(settings.timeFormat24h);
        }
        return;
      }

      if (envelope.type === 'event.feed.append') {
        if (adminPauseRef.current) {
          return;
        }
        queueAdminFeedEvent(envelope.payload as CanonicalEvent);
        return;
      }

      if (envelope.type === 'device.status.updated') {
        queueAdminDeviceStatus(envelope.payload as DeviceStatus);
        return;
      }

      if (envelope.type === 'admin.groups.updated') {
        scheduleGroupRefresh();
        return;
      }

      if (envelope.type === 'task.updated') {
        refreshAdminTasks(token).catch((error) => reportBackgroundError('refreshAdminTasks', error));
        return;
      }

      if (envelope.type === 'settings.updated') {
        const settings = envelope.payload as AppSettings;
        setAdminData((previous) => {
          if (!previous) {
            return previous;
          }
          return {
            ...previous,
            settings
          };
        });
        setAdminSettingsDraftMode(settings.defaultLanguageMode);
        setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
        setDefaultLanguageMode(settings.defaultLanguageMode);
        setTimeFormat24h(settings.timeFormat24h);
        return;
      }

      if (envelope.type === 'error.notification') {
        setErrorMessage(String(envelope.payload));
      }
    };

    const connect = () => {
      if (closed) {
        return;
      }

      setWsConnection('connecting');
      socket = new WebSocket(
        `${protocol}//${window.location.host}${rolePath}?token=${encodeURIComponent(token)}`
      );

      socket.onopen = () => {
        if (!closed) {
          setWsConnection('connected');
        }
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data) as WsEnvelope<unknown>;
          handleEnvelope(envelope);
        } catch (error) {
          setErrorMessage(toErrorMessage(error));
        }
      };

      socket.onclose = () => {
        if (closed) {
          return;
        }
        setWsConnection('disconnected');
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (!closed) {
          setWsConnection('disconnected');
          scheduleReconnect();
        }
      };
    };

    connect();

    return () => {
      closed = true;
      setWsConnection('disconnected');

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (groupRefreshTimer !== null) {
        window.clearTimeout(groupRefreshTimer);
      }
      if (studentFeedFlushTimer !== null) {
        window.clearTimeout(studentFeedFlushTimer);
      }
      if (adminFeedFlushTimer !== null) {
        window.clearTimeout(adminFeedFlushTimer);
      }
      if (adminDeviceStatusFlushTimer !== null) {
        window.clearTimeout(adminDeviceStatusFlushTimer);
      }
      studentFeedQueue = [];
      adminFeedQueue = [];
      adminDeviceStatusQueue.clear();

      if (socket) {
        socket.close();
      }
    };
  }, [
    flushDeferredAdminFeedEvents,
    queueDeferredAdminFeedEvents,
    refreshAdminGroups,
    refreshAdminTasks,
    reportBackgroundError,
    session,
    token
  ]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('login');
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const me = await api.login(loginUsername.trim(), loginPin.trim());
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, me.sessionToken);
      }
      setToken(me.sessionToken);
      setLoginPin('');
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const handleLogout = async () => {
    const activeToken = token;
    setBusyKey('logout');

    try {
      if (activeToken) {
        await api.logout(activeToken);
      }
    } catch {
      // ignore logout transport errors to keep local logout reliable
    } finally {
      setBusyKey(null);
      clearAuth();
      setBooting(false);
    }
  };

  const setManualLanguage = (nextLanguage: Language) => {
    setLanguageOverride(nextLanguage);
    setStoredLanguageOverride(nextLanguage);
  };

  const saveDisplayName = async () => {
    if (!token || !session || session.role !== 'STUDENT') {
      return;
    }

    setBusyKey('display-name');
    setErrorMessage(null);

    try {
      const updated = await api.updateDisplayName(token, displayNameDraft.trim());
      setSession(updated);
      setInfoMessage(t('displayNameSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveStudentConfig = async () => {
    if (!token || !studentData) {
      return;
    }

    setBusyKey('student-config');
    setErrorMessage(null);

    try {
      const sanitized = sanitizeConfigForCapabilities(studentConfigDraft, studentData.capabilities);
      const updated = await api.updateStudentConfig(token, sanitized);
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          groupConfig: updated
        };
      });
      setStudentConfigDraft(safeConfigMap(updated.config));
      setInfoMessage(t('configSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendStudentCommand = async (command: DeviceCommandType, on?: boolean) => {
    if (!token || !session || session.role !== 'STUDENT' || !session.groupKey) {
      return;
    }

    setBusyKey(`student-command-${command}-${String(on)}`);
    setErrorMessage(null);

    try {
      await api.sendStudentCommand(token, session.groupKey, command, on);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const activateTask = async (taskId: string) => {
    if (!token) {
      return;
    }

    setBusyKey(`activate-${taskId}`);
    setErrorMessage(null);

    try {
      const task = await api.activateTask(token, taskId);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }

        const nextTasks = previous.tasks.map((entry) => ({
          ...entry,
          active: entry.id === task.id
        }));

        return {
          ...previous,
          tasks: nextTasks
        };
      });
      setInfoMessage(t('taskUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveAdminSettings = async () => {
    if (!token) {
      return;
    }

    setBusyKey('admin-settings');
    setErrorMessage(null);

    try {
      const updated = await api.updateAdminSettings(
        token,
        adminSettingsDraftMode,
        adminSettingsDraftTimeFormat24h
      );
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          settings: updated
        };
      });
      setDefaultLanguageMode(updated.defaultLanguageMode);
      setTimeFormat24h(updated.timeFormat24h);
      setAdminSettingsDraftTimeFormat24h(updated.timeFormat24h);
      setInfoMessage(t('settingsUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendAdminDeviceCommand = async (
    deviceId: string,
    command: DeviceCommandType,
    on?: boolean
  ): Promise<boolean> => {
    if (!token) {
      return false;
    }

    setBusyKey(`admin-command-${deviceId}-${command}-${String(on)}`);
    setErrorMessage(null);

    try {
      await api.adminDeviceCommand(token, deviceId, command, on);
      return true;
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const closeCounterResetModal = () => {
    setCounterResetDeviceId(null);
  };

  const openCounterResetModal = (deviceId: string) => {
    setCounterResetDeviceId(deviceId);
  };

  const confirmCounterReset = async () => {
    if (!counterResetDeviceId) {
      return;
    }
    const ok = await sendAdminDeviceCommand(counterResetDeviceId, 'COUNTER_RESET');
    if (ok) {
      closeCounterResetModal();
    }
  };

  const closePinEditor = () => {
    setPinEditorDeviceId(null);
    setPinEditorValue('');
    setPinEditorLoading(false);
  };

  const openPinEditor = async (deviceId: string) => {
    if (!token) {
      return;
    }

    setPinEditorDeviceId(deviceId);
    setPinEditorValue('');
    setPinEditorLoading(true);
    setErrorMessage(null);

    try {
      const pinInfo = await api.adminDevicePin(token, deviceId);
      setPinEditorValue(pinInfo.pin);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setPinEditorDeviceId(null);
    } finally {
      setPinEditorLoading(false);
    }
  };

  const savePinEditor = async () => {
    if (!token || !pinEditorDeviceId) {
      return;
    }
    const nextPin = pinEditorValue.trim();
    if (!nextPin) {
      setErrorMessage(toErrorMessage(new Error('PIN must not be blank')));
      return;
    }

    setBusyKey(`pin-save-${pinEditorDeviceId}`);
    setErrorMessage(null);

    try {
      const updated = await api.updateAdminDevicePin(token, pinEditorDeviceId, nextPin);
      setPinEditorValue(updated.pin);
      setInfoMessage(t('pinSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const refreshAdminData = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }

    setBusyKey('admin-refresh');
    setErrorMessage(null);

    try {
      const [tasks, devices, groups, events, settings] = await Promise.all([
        api.adminTasks(token),
        api.adminDevices(token),
        api.adminGroups(token),
        api.eventsFeed(token, { limit: MAX_FEED_EVENTS, includeInternal: true }),
        api.adminSettings(token)
      ]);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          tasks,
          devices,
          groups,
          events: clampFeed(events),
          settings
        };
      });
      deferredAdminFeedRef.current = [];
      setAdminSettingsDraftMode(settings.defaultLanguageMode);
      setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
      setDefaultLanguageMode(settings.defaultLanguageMode);
      setTimeFormat24h(settings.timeFormat24h);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const studentVisibleFeed = useMemo(() => {
    if (!studentData) {
      return [];
    }

    return studentData.feed.filter((event) => {
      if (!studentShowInternal && (event.isInternal || isTelemetryEvent(event))) {
        return false;
      }
      return feedMatchesTopic(event, studentTopicFilter);
    });
  }, [studentData, studentShowInternal, studentTopicFilter]);

  const adminVisibleFeed = useMemo(() => {
    if (!adminData || session?.role !== 'ADMIN' || adminPage !== 'feed') {
      return [];
    }

    return adminData.events.filter((event) => {
      if (!adminIncludeInternal && (event.isInternal || isTelemetryEvent(event))) {
        return false;
      }

      if (adminCategoryFilter !== 'ALL' && event.category !== adminCategoryFilter) {
        return false;
      }

      if (adminDeviceFilter.trim().length > 0 && event.deviceId !== adminDeviceFilter.trim()) {
        return false;
      }

      return feedMatchesTopic(event, adminTopicFilter);
    });
  }, [adminCategoryFilter, adminData, adminDeviceFilter, adminIncludeInternal, adminPage, adminTopicFilter, session?.role]);

  const studentFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of studentVisibleFeed) {
      values.set(event.id, eventValueSummary(event));
    }
    return values;
  }, [studentVisibleFeed]);

  const adminFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of adminVisibleFeed) {
      values.set(event.id, eventValueSummary(event));
    }
    return values;
  }, [adminVisibleFeed]);

  const wsLabel = useMemo(() => {
    if (wsConnection === 'connected') {
      return t('wsConnected');
    }
    if (wsConnection === 'connecting') {
      return t('wsConnecting');
    }
    return t('wsDisconnected');
  }, [t, wsConnection]);

  const roleLabel = useMemo(() => {
    if (!session) {
      return null;
    }
    return session.role === 'ADMIN' ? t('roleAdmin') : t('roleStudent');
  }, [session, t]);

  const userMenuLabel = useMemo(() => {
    if (!session) {
      return '';
    }
    return session.displayName?.trim() || session.username;
  }, [session]);

  const adminOnlineDeviceCount = useMemo(() => {
    if (!adminData) {
      return 0;
    }
    return adminData.devices.reduce((sum, device) => sum + (device.online ? 1 : 0), 0);
  }, [adminData]);

  const adminOnlineUserCount = useMemo(() => {
    if (!adminData) {
      return 0;
    }
    return adminData.groups.reduce((sum, group) => sum + group.onlineCount, 0);
  }, [adminData]);

  const adminActiveTask = useMemo(() => {
    if (!adminData) {
      return null;
    }
    return adminData.tasks.find((task) => task.active) ?? null;
  }, [adminData]);

  const adminLatestEvent = useMemo(() => {
    if (!adminData || adminData.events.length === 0) {
      return null;
    }
    return adminData.events[0];
  }, [adminData]);

  const counterResetBusy = counterResetDeviceId
    ? busyKey === `admin-command-${counterResetDeviceId}-COUNTER_RESET-undefined`
    : false;

  const openSettingsSection = useCallback(() => {
    if (session?.role === 'ADMIN') {
      setAdminPage('settings');
      setUserMenuOpen(false);
      return;
    }
    const element = document.getElementById('student-settings-panel');
    if (!element) {
      setUserMenuOpen(false);
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setUserMenuOpen(false);
  }, [session]);

  const formatTs = useCallback(
    (value: TimestampValue): string => {
      return formatTimestamp(value, language, timeFormat24h);
    },
    [language, timeFormat24h]
  );

  const selectedEventFields = useMemo<Array<[string, string]>>(() => {
    if (!selectedEvent) {
      return [];
    }

    return [
      ['ID', selectedEvent.id],
      ['DEVICE ID', selectedEvent.deviceId],
      ['TOPIC', selectedEvent.topic],
      ['EVENT TYPE', selectedEvent.eventType],
      ['CATEGORY', selectedEvent.category],
      ['INGEST TS', formatTs(selectedEvent.ingestTs)],
      ['DEVICE TS', formatTs(selectedEvent.deviceTs)],
      ['VALUE', eventValueSummary(selectedEvent) || '-'],
      ['VALID', String(selectedEvent.valid)],
      ['VALIDATION ERRORS', selectedEvent.validationErrors ?? '-'],
      ['INTERNAL', String(selectedEvent.isInternal)],
      ['GROUP KEY', selectedEvent.groupKey ?? '-'],
      ['SEQUENCE NO', selectedEvent.sequenceNo == null ? '-' : String(selectedEvent.sequenceNo)],
      ['SCENARIO FLAGS', selectedEvent.scenarioFlags]
    ];
  }, [formatTs, selectedEvent]);

  const selectedEventRawJson = useMemo(() => {
    if (!selectedEvent) {
      return '';
    }
    const parsedPayload = tryParsePayload(selectedEvent.payloadJson);
    const payloadForRaw = parsedPayload === null ? selectedEvent.payloadJson : parsedPayload;
    return JSON.stringify(
      {
        ...selectedEvent,
        payloadJson: payloadForRaw,
        payloadJsonRaw: selectedEvent.payloadJson
      },
      null,
      2
    );
  }, [selectedEvent]);

  const renderConfigInput = (
    option: string,
    value: unknown,
    setValue: (next: unknown) => void
  ) => {
    if (option === 'displayMode') {
      const selected = typeof value === 'string' ? value : 'compact';
      return (
        <select
          className="input"
          value={selected}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="compact">compact</option>
          <option value="detailed">detailed</option>
        </select>
      );
    }

    if (option === 'sensorFocus') {
      const selected = typeof value === 'string' ? value : 'all';
      return (
        <select
          className="input"
          value={selected}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="all">all</option>
          <option value="ldr">ldr</option>
          <option value="dht22">dht22</option>
          <option value="buttons">buttons</option>
        </select>
      );
    }

    if (option === 'commandPanel') {
      return (
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => setValue(event.target.checked)}
          />
          <span>enabled</span>
        </label>
      );
    }

    const textValue =
      typeof value === 'string'
        ? value
        : value === undefined || value === null
          ? ''
          : JSON.stringify(value);

    return (
      <input
        className="input"
        value={textValue}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>{t('appTitle')}</h1>
          <p>{t('appSubtitle')}</p>
        </div>

        <div className="topbar-controls">
          {session ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="button secondary user-menu-trigger"
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <span className="user-menu-name">{userMenuLabel}</span>
                <span className="user-menu-caret" aria-hidden="true">▾</span>
              </button>

              {userMenuOpen ? (
                <div className="user-menu-panel" role="menu">
                  <div className="user-menu-status-row">
                    <span className={`status-pill ${wsConnection}`}>{wsLabel}</span>
                    {roleLabel ? <span className="status-pill role">{roleLabel}</span> : null}
                  </div>

                  <div className="user-menu-section">
                    <div className="user-menu-label">{t('language')}</div>
                    <div className="user-menu-actions">
                      <button
                        className={`button tiny ${language === 'de' ? 'active' : 'secondary'}`}
                        type="button"
                        onClick={() => setManualLanguage('de')}
                      >
                        DE
                      </button>
                      <button
                        className={`button tiny ${language === 'en' ? 'active' : 'secondary'}`}
                        type="button"
                        onClick={() => setManualLanguage('en')}
                      >
                        EN
                      </button>
                    </div>
                  </div>

                  <button className="button secondary user-menu-link" type="button" onClick={openSettingsSection}>
                    {t('settings')}
                  </button>

                  <button
                    className="button danger user-menu-link"
                    type="button"
                    onClick={handleLogout}
                    disabled={busyKey === 'logout'}
                  >
                    {t('logout')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <main className="content">
        {errorMessage ? (
          <div className="alert error">
            {t('errorPrefix')}: {errorMessage}
          </div>
        ) : null}

        {infoMessage ? <div className="alert info">{infoMessage}</div> : null}

        {booting ? (
          <section className="panel loading">{t('loading')}</section>
        ) : null}

        {!booting && !session ? (
          <section className="panel login-panel">
            <h2>{t('loginTitle')}</h2>
            <form onSubmit={handleLogin} className="form-grid">
              <label>
                <span>{t('username')}</span>
                <input
                  className="input"
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  required
                />
              </label>

              <label>
                <span>{t('pin')}</span>
                <input
                  className="input"
                  type="password"
                  value={loginPin}
                  onChange={(event) => setLoginPin(event.target.value)}
                  required
                />
              </label>

              <button className="button" type="submit" disabled={busyKey === 'login'}>
                {t('login')}
              </button>
            </form>
            <p className="muted">{t('loginHint')}</p>
          </section>
        ) : null}

        {!booting && session?.role === 'STUDENT' && studentData ? (
          <div className="dashboard-grid">
            <section className="panel hero panel-animate">
              <h2>{t('currentTask')}</h2>
              <h3>{taskTitle(studentData.activeTask, language)}</h3>
              <p>{taskDescription(studentData.activeTask, language)}</p>

              <div className="chip-row">
                <span className="chip">
                  {t('defaultMode')}: {defaultLanguageMode}
                </span>
                <span className="chip">{t('feedLimited')}</span>
              </div>

              <div className="split-grid">
                <label>
                  <span>{t('displayName')}</span>
                  <input
                    className="input"
                    value={displayNameDraft}
                    onChange={(event) => setDisplayNameDraft(event.target.value)}
                  />
                </label>

                <button
                  className="button"
                  type="button"
                  onClick={saveDisplayName}
                  disabled={busyKey === 'display-name'}
                >
                  {t('save')}
                </button>
              </div>
            </section>

            <section className="panel panel-animate" id="student-settings-panel">
              <h2>{t('groupConfig')}</h2>
              <div className="config-grid">
                {studentData.capabilities.allowedConfigOptions.map((option) => (
                  <label key={option}>
                    <span>{option}</span>
                    {renderConfigInput(option, studentConfigDraft[option], (next) => {
                      setStudentConfigDraft((previous) => ({
                        ...previous,
                        [option]: next
                      }));
                    })}
                  </label>
                ))}
              </div>

              <div className="meta-row">
                <span>
                  {t('revision')}: {studentData.groupConfig.revision}
                </span>
                <span>
                  {t('updatedBy')}: {studentData.groupConfig.updatedBy}
                </span>
                <span>
                  {t('lastSeen')}: {formatTs(studentData.groupConfig.updatedAt)}
                </span>
              </div>

              <button
                className="button"
                type="button"
                onClick={saveStudentConfig}
                disabled={busyKey === 'student-config'}
              >
                {t('save')}
              </button>
            </section>

            <section className="panel panel-animate">
              <h2>{t('groupPresence')}</h2>
                <ul className="presence-list">
                  {studentData.groupPresence.map((presence) => (
                  <li key={`${presence.username}-${presence.displayName}`}>
                    <strong>{presence.displayName}</strong>
                    <span>{formatTs(presence.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel panel-animate">
              <h2>{t('capabilities')}</h2>
              <div className="chip-row">
                <span className="chip">canViewRoomEvents: {String(studentData.capabilities.canViewRoomEvents)}</span>
                <span className="chip">canSendDeviceCommands: {String(studentData.capabilities.canSendDeviceCommands)}</span>
                <span className="chip">canFilterByTopic: {String(studentData.capabilities.canFilterByTopic)}</span>
                <span className="chip">
                  showInternalEventsToggle: {String(studentData.capabilities.showInternalEventsToggle)}
                </span>
              </div>
            </section>

            {studentData.capabilities.canSendDeviceCommands ? (
              <section className="panel panel-animate">
                <h2>{t('commands')}</h2>
                <p className="muted">{t('ownDeviceOnly')}</p>
                <div className="button-grid">
                  {studentData.capabilities.studentCommandWhitelist.includes('LED_GREEN') ? (
                    <>
                      <button
                        className="button"
                        type="button"
                        onClick={() => sendStudentCommand('LED_GREEN', true)}
                        disabled={busyKey === 'student-command-LED_GREEN-true'}
                      >
                        {t('commandGreenOn')}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => sendStudentCommand('LED_GREEN', false)}
                        disabled={busyKey === 'student-command-LED_GREEN-false'}
                      >
                        {t('commandGreenOff')}
                      </button>
                    </>
                  ) : null}

                  {studentData.capabilities.studentCommandWhitelist.includes('LED_ORANGE') ? (
                    <>
                      <button
                        className="button"
                        type="button"
                        onClick={() => sendStudentCommand('LED_ORANGE', true)}
                        disabled={busyKey === 'student-command-LED_ORANGE-true'}
                      >
                        {t('commandOrangeOn')}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => sendStudentCommand('LED_ORANGE', false)}
                        disabled={busyKey === 'student-command-LED_ORANGE-false'}
                      >
                        {t('commandOrangeOff')}
                      </button>
                    </>
                  ) : null}

                  {studentData.capabilities.studentCommandWhitelist.includes('COUNTER_RESET') ? (
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => sendStudentCommand('COUNTER_RESET')}
                      disabled={busyKey === 'student-command-COUNTER_RESET-undefined'}
                    >
                      {t('commandCounterReset')}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="panel panel-animate feed-panel full-width">
              <h2>{t('liveFeed')}</h2>
              <div className="toolbar">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setStudentFeedPaused((value) => !value)}
                >
                  {studentFeedPaused ? t('resume') : t('pause')}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
                  }
                >
                  {feedViewMode === 'rendered' ? t('switchToRawFeed') : t('switchToRenderedFeed')}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setStudentData((previous) => {
                      if (!previous) {
                        return previous;
                      }
                      return { ...previous, feed: [] };
                    });
                  }}
                >
                  {t('clear')}
                </button>

                <input
                  className="input"
                  placeholder={t('topicFilter')}
                  value={studentTopicFilter}
                  onChange={(event) => setStudentTopicFilter(event.target.value)}
                  disabled={!studentData.capabilities.canFilterByTopic}
                />

                {studentData.capabilities.showInternalEventsToggle ? (
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={studentShowInternal}
                      onChange={(event) => setStudentShowInternal(event.target.checked)}
                    />
                    <span>{t('includeInternal')}</span>
                  </label>
                ) : null}
              </div>

              <div className="feed-table-wrap">
                <table className="feed-table">
                  <thead>
                    <tr>
                      <th>INGEST TS</th>
                      <th>DEVICE ID</th>
                      <th>EVENT TYPE</th>
                      <th>{feedViewMode === 'rendered' ? t('value') : t('rawPayload')}</th>
                      <th>TOPIC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentVisibleFeed.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          {t('noEvents')}
                        </td>
                      </tr>
                    ) : (
                      studentVisibleFeed.map((eventItem) => (
                          <tr
                            key={eventItem.id}
                            className={`feed-row-clickable ${recentFeedEventIds[eventItem.id] ? 'feed-row-new' : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSelectedEvent(eventItem);
                              setEventDetailsViewMode('rendered');
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedEvent(eventItem);
                                setEventDetailsViewMode('rendered');
                              }
                            }}
                          >
                            <td>{formatTs(eventItem.ingestTs)}</td>
                            <td>{eventItem.deviceId}</td>
                            <td>{eventItem.eventType}</td>
                            <td className="mono raw-cell">
                              {feedViewMode === 'rendered'
                                ? (studentFeedValues.get(eventItem.id) ?? '')
                                : eventItem.payloadJson}
                            </td>
                            <td className="mono">{eventItem.topic}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {!booting && session?.role === 'ADMIN' && adminData ? (
          <div className="admin-page-shell">
            <nav className="panel panel-animate admin-page-nav">
              <button
                className={`button tiny ${adminPage === 'dashboard' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setAdminPage('dashboard')}
              >
                {t('dashboard')}
              </button>
              <button
                className={`button tiny ${adminPage === 'devices' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setAdminPage('devices')}
              >
                {t('devices')}
              </button>
              <button
                className={`button tiny ${adminPage === 'feed' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setAdminPage('feed')}
              >
                {t('liveFeed')}
              </button>
              <button
                className={`button tiny ${adminPage === 'groupsTasks' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setAdminPage('groupsTasks')}
              >
                {t('groupsTasks')}
              </button>
              <button
                className={`button tiny ${adminPage === 'settings' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setAdminPage('settings')}
              >
                {t('settings')}
              </button>
            </nav>

            <div className="dashboard-grid">
              {adminPage === 'dashboard' ? (
                <>
                  <section className="panel hero panel-animate full-width">
                    <div className="panel-header">
                      <h2>{t('dashboard')}</h2>
                      <span className={`status-pill ${wsConnection}`}>{wsLabel}</span>
                    </div>
                    <div className="chip-row">
                      <span className="chip">{t('devices')}: {adminData.devices.length}</span>
                      <span className="chip ok">{t('online')}: {adminOnlineDeviceCount}</span>
                      <span className="chip warn">{t('offline')}: {adminData.devices.length - adminOnlineDeviceCount}</span>
                      <span className="chip">{t('groups')}: {adminData.groups.length}</span>
                      <span className="chip">{t('groupPresence')}: {adminOnlineUserCount}</span>
                      <span className="chip">{t('liveFeed')}: {adminData.events.length}</span>
                    </div>
                    <div className="meta-row">
                      <span>{t('currentTask')}: {adminActiveTask ? taskTitle(adminActiveTask, language) : '-'}</span>
                      <span>
                        {t('lastEvent')}: {adminLatestEvent ? formatRelativeFromNow(adminLatestEvent.ingestTs, nowEpochMs, language) : '-'}
                      </span>
                    </div>
                    <div className="admin-dashboard-actions">
                      <button className="button secondary" type="button" onClick={() => setAdminPage('devices')}>
                        {t('devices')}
                      </button>
                      <button className="button secondary" type="button" onClick={() => setAdminPage('feed')}>
                        {t('liveFeed')}
                      </button>
                      <button className="button secondary" type="button" onClick={() => setAdminPage('groupsTasks')}>
                        {t('groupsTasks')}
                      </button>
                      <button className="button secondary" type="button" onClick={() => setAdminPage('settings')}>
                        {t('settings')}
                      </button>
                    </div>
                  </section>

                  <section className="panel panel-animate">
                    <h2>{t('tasks')}</h2>
                    <p className="muted">
                      {t('currentTask')}: {adminActiveTask ? taskTitle(adminActiveTask, language) : '-'}
                    </p>
                  </section>

                  <section className="panel panel-animate">
                    <h2>{t('groups')}</h2>
                    <p className="muted">{t('groupPresence')}: {adminOnlineUserCount}</p>
                  </section>
                </>
              ) : null}

              {adminPage === 'groupsTasks' ? (
                <section className="panel hero panel-animate">
                  <h2>{t('tasks')}</h2>
                  <div className="tasks-list">
                    {adminData.tasks.map((task) => (
                  <article key={task.id} className={`task-card ${task.active ? 'active' : ''}`}>
                    <header>
                      <strong>{taskTitle(task, language)}</strong>
                      {task.active ? <span className="chip">active</span> : null}
                    </header>
                    <p>{taskDescription(task, language)}</p>
                    <button
                      className="button"
                      type="button"
                      onClick={() => activateTask(task.id)}
                      disabled={busyKey === `activate-${task.id}` || task.active}
                    >
                      {t('activate')}
                    </button>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {adminPage === 'settings' ? (
                <section className="panel panel-animate full-width" id="admin-settings-panel">
                  <h2>{t('settings')}</h2>
                  <label>
                    <span>{t('defaultLanguageMode')}</span>
                    <select
                      className="input"
                      value={adminSettingsDraftMode}
                      onChange={(event) =>
                        setAdminSettingsDraftMode(event.target.value as LanguageMode)
                      }
                    >
                      <option value="DE">{t('modeDe')}</option>
                      <option value="EN">{t('modeEn')}</option>
                      <option value="BROWSER_EN_FALLBACK">{t('modeBrowser')}</option>
                    </select>
                  </label>
                  <label>
                    <span>{t('timeFormat')}</span>
                    <select
                      className="input"
                      value={adminSettingsDraftTimeFormat24h ? '24' : '12'}
                      onChange={(event) => setAdminSettingsDraftTimeFormat24h(event.target.value === '24')}
                    >
                      <option value="24">{t('timeFormat24h')}</option>
                      <option value="12">{t('timeFormat12h')}</option>
                    </select>
                  </label>
                  <button
                    className="button"
                    type="button"
                    onClick={saveAdminSettings}
                    disabled={busyKey === 'admin-settings'}
                  >
                    {t('saveSettings')}
                  </button>
                </section>
              ) : null}

              {adminPage === 'groupsTasks' ? (
                <section className="panel panel-animate">
                  <h2>{t('groups')}</h2>
                  <div className="groups-list">
                    {adminData.groups.map((group) => (
                      <article key={group.groupKey} className="group-card">
                        <header>
                          <strong>{group.groupKey}</strong>
                          <span className="chip">online: {group.onlineCount}</span>
                        </header>
                        <p className="muted">cfg rev {group.config.revision}</p>
                        <ul>
                          {group.presence.map((presence) => (
                            <li key={`${presence.username}-${presence.displayName}`}>
                              {presence.displayName} - {formatTs(presence.lastSeen)}
                            </li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {adminPage === 'devices' ? (
                <section className="panel panel-animate full-width">
                  <div className="panel-header">
                    <h2>{t('devices')}</h2>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={refreshAdminData}
                      disabled={busyKey === 'admin-refresh'}
                    >
                      {t('refresh')}
                    </button>
                  </div>

                  <div className="devices-grid">
                    {adminData.devices.map((device) => {
                  const snapshot = adminDeviceSnapshots[device.deviceId];
                  const uptimeNow = estimateUptimeNow(snapshot, nowEpochMs);
                  const redPressed = snapshot?.buttonRedPressed ?? null;
                  const blackPressed = snapshot?.buttonBlackPressed ?? null;
                  const greenOn = snapshot?.ledGreenOn ?? null;
                  const orangeOn = snapshot?.ledOrangeOn ?? null;
                  const temperatureC = snapshot?.temperatureC ?? null;
                  const humidityPct = snapshot?.humidityPct ?? null;
                  const brightnessRaw = snapshot?.brightness ?? null;
                  const counterRaw = snapshot?.counterValue ?? null;
                  const isDeviceOnline = device.online;
                  const redButton =
                    !isDeviceOnline || redPressed === null
                      ? t('stateUnknown')
                      : redPressed
                        ? t('statePressed')
                        : t('stateReleased');
                  const blackButton =
                    !isDeviceOnline || blackPressed === null
                      ? t('stateUnknown')
                      : blackPressed
                        ? t('statePressed')
                        : t('stateReleased');
                  const temperature =
                    !isDeviceOnline || temperatureC === null ? '-' : `${temperatureC.toFixed(1)} °C`;
                  const humidity =
                    !isDeviceOnline || humidityPct === null ? '-' : `${Math.round(humidityPct)} %`;
                  const brightness =
                    !isDeviceOnline || brightnessRaw === null ? '-' : formatBrightnessMeasurement(brightnessRaw);
                  const counterValue =
                    counterRaw === null
                      ? '-'
                      : Number.isInteger(counterRaw)
                        ? String(counterRaw)
                        : counterRaw.toFixed(2);
                  const ipAddress = adminDeviceIpById[device.deviceId] ?? '-';
                  const ipAddressHref = ipAddressToHref(ipAddress);
                  const lastEventRelative = formatRelativeFromNow(device.lastSeen, nowEpochMs, language);
                  const bars = rssiBars(device.rssi);
                  const rssiHint =
                    !isDeviceOnline ? '-' : device.rssi === null ? t('rssiNoData') : `${device.rssi} dBm`;
                  const uptimeLabel =
                    !isDeviceOnline || uptimeNow === null ? '-' : formatRoundedDuration(uptimeNow, language);
                  const redButtonClass =
                    !isDeviceOnline || redPressed === null
                      ? 'state-unknown'
                      : redPressed
                        ? 'state-pressed'
                        : 'state-released';
                  const blackButtonClass =
                    !isDeviceOnline || blackPressed === null
                      ? 'state-unknown'
                      : blackPressed
                        ? 'state-pressed'
                        : 'state-released';
                  const nextGreenState = greenOn === null ? true : !greenOn;
                  const nextOrangeState = orangeOn === null ? true : !orangeOn;
                  const greenBusy =
                    busyKey?.startsWith(`admin-command-${device.deviceId}-LED_GREEN-`) ?? false;
                  const orangeBusy =
                    busyKey?.startsWith(`admin-command-${device.deviceId}-LED_ORANGE-`) ?? false;
                  const counterBusy = busyKey === `admin-command-${device.deviceId}-COUNTER_RESET-undefined`;
                  const rssiTooltipId = `rssi-tooltip-${device.deviceId}`;

                  return (
                    <article className="device-card" key={device.deviceId}>
                      <header>
                        <strong>{device.deviceId}</strong>
                        <div className="device-header-actions">
                          <button
                            className="icon-button"
                            type="button"
                            title={t('pinSettings')}
                            aria-label={`${t('pinSettings')} ${device.deviceId}`}
                            onClick={() => openPinEditor(device.deviceId)}
                          >
                            <SettingsIcon />
                          </button>
                          <span className={`chip ${device.online ? 'ok' : 'warn'}`}>
                            {statusLabel(device.online, language)}
                          </span>
                        </div>
                      </header>

                      <p title={formatTs(device.lastSeen)}>
                        {t('lastEvent')}: {lastEventRelative}
                      </p>
                      <p>
                        {t('ipAddress')}:{' '}
                        {ipAddressHref ? (
                          <a
                            className="device-link"
                            href={ipAddressHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {ipAddress}
                          </a>
                        ) : (
                          ipAddress
                        )}
                      </p>
                      <p>
                        {t('uptime')}: {uptimeLabel}
                      </p>
                      <div className="rssi-row">
                        <span>{t('rssi')}:</span>
                        {isDeviceOnline ? (
                          <div className="rssi-tooltip-host">
                            <div
                              className={`rssi-bars ${rssiClassName(device.rssi)}`}
                              aria-label={rssiHint}
                              aria-describedby={rssiTooltipId}
                            >
                              <span className={`bar ${bars >= 1 ? 'active' : ''}`} />
                              <span className={`bar ${bars >= 2 ? 'active' : ''}`} />
                              <span className={`bar ${bars >= 3 ? 'active' : ''}`} />
                              <span className={`bar ${bars >= 4 ? 'active' : ''}`} />
                            </div>
                            <span className="rssi-tooltip" id={rssiTooltipId}>
                              {rssiHint}
                            </span>
                          </div>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </div>
                      <div className="device-metrics-grid">
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="temperature" />
                          </span>
                          <span className="metric-text" title={t('metricTemp')}>{temperature}</span>
                        </div>
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="humidity" />
                          </span>
                          <span className="metric-text" title={t('metricHumidity')}>{humidity}</span>
                        </div>
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="brightness" />
                          </span>
                          <span className="metric-text" title={t('metricBrightness')}>{brightness}</span>
                        </div>
                        <button
                          className="device-metric counter-metric-trigger"
                          type="button"
                          onClick={() => openCounterResetModal(device.deviceId)}
                          title={t('commandCounterReset')}
                          disabled={!isDeviceOnline || counterBusy}
                        >
                          <span className="metric-icon">
                            <MetricIcon kind="counter" />
                          </span>
                          <span className="metric-text">{counterValue}</span>
                        </button>
                        <div className="device-metric full">
                          <span className="metric-icon">
                            <MetricIcon kind="buttons" />
                          </span>
                          <span className="metric-text metric-state-row">
                            <span className="metric-label">Red:</span>
                            <span className={`state-label ${redButtonClass}`}>{redButton}</span>
                          </span>
                        </div>
                        <div className="device-metric full">
                          <span className="metric-icon">
                            <MetricIcon kind="buttons" />
                          </span>
                          <span className="metric-text metric-state-row">
                            <span className="metric-label">Black:</span>
                            <span className={`state-label ${blackButtonClass}`}>{blackButton}</span>
                          </span>
                        </div>
                      </div>

                      <div className="button-grid">
                        <button
                          className={`button ${greenOn ? 'active' : 'secondary'}`}
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_GREEN', nextGreenState)}
                          disabled={greenBusy || !isDeviceOnline}
                        >
                          {t('commandGreenLed')}
                        </button>
                        <button
                          className={`button ${orangeOn ? 'active' : 'secondary'}`}
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_ORANGE', nextOrangeState)}
                          disabled={orangeBusy || !isDeviceOnline}
                        >
                          {t('commandOrangeLed')}
                        </button>
                      </div>
                    </article>
                  );
                    })}
                  </div>
                </section>
              ) : null}

              {adminPage === 'feed' ? (
                <section className="panel panel-animate feed-panel full-width">
                  <h2>{t('liveFeed')}</h2>
                  <div className="toolbar">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setAdminFeedPaused((value) => !value)}
                    >
                      {adminFeedPaused ? t('resume') : t('pause')}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
                      }
                    >
                      {feedViewMode === 'rendered' ? t('switchToRawFeed') : t('switchToRenderedFeed')}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setAdminData((previous) => {
                          if (!previous) {
                            return previous;
                          }
                          return { ...previous, events: [] };
                        });
                      }}
                    >
                      {t('clear')}
                    </button>

                <input
                  className="input"
                  placeholder={t('topicFilter')}
                  value={adminTopicFilter}
                  onChange={(event) => setAdminTopicFilter(event.target.value)}
                />

                <input
                  className="input"
                  placeholder={t('device')}
                  value={adminDeviceFilter}
                  onChange={(event) => setAdminDeviceFilter(event.target.value)}
                />

                <select
                  className="input"
                  value={adminCategoryFilter}
                  onChange={(event) =>
                    setAdminCategoryFilter(event.target.value as EventCategory | 'ALL')
                  }
                >
                  {CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>

                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={adminIncludeInternal}
                    onChange={(event) => setAdminIncludeInternal(event.target.checked)}
                  />
                  <span>{t('includeInternal')}</span>
                </label>
                  </div>

                  <div className="feed-table-wrap">
                    <table className="feed-table">
                      <thead>
                        <tr>
                          <th>INGEST TS</th>
                          <th>DEVICE ID</th>
                          <th>EVENT TYPE</th>
                          <th>{feedViewMode === 'rendered' ? t('value') : t('rawPayload')}</th>
                          <th>{t('category')}</th>
                          <th>TOPIC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminVisibleFeed.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="muted">
                              {t('noEvents')}
                            </td>
                          </tr>
                        ) : (
                          adminVisibleFeed.map((eventItem) => (
                              <tr
                                key={eventItem.id}
                                className={`feed-row-clickable ${recentFeedEventIds[eventItem.id] ? 'feed-row-new' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setSelectedEvent(eventItem);
                                  setEventDetailsViewMode('rendered');
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setSelectedEvent(eventItem);
                                    setEventDetailsViewMode('rendered');
                                  }
                                }}
                              >
                                <td>{formatTs(eventItem.ingestTs)}</td>
                                <td>{eventItem.deviceId}</td>
                                <td>{eventItem.eventType}</td>
                                <td className="mono raw-cell">
                                  {feedViewMode === 'rendered'
                                    ? (adminFeedValues.get(eventItem.id) ?? '')
                                    : eventItem.payloadJson}
                                </td>
                                <td>{eventItem.category}</td>
                                <td className="mono">{eventItem.topic}</td>
                              </tr>
                            ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>

      {selectedEvent ? (
        <div className="event-modal-backdrop" onClick={() => setSelectedEvent(null)}>
          <div className="event-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('eventDetails')}</h2>
              <div className="event-modal-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() =>
                    setEventDetailsViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
                  }
                >
                  {eventDetailsViewMode === 'rendered'
                    ? t('switchToRawEvent')
                    : t('switchToRenderedEvent')}
                </button>
                <button className="button" type="button" onClick={() => setSelectedEvent(null)}>
                  {t('close')}
                </button>
              </div>
            </div>

            {eventDetailsViewMode === 'rendered' ? (
              <>
                <div className="event-details-grid">
                  {selectedEventFields.map(([key, value]) => (
                    <div key={key} className="event-details-row">
                      <div className="event-details-key">{key}</div>
                      <div className="event-details-value mono">{value}</div>
                    </div>
                  ))}
                </div>
                <h3 className="event-modal-subtitle">{t('payload')}</h3>
                <pre className="event-modal-pre">
                  {JSON.stringify(
                    tryParsePayload(selectedEvent.payloadJson) ?? selectedEvent.payloadJson,
                    null,
                    2
                  )}
                </pre>
              </>
            ) : (
              <pre className="event-modal-pre event-modal-pre-raw">{selectedEventRawJson}</pre>
            )}
          </div>
        </div>
      ) : null}

      {counterResetDeviceId ? (
        <div className="event-modal-backdrop" onClick={closeCounterResetModal}>
          <div className="event-modal counter-reset-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('counterResetDialogTitle')}</h2>
              <button className="button secondary" type="button" onClick={closeCounterResetModal}>
                {t('close')}
              </button>
            </div>
            <p>
              {t('counterResetDialogBody')} <strong>{counterResetDeviceId}</strong>?
            </p>
            <div className="event-modal-actions">
              <button
                className="button danger"
                type="button"
                onClick={confirmCounterReset}
                disabled={counterResetBusy}
              >
                {t('commandCounterReset')}
              </button>
              <button className="button secondary" type="button" onClick={closeCounterResetModal}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pinEditorDeviceId ? (
        <div className="event-modal-backdrop" onClick={closePinEditor}>
          <div className="event-modal pin-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>
                {t('pinSettingsForDevice')}: {pinEditorDeviceId}
              </h2>
              <button className="button secondary" type="button" onClick={closePinEditor}>
                {t('close')}
              </button>
            </div>

            <label className="form-grid">
              <span>{t('pin')}</span>
              <input
                className="input mono"
                value={pinEditorValue}
                onChange={(event) => setPinEditorValue(event.target.value)}
                disabled={pinEditorLoading || busyKey === `pin-save-${pinEditorDeviceId}`}
              />
            </label>

            {pinEditorLoading ? <p className="muted">{t('loading')}</p> : null}

            <div className="event-modal-actions">
              <button
                className="button"
                type="button"
                onClick={savePinEditor}
                disabled={pinEditorLoading || busyKey === `pin-save-${pinEditorDeviceId}`}
              >
                {t('savePin')}
              </button>
              <button className="button secondary" type="button" onClick={closePinEditor}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
