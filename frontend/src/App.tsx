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

interface DeviceTelemetrySnapshot {
  temperatureC: number | null;
  humidityPct: number | null;
  brightness: number | null;
  buttonRedPressed: boolean | null;
  buttonBlackPressed: boolean | null;
  ledGreenOn: boolean | null;
  ledOrangeOn: boolean | null;
  uptimeMs: number | null;
  uptimeIngestTs: TimestampValue;
}

type MetricIconKind = 'temperature' | 'humidity' | 'brightness' | 'buttons' | 'leds';

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
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4.4" y="8.2" width="6.3" height="7.6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.3" y="8.2" width="6.3" height="7.6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
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

function prependBounded(items: CanonicalEvent[], item: CanonicalEvent, maxSize: number): CanonicalEvent[] {
  const next = [item, ...items].sort(compareByNewestIngestTs);
  if (next.length <= maxSize) {
    return next;
  }
  return next.slice(0, maxSize);
}

function clampFeed(items: CanonicalEvent[]): CanonicalEvent[] {
  const sorted = [...items].sort(compareByNewestIngestTs);
  if (sorted.length <= MAX_FEED_EVENTS) {
    return sorted;
  }
  return sorted.slice(0, MAX_FEED_EVENTS);
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
  try {
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
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

  const counter =
    firstNumber(parsedPayload, [['count'], ['total'], ['counter'], ['value']]) ??
    findNumberByKeys(parsedPayload, ['count', 'total', 'counter']);

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
  const direct = toNumber(node);
  if (direct !== null) {
    return direct;
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
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (keys.includes(key)) {
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

  const studentPauseRef = useRef(studentFeedPaused);
  const adminPauseRef = useRef(adminFeedPaused);

  const reportBackgroundError = useCallback((context: string, error: unknown) => {
    const message = toErrorMessage(error);
    console.warn(`[EPL UI background] ${context}: ${message}`);
  }, []);

  useEffect(() => {
    studentPauseRef.current = studentFeedPaused;
  }, [studentFeedPaused]);

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
  }, []);

  const clearAuth = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    setToken(null);
    setSession(null);
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
    setAdminSettingsDraftMode(settings.defaultLanguageMode);
    setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
    setDefaultLanguageMode(settings.defaultLanguageMode);
    setTimeFormat24h(settings.timeFormat24h);
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
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        let nextFeed = previous.feed;
        for (const queuedEvent of queued) {
          nextFeed = prependBounded(nextFeed, queuedEvent, MAX_FEED_EVENTS);
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
      studentFeedFlushTimer = window.setTimeout(flushStudentFeedQueue, 80);
    };

    const flushAdminFeedQueue = () => {
      adminFeedFlushTimer = null;
      if (adminFeedQueue.length === 0) {
        return;
      }
      const queued = adminFeedQueue;
      adminFeedQueue = [];
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        let nextFeed = previous.events;
        for (const queuedEvent of queued) {
          nextFeed = prependBounded(nextFeed, queuedEvent, MAX_FEED_EVENTS);
        }
        return {
          ...previous,
          events: nextFeed
        };
      });
    };

    const queueAdminFeedEvent = (eventPayload: CanonicalEvent) => {
      adminFeedQueue.push(eventPayload);
      if (adminFeedFlushTimer !== null) {
        return;
      }
      adminFeedFlushTimer = window.setTimeout(flushAdminFeedQueue, 80);
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
        for (const queuedDevice of queuedStatuses) {
          nextDevices.set(queuedDevice.deviceId, queuedDevice);
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
      adminDeviceStatusFlushTimer = window.setTimeout(flushAdminDeviceStatusQueue, 120);
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
  }, [refreshAdminGroups, refreshAdminTasks, reportBackgroundError, session, token]);

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
  ) => {
    if (!token) {
      return;
    }

    setBusyKey(`admin-command-${deviceId}-${command}-${String(on)}`);
    setErrorMessage(null);

    try {
      await api.adminDeviceCommand(token, deviceId, command, on);
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
    if (!adminData) {
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
  }, [adminCategoryFilter, adminData, adminDeviceFilter, adminIncludeInternal, adminTopicFilter]);

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

  const adminDeviceSnapshots = useMemo<Record<string, DeviceTelemetrySnapshot>>(() => {
    if (!adminData) {
      return {};
    }
    return buildDeviceTelemetrySnapshots(adminData.events);
  }, [adminData]);

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

  const formatTs = useCallback(
    (value: TimestampValue): string => {
      return formatTimestamp(value, language, timeFormat24h);
    },
    [language, timeFormat24h]
  );
  const nowEpochMs = Date.now();

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
        payloadParsed: payloadForRaw
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
          <div className={`status-pill ${wsConnection}`}>{wsLabel}</div>
          {roleLabel ? <div className="status-pill role">{roleLabel}</div> : null}

          <div className="language-controls">
            <span>{t('language')}</span>
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

          {session ? (
            <button
              className="button danger"
              type="button"
              onClick={handleLogout}
              disabled={busyKey === 'logout'}
            >
              {t('logout')}
            </button>
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

            <section className="panel panel-animate">
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
                  <li key={`${presence.username}-${presence.lastSeen}`}>
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
                            className="feed-row-clickable"
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
          <div className="dashboard-grid">
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

            <section className="panel panel-animate">
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
                        <li key={`${presence.username}-${presence.lastSeen}`}>
                          {presence.displayName} - {formatTs(presence.lastSeen)}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

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
                  const redButton =
                    snapshot?.buttonRedPressed === null
                      ? t('stateUnknown')
                      : snapshot.buttonRedPressed
                        ? t('statePressed')
                        : t('stateReleased');
                  const blackButton =
                    snapshot?.buttonBlackPressed === null
                      ? t('stateUnknown')
                      : snapshot.buttonBlackPressed
                        ? t('statePressed')
                        : t('stateReleased');
                  const greenLed =
                    snapshot?.ledGreenOn === null
                      ? t('stateUnknown')
                      : snapshot.ledGreenOn
                        ? t('stateOn')
                        : t('stateOff');
                  const orangeLed =
                    snapshot?.ledOrangeOn === null
                      ? t('stateUnknown')
                      : snapshot.ledOrangeOn
                        ? t('stateOn')
                        : t('stateOff');
                  const temperature =
                    snapshot?.temperatureC === null ? '-' : `${snapshot.temperatureC.toFixed(1)} °C`;
                  const humidity =
                    snapshot?.humidityPct === null ? '-' : `${Math.round(snapshot.humidityPct)} %`;
                  const brightness =
                    snapshot?.brightness === null ? '-' : formatBrightnessMeasurement(snapshot.brightness);
                  const bars = rssiBars(device.rssi);
                  const rssiHint = device.rssi === null ? t('rssiNoData') : `${device.rssi} dBm`;

                  return (
                    <article className="device-card" key={device.deviceId}>
                      <header>
                        <strong>{device.deviceId}</strong>
                        <span className={`chip ${device.online ? 'ok' : 'warn'}`}>
                          {statusLabel(device.online, language)}
                        </span>
                      </header>

                      <p>
                        {t('lastEvent')}: {formatTs(device.lastSeen)}
                      </p>
                      <p>
                        {t('uptime')}: {uptimeNow === null ? '-' : formatRoundedDuration(uptimeNow, language)}
                      </p>
                      <div className="rssi-row">
                        <span>{t('rssi')}:</span>
                        <div
                          className={`rssi-bars ${rssiClassName(device.rssi)}`}
                          title={rssiHint}
                          aria-label={rssiHint}
                        >
                          <span className={`bar ${bars >= 1 ? 'active' : ''}`} />
                          <span className={`bar ${bars >= 2 ? 'active' : ''}`} />
                          <span className={`bar ${bars >= 3 ? 'active' : ''}`} />
                          <span className={`bar ${bars >= 4 ? 'active' : ''}`} />
                        </div>
                      </div>
                      <div className="device-metrics-grid">
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="temperature" />
                          </span>
                          <span className="metric-text">{t('metricTemp')}: {temperature}</span>
                        </div>
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="humidity" />
                          </span>
                          <span className="metric-text">{t('metricHumidity')}: {humidity}</span>
                        </div>
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="brightness" />
                          </span>
                          <span className="metric-text">{t('metricBrightness')}: {brightness}</span>
                        </div>
                        <div className="device-metric">
                          <span className="metric-icon">
                            <MetricIcon kind="buttons" />
                          </span>
                          <span className="metric-text">
                            {t('metricButtons')}: R {redButton}, B {blackButton}
                          </span>
                        </div>
                        <div className="device-metric full">
                          <span className="metric-icon">
                            <MetricIcon kind="leds" />
                          </span>
                          <span className="metric-text">{t('metricLeds')}: G {greenLed}, O {orangeLed}</span>
                        </div>
                      </div>

                      <div className="button-grid">
                        <button
                          className="button"
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_GREEN', true)}
                          disabled={busyKey === `admin-command-${device.deviceId}-LED_GREEN-true`}
                        >
                          {t('commandGreenOn')}
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_GREEN', false)}
                          disabled={busyKey === `admin-command-${device.deviceId}-LED_GREEN-false`}
                        >
                          {t('commandGreenOff')}
                        </button>
                        <button
                          className="button"
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_ORANGE', true)}
                          disabled={busyKey === `admin-command-${device.deviceId}-LED_ORANGE-true`}
                        >
                          {t('commandOrangeOn')}
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_ORANGE', false)}
                          disabled={busyKey === `admin-command-${device.deviceId}-LED_ORANGE-false`}
                        >
                          {t('commandOrangeOff')}
                        </button>
                        <button
                          className="button ghost"
                          type="button"
                          onClick={() => sendAdminDeviceCommand(device.deviceId, 'COUNTER_RESET')}
                          disabled={busyKey === `admin-command-${device.deviceId}-COUNTER_RESET-undefined`}
                        >
                          {t('commandCounterReset')}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

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
                            className="feed-row-clickable"
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
              <pre className="event-modal-pre">{selectedEventRawJson}</pre>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
