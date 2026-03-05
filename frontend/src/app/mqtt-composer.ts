import type { MqttComposerTargetType, MqttComposerTemplate, MqttEventDraft } from './shared-types';

export interface MqttMessageDraft {
  topic: string;
  payload: string;
}

function isDeviceTopicPrefix(segment: string): boolean {
  const normalized = segment.trim().toLowerCase();
  return /^epld\d+$/.test(normalized) || /^eplvd\d+$/.test(normalized);
}

const PHYSICAL_TEMPLATES: MqttComposerTemplate[] = [
  'button',
  'counter',
  'led',
  'temperature',
  'humidity',
  'ldr',
  'heartbeat',
  'wifi',
  'custom'
];

const VIRTUAL_TEMPLATES: MqttComposerTemplate[] = [
  'button',
  'counter',
  'led',
  'temperature',
  'humidity',
  'ldr',
  'custom'
];

const CUSTOM_TEMPLATES: MqttComposerTemplate[] = ['custom'];

function clampBrightnessVoltage(value: number): number {
  return Math.min(3.3, Math.max(0, value));
}

function toJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function topicPrefixForPhysical(deviceId: string): string {
  return deviceId;
}

function firstOrBlank(values: string[]): string {
  return values[0] ?? '';
}

export function normalizeLegacyLedCommandTopic(topic: string): string {
  const trimmed = topic.trim();
  if (!trimmed) {
    return topic;
  }
  const hadLeadingSlash = trimmed.startsWith('/');
  let normalized = trimmed.replace(/^\/+/, '');
  if (normalized.toLowerCase().startsWith('epld/')) {
    const remainder = normalized.substring('epld/'.length);
    if (remainder.toLowerCase().startsWith('epld') || remainder.toLowerCase().startsWith('eplvd')) {
      normalized = remainder;
    }
  }

  const legacyDeviceMatch = normalized.match(/^([^/]+)\/command\/switch:(0|1)$/i);
  if (legacyDeviceMatch) {
    const deviceId = legacyDeviceMatch[1].trim().toLowerCase();
    const ledColor = legacyDeviceMatch[2] === '1' ? 'orange' : 'green';
    const rewritten = `${deviceId}/command/led/${ledColor}`;
    return hadLeadingSlash ? `/${rewritten}` : rewritten;
  }
  const legacyBroadcastMatch = normalized.match(/^command\/switch:(0|1)$/i);
  if (!legacyBroadcastMatch) {
    return topic;
  }
  const ledColor = legacyBroadcastMatch[1] === '1' ? 'orange' : 'green';
  const rewritten = `command/led/${ledColor}`;
  return hadLeadingSlash ? `/${rewritten}` : rewritten;
}

export function topicSuffixWithoutDevicePrefix(topic: string): string {
  const trimmed = topic.trim().replace(/^\/+/, '');
  if (!trimmed) {
    return '';
  }
  const segments = trimmed.split('/');
  if (segments.length > 0 && isDeviceTopicPrefix(segments[0])) {
    return segments.slice(1).join('/');
  }
  return trimmed;
}

export function topicSuffixForLockedPrefix(deviceId: string, topic: string): string {
  const normalizedDeviceId = deviceId.trim().toLowerCase();
  const trimmedTopic = topic.trim().replace(/^\/+/, '');
  if (!trimmedTopic) {
    return '';
  }
  if (!normalizedDeviceId) {
    return topicSuffixWithoutDevicePrefix(trimmedTopic);
  }

  if (trimmedTopic.toLowerCase() === normalizedDeviceId) {
    return '';
  }
  const withSlashPrefix = `${normalizedDeviceId}/`;
  if (trimmedTopic.toLowerCase().startsWith(withSlashPrefix)) {
    return trimmedTopic.slice(withSlashPrefix.length);
  }
  return topicSuffixWithoutDevicePrefix(trimmedTopic);
}

export function lockTopicToDevicePrefix(deviceId: string, topicOrSuffix: string): string {
  const normalizedDeviceId = deviceId.trim().toLowerCase();
  const value = topicOrSuffix.trim();
  if (!normalizedDeviceId) {
    return value;
  }
  const suffix = topicSuffixForLockedPrefix(normalizedDeviceId, value);
  return suffix ? `${normalizedDeviceId}/${suffix}` : normalizedDeviceId;
}

function topicForTemplate(draft: MqttEventDraft, deviceId: string): string {
  if (draft.targetType === 'custom') {
    return '';
  }

  if (draft.targetType === 'virtual') {
    if (!deviceId) {
      return '';
    }
    if (draft.template === 'custom') {
      return '';
    }
    return `${deviceId}/events/rpc`;
  }

  if (!deviceId) {
    return '';
  }

  const prefix = topicPrefixForPhysical(deviceId);
  switch (draft.template) {
    case 'button':
      return `${prefix}/event/button`;
    case 'counter':
      return `${prefix}/event/counter`;
    case 'led':
      return `${prefix}/command/led/${draft.ledColor === 'orange' ? 'orange' : 'green'}`;
    case 'temperature':
      return `${prefix}/event/sensor/temperature`;
    case 'humidity':
      return `${prefix}/event/sensor/humidity`;
    case 'dht22':
      return `${prefix}/event/sensor/dht22`;
    case 'ldr':
      return `${prefix}/event/sensor/ldr`;
    case 'heartbeat':
      return `${prefix}/status/heartbeat`;
    case 'wifi':
      return `${prefix}/status/wifi`;
    case 'custom':
      return '';
    default:
      return '';
  }
}

function virtualPayload(draft: MqttEventDraft, nowTsSeconds: number): string {
  const base = {
    deviceId: draft.deviceId,
    method: 'NotifyStatus'
  };

  if (draft.template === 'button') {
    const channel = draft.buttonColor === 'red' ? 'input:0' : 'input:1';
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        [channel]: { state: draft.buttonPressed }
      }
    });
  }

  if (draft.template === 'counter') {
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        'input:2': { state: true },
        'counter:0': { value: Math.max(0, Math.round(draft.counterValue)) }
      }
    });
  }

  if (draft.template === 'led') {
    const channel = draft.ledColor === 'green' ? 'switch:0' : 'switch:1';
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        [channel]: { output: draft.ledOn }
      }
    });
  }

  if (draft.template === 'temperature') {
    const temperature = Number(draft.temperatureC.toFixed(1));
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        'temperature:100': { tC: temperature, value: temperature }
      }
    });
  }

  if (draft.template === 'humidity') {
    const humidity = Number(draft.humidityPct.toFixed(1));
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        'humidity:100': { rh: humidity, value: humidity }
      }
    });
  }

  if (draft.template === 'dht22') {
    const temperature = Number(draft.temperatureC.toFixed(1));
    const humidity = Number(draft.humidityPct.toFixed(1));
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        'temperature:100': { tC: temperature, value: temperature },
        'humidity:100': { rh: humidity, value: humidity }
      }
    });
  }

  if (draft.template === 'ldr') {
    const voltage = Number(clampBrightnessVoltage(draft.brightnessV).toFixed(2));
    return toJson({
      ...base,
      params: {
        ts: nowTsSeconds,
        'voltmeter:100': { voltage, value: voltage }
      }
    });
  }

  return draft.customPayload;
}

function physicalPayload(draft: MqttEventDraft, nowTsSeconds: number): string {
  if (draft.template === 'button') {
    return toJson({
      button: draft.buttonColor,
      action: draft.buttonPressed ? 'press' : 'release',
      pressed: draft.buttonPressed,
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'counter') {
    return toJson({
      counter: Math.max(0, Math.round(draft.counterValue)),
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'led') {
    return draft.ledOn ? 'on' : 'off';
  }

  if (draft.template === 'temperature') {
    return toJson({
      temperature: Number(draft.temperatureC.toFixed(1)),
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'humidity') {
    return toJson({
      humidity: Number(draft.humidityPct.toFixed(1)),
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'dht22') {
    return toJson({
      temperature: Number(draft.temperatureC.toFixed(1)),
      humidity: Number(draft.humidityPct.toFixed(1)),
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'ldr') {
    return toJson({
      voltage: Number(clampBrightnessVoltage(draft.brightnessV).toFixed(2)),
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'heartbeat') {
    return toJson({
      online: true,
      sys: {
        uptime: Math.max(0, Math.round(draft.uptimeSec))
      },
      ts: nowTsSeconds
    });
  }

  if (draft.template === 'wifi') {
    const rssi = Math.round(draft.rssi);
    return toJson({
      rssi,
      params: {
        mqtt: {
          rssi
        }
      },
      ts: nowTsSeconds
    });
  }

  return draft.customPayload;
}

export function supportedMqttTemplates(targetType: MqttComposerTargetType): MqttComposerTemplate[] {
  if (targetType === 'physical') {
    return PHYSICAL_TEMPLATES;
  }
  if (targetType === 'virtual') {
    return VIRTUAL_TEMPLATES;
  }
  return CUSTOM_TEMPLATES;
}

export function normalizeMqttTemplateForTarget(
  targetType: MqttComposerTargetType,
  template: MqttComposerTemplate
): MqttComposerTemplate {
  if (template === 'dht22') {
    template = 'temperature';
  }
  const allowed = supportedMqttTemplates(targetType);
  if (allowed.includes(template)) {
    return template;
  }
  return allowed[0] ?? 'custom';
}

export function resolveMqttDeviceId(
  targetType: MqttComposerTargetType,
  currentDeviceId: string,
  physicalDeviceIds: string[],
  virtualDeviceIds: string[]
): string {
  if (targetType === 'physical') {
    if (physicalDeviceIds.includes(currentDeviceId)) {
      return currentDeviceId;
    }
    return firstOrBlank(physicalDeviceIds);
  }
  if (targetType === 'virtual') {
    if (virtualDeviceIds.includes(currentDeviceId)) {
      return currentDeviceId;
    }
    return firstOrBlank(virtualDeviceIds);
  }
  return currentDeviceId;
}

export function createMqttEventDraft(): MqttEventDraft {
  return {
    targetType: 'physical',
    template: 'button',
    deviceId: '',
    useIncomingPayload: true,
    buttonColor: 'red',
    buttonPressed: true,
    ledColor: 'green',
    ledOn: true,
    ledBlinkEnabled: false,
    ledBlinkMs: 200,
    counterValue: 0,
    temperatureC: 23.0,
    humidityPct: 45.0,
    brightnessV: 1.5,
    uptimeSec: 300,
    rssi: -62,
    customTopic: '',
    customPayload: '{\n  "value": true\n}',
    rawTopic: '',
    rawPayload: '{\n  "value": true\n}',
    qos: 1,
    retained: false
  };
}

export function buildGuidedMqttMessage(
  draft: MqttEventDraft,
  nowEpochMillis: number = Date.now()
): MqttMessageDraft {
  const normalizedDeviceId = draft.deviceId.trim();
  const nowTsSeconds = Number((nowEpochMillis / 1000).toFixed(3));

  if (draft.targetType === 'custom' || draft.template === 'custom') {
    return {
      topic: draft.customTopic.trim(),
      payload: draft.customPayload
    };
  }

  if (draft.targetType === 'virtual') {
    const normalizedDraft = { ...draft, deviceId: normalizedDeviceId };
    return {
      topic: topicForTemplate(normalizedDraft, normalizedDeviceId),
      payload: virtualPayload(normalizedDraft, nowTsSeconds)
    };
  }

  const normalizedDraft = { ...draft, deviceId: normalizedDeviceId };
  return {
    topic: topicForTemplate(normalizedDraft, normalizedDeviceId),
    payload: physicalPayload(normalizedDraft, nowTsSeconds)
  };
}
