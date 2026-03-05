import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent
} from 'react';
import type { I18nKey } from '../../i18n';
import {
  buildGuidedMqttMessage,
  createMqttEventDraft,
  normalizeMqttTemplateForTarget,
  resolveMqttDeviceId
} from '../../app/mqtt-composer';
import { displayPipelineBlockType } from '../../app/pipeline-block-labels';
import type {
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft
} from '../../app/shared-types';
import { CloseIcon, InfoIcon } from '../../app/shared-icons';
import { AdminMqttEventModal } from '../admin/AdminMqttEventModal';
import { ModalPortal } from '../layout/ModalPortal';
import type {
  PipelineBlockObservability,
  PipelineLogModeStatus,
  PipelineLogReplayResponse,
  PipelineProcessingSection,
  PipelineSampleEvent,
  PipelineSinkNode,
  PipelineView,
  TimestampValue
} from '../../types';

const DND_BLOCK_TYPE = 'application/x-epl-pipeline-block';
const DND_SOURCE_SLOT = 'application/x-epl-source-slot';
const BROADCAST_DEVICE_ID = 'BROADCAST';

interface PipelineBuilderSectionProps {
  t: (key: I18nKey) => string;
  title: string;
  view: PipelineView | null;
  contextNotice?: string | null;
  contextActionLabel?: string;
  onContextAction?: () => void;
  draftProcessing: PipelineProcessingSection | null;
  onChangeSlotBlock: (slotIndex: number, blockType: string) => void;
  onSwapSlots?: (sourceSlotIndex: number, targetSlotIndex: number) => void;
  onChangeSlotConfig?: (slotIndex: number, key: string, value: unknown) => void;
  onInputModeChange?: (nextMode: string) => void;
  onAddSink?: (sinkType: 'SEND_EVENT' | 'VIRTUAL_SIGNAL' | 'SHOW_PAYLOAD') => void;
  onRemoveSink?: (sinkId: string) => void;
  onConfigureSendEventSink?: (sinkId: string, config: Record<string, unknown>) => void;
  sendEventTargetTypeOptions?: MqttComposerTargetType[];
  allowBroadcastSinkDeviceOption?: boolean;
  onResetSinkCounter?: (sinkId: string) => void;
  sinkRuntimeBusy?: boolean;
  physicalDeviceIds?: string[];
  virtualDeviceIds?: string[];
  lecturerDeviceAvailable?: boolean;
  logModeStatus?: PipelineLogModeStatus | null;
  logModeStatusBusy?: boolean;
  onRefreshLogModeStatus?: () => void;
  logReplayFromOffset?: string;
  onLogReplayFromOffsetChange?: (next: string) => void;
  logReplayMaxRecords?: number;
  onLogReplayMaxRecordsChange?: (next: number) => void;
  onLogReplay?: () => void;
  logReplayBusy?: boolean;
  logReplayResult?: PipelineLogReplayResponse | null;
  onResetState?: () => void;
  onRestartStateLost?: () => void;
  onRestartStateRetained?: () => void;
  stateControlBusy?: boolean;
  hideRestartControlsInSimpleMode?: boolean;
  showViewModeToggle?: boolean;
  onSimplifiedViewChange?: (next: boolean) => void;
  forceSinkEditable?: boolean;
  simplifiedView?: boolean;
  formatTs: (value: TimestampValue) => string;
}

function featureBadgeLabelKey(badge: string): I18nKey {
  switch (badge) {
    case 'retention':
      return 'pipelineModeBadgeRetention';
    case 'replay':
      return 'pipelineModeBadgeReplay';
    case 'offsets':
      return 'pipelineModeBadgeOffsets';
    case 'consumer_groups':
      return 'pipelineModeBadgeConsumerGroups';
    case 'no_offset_replay':
      return 'pipelineModeBadgeNoReplay';
    case 'realtime_pubsub':
      return 'pipelineModeBadgeRealtime';
    default:
      return 'pipelineModeBadgeRealtime';
  }
}

function blockSupportsDeviceScope(blockType: string): boolean {
  const normalized = blockType.trim().toUpperCase();
  return normalized.includes('DEVICE');
}

function normalizeSlotDeviceScope(raw: unknown): string {
  if (typeof raw !== 'string') {
    return 'OWN_DEVICE';
  }
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'SINGLE_DEVICE') {
    return 'LECTURER_DEVICE';
  }
  if (normalized === 'GROUP_DEVICES') {
    return 'OWN_DEVICE';
  }
  if (normalized === 'ALL_DEVICES') {
    return 'ALL_DEVICES';
  }
  if (normalized === 'ADMIN_DEVICE') {
    return 'ADMIN_DEVICE';
  }
  if (normalized === 'OWN_AND_ADMIN_DEVICE') {
    return 'OWN_AND_ADMIN_DEVICE';
  }
  if (normalized === 'LECTURER_DEVICE' || normalized === 'OWN_DEVICE') {
    return normalized;
  }
  return 'OWN_DEVICE';
}

function slotDeviceScopeLabel(t: (key: I18nKey) => string, raw: unknown): string {
  const normalized = normalizeSlotDeviceScope(raw);
  if (normalized === 'LECTURER_DEVICE') {
    return t('pipelineDeviceScopeLecturer');
  }
  if (normalized === 'ADMIN_DEVICE') {
    return t('pipelineDeviceScopeLecturer');
  }
  if (normalized === 'OWN_AND_ADMIN_DEVICE') {
    return t('pipelineDeviceScopeOwnLecturer');
  }
  if (normalized === 'ALL_DEVICES') {
    return t('pipelineDeviceScopeAll');
  }
  return t('pipelineDeviceScopeOwn');
}

function isTaskScopeLockedFilterSlot(slot: PipelineProcessingSection['slots'][number]): boolean {
  if (slot.index !== 0) {
    return false;
  }
  if ((slot.blockType ?? '').trim().toUpperCase() !== 'FILTER_DEVICE') {
    return false;
  }
  const config = slot.config ?? {};
  const locked = config.taskScopeLocked;
  if (locked === true) {
    return true;
  }
  const origin = config.taskScopeOrigin;
  return typeof origin === 'string' && origin.trim().toLowerCase() === 'task_device_scope';
}

function buildDisplaySlots(processing: PipelineProcessingSection): PipelineProcessingSection['slots'] {
  const byIndex = new Map<number, PipelineProcessingSection['slots'][number]>();
  for (const slot of processing.slots) {
    if (slot.index < 0) {
      continue;
    }
    byIndex.set(slot.index, slot);
  }

  let highestConfiguredIndex = -1;
  for (const slot of byIndex.values()) {
    const blockType = (slot.blockType ?? 'NONE').trim().toUpperCase();
    const hasConfig = slot.config != null && Object.keys(slot.config).length > 0;
    if ((blockType !== 'NONE' || hasConfig) && slot.index > highestConfiguredIndex) {
      highestConfiguredIndex = slot.index;
    }
  }

  const visibleSlotCount = Math.max(1, highestConfiguredIndex + 2);
  return Array.from({ length: visibleSlotCount }, (_, slotIndex) => {
    const slot = byIndex.get(slotIndex);
    return {
      index: slotIndex,
      blockType: slot?.blockType ?? 'NONE',
      config: slot?.config ?? {}
    };
  });
}

type PipelineSinkType = 'EVENT_FEED' | 'SEND_EVENT' | 'VIRTUAL_SIGNAL' | 'SHOW_PAYLOAD';

type ModalTab = 'guided' | 'raw' | 'led';

function normalizeSinkType(raw: string): PipelineSinkType {
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'SEND_EVENT' || normalized === 'DEVICE_CONTROL') {
    return 'SEND_EVENT';
  }
  if (normalized === 'SHOW_PAYLOAD' || normalized === 'LAST_PAYLOAD') {
    return 'SHOW_PAYLOAD';
  }
  if (normalized === 'VIRTUAL_SIGNAL') {
    return 'VIRTUAL_SIGNAL';
  }
  return 'EVENT_FEED';
}

function normalizeSinkNodes(nodes: PipelineSinkNode[] | null | undefined): PipelineSinkNode[] {
  const result: PipelineSinkNode[] = [
    {
      id: 'event-feed',
      type: 'EVENT_FEED',
      config: {}
    }
  ];
  const usedIds = new Set<string>(['event-feed', 'virtual-signal', 'show-payload', 'last-payload']);
  let sendIndex = 1;
  let includeShowPayload = false;
  for (const node of nodes ?? []) {
    if (!node || typeof node.type !== 'string') {
      continue;
    }
    const type = normalizeSinkType(node.type);
    if (type === 'SHOW_PAYLOAD') {
      includeShowPayload = true;
      continue;
    }
    if (type !== 'SEND_EVENT') {
      continue;
    }
    let sinkId = node.id?.trim() || '';
    if (!sinkId || usedIds.has(sinkId) || sinkId === 'event-feed' || sinkId === 'virtual-signal') {
      sinkId = sendIndex === 1 ? 'send-event' : `send-event-${sendIndex}`;
      while (usedIds.has(sinkId)) {
        sendIndex += 1;
        sinkId = `send-event-${sendIndex}`;
      }
    }
    usedIds.add(sinkId);
    sendIndex += 1;
    result.push({
      id: sinkId,
      type: 'SEND_EVENT',
      config: node.config ?? {}
    });
  }
  if (includeShowPayload) {
    result.push({
      id: 'show-payload',
      type: 'SHOW_PAYLOAD',
      config: {}
    });
  }
  result.push({
    id: 'virtual-signal',
    type: 'VIRTUAL_SIGNAL',
    config: {}
  });
  return result;
}

function readSinkString(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key];
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
}

function readSinkQos(config: Record<string, unknown>): 0 | 1 | 2 {
  const value = config.qos;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded === 0 || rounded === 1 || rounded === 2) {
      return rounded;
    }
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (parsed === 0 || parsed === 1 || parsed === 2) {
      return parsed;
    }
  }
  return 1;
}

function readSinkRetained(config: Record<string, unknown>): boolean {
  const value = config.retained;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true';
  }
  return false;
}

function readSinkUseIncomingPayload(config: Record<string, unknown>): boolean {
  const directValue = config.useIncomingPayload;
  if (typeof directValue === 'boolean') {
    return directValue;
  }
  if (typeof directValue === 'number') {
    return directValue !== 0;
  }
  if (typeof directValue === 'string') {
    const normalized = directValue.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'incoming') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'custom') {
      return false;
    }
  }
  const payloadSource = String(config.payloadSource ?? '')
    .trim()
    .toUpperCase();
  if (payloadSource === 'CUSTOM') {
    return false;
  }
  if (payloadSource === 'INCOMING') {
    return true;
  }
  return true;
}

function readSinkLedBlinkEnabled(config: Record<string, unknown>): boolean {
  const value = config.ledBlinkEnabled;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function readSinkLedBlinkMs(config: Record<string, unknown>): number {
  const value = config.ledBlinkMs;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(50, Math.min(10000, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(50, Math.min(10000, parsed));
    }
  }
  return 200;
}

function parseLedSinkTopic(topic: string): { deviceId: string; ledColor: 'green' | 'orange' } | null {
  if (!topic.trim()) {
    return null;
  }
  let normalized = topic.trim().replace(/^\/+/, '');
  if (normalized.toLowerCase().startsWith('epld/')) {
    const remainder = normalized.substring('epld/'.length);
    if (remainder.toLowerCase().startsWith('epld') || remainder.toLowerCase().startsWith('eplvd')) {
      normalized = remainder;
    }
  }

  const explicit = normalized.match(/^([^/]+)\/command\/led\/(green|orange)$/i);
  if (explicit) {
    const rawDeviceId = explicit[1].trim();
    const normalizedDeviceId = rawDeviceId.toUpperCase() === 'DEVICE' || rawDeviceId.toUpperCase() === BROADCAST_DEVICE_ID
      ? BROADCAST_DEVICE_ID
      : rawDeviceId.toLowerCase();
    return {
      deviceId: normalizedDeviceId,
      ledColor: explicit[2].trim().toLowerCase() === 'orange' ? 'orange' : 'green'
    };
  }
  const broadcastExplicit = normalized.match(/^command\/led\/(green|orange)$/i);
  if (broadcastExplicit) {
    return {
      deviceId: BROADCAST_DEVICE_ID,
      ledColor: broadcastExplicit[1].trim().toLowerCase() === 'orange' ? 'orange' : 'green'
    };
  }

  const shelly = normalized.match(/^([^/]+)\/command\/switch:(0|1)$/i);
  if (shelly) {
    const rawDeviceId = shelly[1].trim();
    const normalizedDeviceId = rawDeviceId.toUpperCase() === 'DEVICE' || rawDeviceId.toUpperCase() === BROADCAST_DEVICE_ID
      ? BROADCAST_DEVICE_ID
      : rawDeviceId.toLowerCase();
    return {
      deviceId: normalizedDeviceId,
      ledColor: shelly[2] === '1' ? 'orange' : 'green'
    };
  }
  const broadcastShelly = normalized.match(/^command\/switch:(0|1)$/i);
  if (broadcastShelly) {
    return {
      deviceId: BROADCAST_DEVICE_ID,
      ledColor: broadcastShelly[1] === '1' ? 'orange' : 'green'
    };
  }

  return null;
}

function parseTopicDeviceId(topic: string): string | null {
  if (!topic.trim()) {
    return null;
  }
  let normalized = topic.trim().replace(/^\/+/, '');
  if (normalized.toLowerCase().startsWith('epld/')) {
    const remainder = normalized.substring('epld/'.length);
    if (remainder.toLowerCase().startsWith('epld') || remainder.toLowerCase().startsWith('eplvd')) {
      normalized = remainder;
    }
  }
  if (normalized.toLowerCase().startsWith('command/')) {
    return BROADCAST_DEVICE_ID;
  }
  const slashIndex = normalized.indexOf('/');
  const firstSegment = (slashIndex < 0 ? normalized : normalized.slice(0, slashIndex)).trim();
  if (!firstSegment) {
    return null;
  }
  const upper = firstSegment.toUpperCase();
  if (upper === 'DEVICE' || upper === BROADCAST_DEVICE_ID) {
    return BROADCAST_DEVICE_ID;
  }
  return firstSegment.toLowerCase();
}

function sinkDisplayNameKey(type: PipelineSinkType): I18nKey {
  if (type === 'SEND_EVENT') {
    return 'pipelineSinkSendEvent';
  }
  if (type === 'SHOW_PAYLOAD') {
    return 'pipelineSinkShowPayload';
  }
  if (type === 'VIRTUAL_SIGNAL') {
    return 'pipelineSinkVirtualSignal';
  }
  return 'pipelineSinkEventFeed';
}

function processingBlockDocBodyKey(blockType: string): I18nKey {
  const normalized = blockType.trim().toUpperCase();
  switch (normalized) {
    case 'FILTER_DEVICE':
      return 'pipelineDocBlockFilterDeviceBody';
    case 'FILTER_TOPIC':
      return 'pipelineDocBlockFilterTopicBody';
    case 'FILTER_PAYLOAD':
    case 'FILTER_VALUE':
      return 'pipelineDocBlockFilterPayloadBody';
    case 'CONDITIONAL_PAYLOAD':
      return 'pipelineDocBlockConditionalPayloadBody';
    case 'EXTRACT_VALUE':
      return 'pipelineDocBlockExtractValueBody';
    case 'TRANSFORM_PAYLOAD':
      return 'pipelineDocBlockTransformPayloadBody';
    case 'FILTER_RATE_LIMIT':
      return 'pipelineDocBlockFilterRateLimitBody';
    case 'DEDUP':
      return 'pipelineDocBlockDedupBody';
    case 'WINDOW_AGGREGATE':
      return 'pipelineDocBlockWindowAggregateBody';
    case 'MICRO_BATCH':
      return 'pipelineDocBlockMicroBatchBody';
    case 'NONE':
      return 'pipelineDocBlockNoneBody';
    default:
      return 'pipelineDocBlockUnknownBody';
  }
}

function sinkDocBodyKey(type: PipelineSinkType): I18nKey {
  if (type === 'SEND_EVENT') {
    return 'pipelineDocSinkSendEventBody';
  }
  if (type === 'SHOW_PAYLOAD') {
    return 'pipelineDocSinkShowPayloadBody';
  }
  if (type === 'VIRTUAL_SIGNAL') {
    return 'pipelineDocSinkVirtualSignalBody';
  }
  return 'pipelineDocSinkEventFeedBody';
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function diffTopLevelKeys(inputValue: unknown, outputValue: unknown): {
  added: string[];
  removed: string[];
  changed: string[];
} {
  const input =
    inputValue && typeof inputValue === 'object' && !Array.isArray(inputValue)
      ? (inputValue as Record<string, unknown>)
      : {};
  const output =
    outputValue && typeof outputValue === 'object' && !Array.isArray(outputValue)
      ? (outputValue as Record<string, unknown>)
      : {};

  const inputKeys = new Set(Object.keys(input));
  const outputKeys = new Set(Object.keys(output));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of outputKeys) {
    if (!inputKeys.has(key)) {
      added.push(key);
      continue;
    }
    if (JSON.stringify(input[key]) !== JSON.stringify(output[key])) {
      changed.push(key);
    }
  }
  for (const key of inputKeys) {
    if (!outputKeys.has(key)) {
      removed.push(key);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort()
  };
}

function selectBlockSample(
  selectedBySlot: Record<number, string>,
  block: PipelineBlockObservability,
  samplesOverride?: PipelineSampleEvent[]
): PipelineSampleEvent | null {
  const samples = samplesOverride ?? block.samples;
  if (samples.length === 0) {
    return null;
  }
  const selectedTrace = selectedBySlot[block.slotIndex];
  if (selectedTrace) {
    const matched = samples.find((sample) => sample.traceId === selectedTrace);
    if (matched) {
      return matched;
    }
  }
  return samples[samples.length - 1] ?? null;
}

function normalizeSampleInputEventType(sample: PipelineSampleEvent): string {
  const raw = sample.inputEventType ?? '';
  const atIndex = raw.indexOf('@');
  return (atIndex >= 0 ? raw.slice(0, atIndex) : raw).trim().toLowerCase();
}

function isInternalSample(sample: PipelineSampleEvent): boolean {
  if (sample.internal === true) {
    return true;
  }
  const inputEventType = normalizeSampleInputEventType(sample);
  const topic = (sample.topic ?? '').trim().toLowerCase();
  return inputEventType.startsWith('device.online')
    || inputEventType.startsWith('device.offline')
    || inputEventType.startsWith('status.system')
    || topic.endsWith('/online')
    || topic.endsWith('/offline')
    || topic.includes('/status/system');
}

function nonInternalMetricValue(value: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
}

type FilterTopicWizardMode = 'guided' | 'raw';
type FilterTopicTemplate =
  | 'ANY'
  | 'EVENT_ALL'
  | 'EVENT_BUTTON'
  | 'EVENT_BUTTON_RED'
  | 'EVENT_BUTTON_BLACK'
  | 'EVENT_COUNTER'
  | 'EVENT_SENSOR'
  | 'EVENT_SENSOR_LDR'
  | 'EVENT_SENSOR_TEMPERATURE'
  | 'EVENT_SENSOR_HUMIDITY'
  | 'STATUS_ALL'
  | 'STATUS_HEARTBEAT'
  | 'STATUS_WIFI'
  | 'ACK_ALL';

const FILTER_TOPIC_TEMPLATE_TO_FILTER: Record<FilterTopicTemplate, string> = {
  ANY: '#',
  EVENT_ALL: '+/event/#',
  EVENT_BUTTON: '+/event/button/#',
  EVENT_BUTTON_RED: '+/event/button/red',
  EVENT_BUTTON_BLACK: '+/event/button/black',
  EVENT_COUNTER: '+/event/counter',
  EVENT_SENSOR: '+/event/sensor/#',
  EVENT_SENSOR_LDR: '+/event/sensor/ldr',
  EVENT_SENSOR_TEMPERATURE: '+/event/sensor/temperature',
  EVENT_SENSOR_HUMIDITY: '+/event/sensor/humidity',
  STATUS_ALL: '+/status/#',
  STATUS_HEARTBEAT: '+/status/heartbeat',
  STATUS_WIFI: '+/status/wifi',
  ACK_ALL: '+/ack/#'
};

const FILTER_TOPIC_TEMPLATE_OPTIONS: Array<{ id: FilterTopicTemplate; labelKey: I18nKey }> = [
  { id: 'ANY', labelKey: 'pipelineFilterTopicTemplateAny' },
  { id: 'EVENT_ALL', labelKey: 'pipelineFilterTopicTemplateEventAll' },
  { id: 'EVENT_BUTTON', labelKey: 'pipelineFilterTopicTemplateEventButton' },
  { id: 'EVENT_BUTTON_RED', labelKey: 'pipelineFilterTopicTemplateEventButtonRed' },
  { id: 'EVENT_BUTTON_BLACK', labelKey: 'pipelineFilterTopicTemplateEventButtonBlack' },
  { id: 'EVENT_COUNTER', labelKey: 'pipelineFilterTopicTemplateEventCounter' },
  { id: 'EVENT_SENSOR', labelKey: 'pipelineFilterTopicTemplateEventSensor' },
  { id: 'EVENT_SENSOR_LDR', labelKey: 'pipelineFilterTopicTemplateEventSensorLdr' },
  { id: 'EVENT_SENSOR_TEMPERATURE', labelKey: 'pipelineFilterTopicTemplateEventSensorTemperature' },
  { id: 'EVENT_SENSOR_HUMIDITY', labelKey: 'pipelineFilterTopicTemplateEventSensorHumidity' },
  { id: 'STATUS_ALL', labelKey: 'pipelineFilterTopicTemplateStatusAll' },
  { id: 'STATUS_HEARTBEAT', labelKey: 'pipelineFilterTopicTemplateStatusHeartbeat' },
  { id: 'STATUS_WIFI', labelKey: 'pipelineFilterTopicTemplateStatusWifi' },
  { id: 'ACK_ALL', labelKey: 'pipelineFilterTopicTemplateAckAll' }
];

function extractTopicFilterFromSlotConfig(config: Record<string, unknown>): string {
  const candidates = ['topicFilter', 'topic', 'topicPattern', 'rawTopic'];
  for (const key of candidates) {
    const value = config[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function templateFromTopicFilter(filter: string): FilterTopicTemplate | null {
  const normalized = filter.trim();
  if (normalized === '+/event/button') {
    return 'EVENT_BUTTON';
  }
  // Backward compatibility: legacy DHT22 template now maps to temperature topic template.
  if (normalized === '+/event/sensor/dht22') {
    return 'EVENT_SENSOR_TEMPERATURE';
  }
  const matched = Object.entries(FILTER_TOPIC_TEMPLATE_TO_FILTER).find(([, value]) => value === normalized);
  return (matched?.[0] as FilterTopicTemplate | undefined) ?? null;
}

type PayloadFilterMode = 'NUMERIC' | 'STRING';
type PayloadFilterNumericOperator = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE';
type PayloadFilterStringOperator = 'EQ' | 'NEQ' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH';
type PayloadFilterOperator = PayloadFilterNumericOperator | PayloadFilterStringOperator;

type PayloadFilterConfigDraft = {
  mode: PayloadFilterMode;
  operator: PayloadFilterOperator;
  value: string;
  caseSensitive: boolean;
};

type ConditionalPayloadConfigDraft = PayloadFilterConfigDraft & {
  onMatchValue: string;
  onNoMatchValue: string;
};

const PAYLOAD_FILTER_NUMERIC_OPERATORS: Array<{ id: PayloadFilterNumericOperator; labelKey: I18nKey }> = [
  { id: 'EQ', labelKey: 'pipelineFilterPayloadOperatorEq' },
  { id: 'NEQ', labelKey: 'pipelineFilterPayloadOperatorNeq' },
  { id: 'GT', labelKey: 'pipelineFilterPayloadOperatorGt' },
  { id: 'GTE', labelKey: 'pipelineFilterPayloadOperatorGte' },
  { id: 'LT', labelKey: 'pipelineFilterPayloadOperatorLt' },
  { id: 'LTE', labelKey: 'pipelineFilterPayloadOperatorLte' }
];

const PAYLOAD_FILTER_STRING_OPERATORS: Array<{ id: PayloadFilterStringOperator; labelKey: I18nKey }> = [
  { id: 'EQ', labelKey: 'pipelineFilterPayloadOperatorEq' },
  { id: 'NEQ', labelKey: 'pipelineFilterPayloadOperatorNeq' },
  { id: 'CONTAINS', labelKey: 'pipelineFilterPayloadOperatorContains' },
  { id: 'STARTS_WITH', labelKey: 'pipelineFilterPayloadOperatorStartsWith' },
  { id: 'ENDS_WITH', labelKey: 'pipelineFilterPayloadOperatorEndsWith' }
];

function isPayloadFilterNumericOperator(value: string): value is PayloadFilterNumericOperator {
  return value === 'EQ' || value === 'NEQ' || value === 'GT' || value === 'GTE' || value === 'LT' || value === 'LTE';
}

function isPayloadFilterStringOperator(value: string): value is PayloadFilterStringOperator {
  return value === 'EQ'
    || value === 'NEQ'
    || value === 'CONTAINS'
    || value === 'STARTS_WITH'
    || value === 'ENDS_WITH';
}

function normalizePayloadFilterOperator(
  mode: PayloadFilterMode,
  rawOperator: unknown
): PayloadFilterOperator {
  const normalized = String(rawOperator ?? '').trim().toUpperCase();
  if (mode === 'NUMERIC') {
    return isPayloadFilterNumericOperator(normalized) ? normalized : 'EQ';
  }
  return isPayloadFilterStringOperator(normalized) ? normalized : 'EQ';
}

function parsePayloadFilterConfig(config: Record<string, unknown>): PayloadFilterConfigDraft {
  const modeRaw = String(config.payloadFilterMode ?? config.mode ?? 'STRING').trim().toUpperCase();
  const mode: PayloadFilterMode = modeRaw === 'NUMERIC' ? 'NUMERIC' : 'STRING';
  const operator = normalizePayloadFilterOperator(
    mode,
    config.payloadFilterOperator ?? config.operator ?? config.comparison
  );
  const valueRaw = config.payloadFilterValue ?? config.value ?? config.matchValue ?? config.expectedValue ?? '';
  const caseSensitiveRaw = config.payloadFilterCaseSensitive ?? config.caseSensitive ?? false;
  const caseSensitive = typeof caseSensitiveRaw === 'boolean'
    ? caseSensitiveRaw
    : String(caseSensitiveRaw).trim().toLowerCase() === 'true';
  return {
    mode,
    operator,
    value: typeof valueRaw === 'string' ? valueRaw : String(valueRaw),
    caseSensitive
  };
}

function parseConditionalPayloadConfig(config: Record<string, unknown>): ConditionalPayloadConfigDraft {
  const base = parsePayloadFilterConfig(config);
  const onMatchRaw = config.payloadOnMatch ?? config.payloadIfMatched ?? config.onMatchValue ?? config.trueValue ?? '';
  const onNoMatchRaw = config.payloadOnNoMatch ?? config.payloadIfNotMatched ?? config.onNoMatchValue ?? config.falseValue ?? '';
  return {
    ...base,
    onMatchValue: typeof onMatchRaw === 'string' ? onMatchRaw : String(onMatchRaw),
    onNoMatchValue: typeof onNoMatchRaw === 'string' ? onNoMatchRaw : String(onNoMatchRaw)
  };
}

function payloadFilterOperatorLabelKey(operator: PayloadFilterOperator): I18nKey {
  switch (operator) {
    case 'NEQ':
      return 'pipelineFilterPayloadOperatorNeq';
    case 'GT':
      return 'pipelineFilterPayloadOperatorGt';
    case 'GTE':
      return 'pipelineFilterPayloadOperatorGte';
    case 'LT':
      return 'pipelineFilterPayloadOperatorLt';
    case 'LTE':
      return 'pipelineFilterPayloadOperatorLte';
    case 'CONTAINS':
      return 'pipelineFilterPayloadOperatorContains';
    case 'STARTS_WITH':
      return 'pipelineFilterPayloadOperatorStartsWith';
    case 'ENDS_WITH':
      return 'pipelineFilterPayloadOperatorEndsWith';
    default:
      return 'pipelineFilterPayloadOperatorEq';
  }
}

type TransformPayloadMapping = {
  from: string;
  to: string;
};

function parseTransformPayloadMappings(config: Record<string, unknown>): TransformPayloadMapping[] {
  const raw = config.transformMappings ?? config.mappings;
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const from = typeof (entry as Record<string, unknown>).from === 'string'
          ? (entry as Record<string, unknown>).from
          : '';
        const to = typeof (entry as Record<string, unknown>).to === 'string'
          ? (entry as Record<string, unknown>).to
          : '';
        return { from, to };
      })
      .filter((entry): entry is TransformPayloadMapping => entry !== null);
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>).map(([from, to]) => ({
      from,
      to: to == null ? '' : String(to)
    }));
  }
  return [];
}

function normalizeTransformPayloadMappings(
  mappings: TransformPayloadMapping[]
): TransformPayloadMapping[] {
  return mappings
    .map((mapping) => ({
      from: mapping.from.trim(),
      to: mapping.to
    }))
    .filter((mapping) => mapping.from.length > 0);
}

type RateLimitConfigDraft = {
  maxEvents: number;
  windowMs: number;
};

type DedupStrategy = 'TIME_WINDOW' | 'EVENT_ID' | 'OFF';
type DedupKey = 'DEVICE_EVENT_PAYLOAD' | 'DEVICE_EVENT' | 'TOPIC_PAYLOAD' | 'PAYLOAD_ONLY' | 'EVENT_ID';

type DedupConfigDraft = {
  strategy: DedupStrategy;
  key: DedupKey;
  windowMs: number;
};

type WindowAggregation = 'COUNT' | 'COUNT_DISTINCT_DEVICES' | 'AVG' | 'MIN' | 'MAX';
type WindowTimeBasis = 'INGEST_TIME' | 'EVENT_TIME';
type WindowLatePolicy = 'IGNORE' | 'GRACE';

type WindowAggregateConfigDraft = {
  aggregation: WindowAggregation;
  windowMs: number;
  timeBasis: WindowTimeBasis;
  latePolicy: WindowLatePolicy;
  graceMs: number;
};

type MicroBatchConfigDraft = {
  batchSize: number;
  maxWaitMs: number;
};

function parseIntWithDefault(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseRateLimitConfig(config: Record<string, unknown>): RateLimitConfigDraft {
  return {
    maxEvents: clampNumber(
      parseIntWithDefault(config.rateLimitMaxEvents ?? config.maxEvents ?? config.eventsPerWindow, 20),
      1,
      10000
    ),
    windowMs: clampNumber(
      parseIntWithDefault(config.rateLimitWindowMs ?? config.windowMs, 1000),
      50,
      600000
    )
  };
}

function parseDedupConfig(config: Record<string, unknown>): DedupConfigDraft {
  const strategyRaw = String(config.dedupStrategy ?? config.strategy ?? 'TIME_WINDOW').toUpperCase();
  const keyRaw = String(config.dedupKey ?? config.key ?? 'DEVICE_EVENT_PAYLOAD').toUpperCase();
  return {
    strategy:
      strategyRaw === 'OFF' || strategyRaw === 'EVENT_ID' ? strategyRaw : 'TIME_WINDOW',
    key:
      keyRaw === 'DEVICE_EVENT'
      || keyRaw === 'TOPIC_PAYLOAD'
      || keyRaw === 'PAYLOAD_ONLY'
      || keyRaw === 'EVENT_ID'
        ? keyRaw
        : 'DEVICE_EVENT_PAYLOAD',
    windowMs: clampNumber(
      parseIntWithDefault(config.dedupWindowMs ?? config.windowMs, 1000),
      50,
      600000
    )
  };
}

function parseWindowAggregateConfig(config: Record<string, unknown>): WindowAggregateConfigDraft {
  const aggregationRaw = String(config.windowAggregation ?? config.aggregation ?? 'COUNT').toUpperCase();
  const timeBasisRaw = String(config.windowTimeBasis ?? config.timeBasis ?? 'INGEST_TIME').toUpperCase();
  const latePolicyRaw = String(config.windowLatePolicy ?? config.latePolicy ?? 'IGNORE').toUpperCase();
  return {
    aggregation:
      aggregationRaw === 'COUNT_DISTINCT_DEVICES'
      || aggregationRaw === 'AVG'
      || aggregationRaw === 'MIN'
      || aggregationRaw === 'MAX'
        ? aggregationRaw
        : 'COUNT',
    windowMs: clampNumber(
      parseIntWithDefault(config.windowSizeMs ?? config.sizeMs, 5000),
      500,
      600000
    ),
    timeBasis: timeBasisRaw === 'EVENT_TIME' ? 'EVENT_TIME' : 'INGEST_TIME',
    latePolicy: latePolicyRaw === 'GRACE' ? 'GRACE' : 'IGNORE',
    graceMs: clampNumber(
      parseIntWithDefault(config.windowGraceMs ?? config.graceMs, 2000),
      0,
      120000
    )
  };
}

function parseMicroBatchConfig(config: Record<string, unknown>): MicroBatchConfigDraft {
  return {
    batchSize: clampNumber(parseIntWithDefault(config.microBatchSize ?? config.batchSize, 10), 1, 500),
    maxWaitMs: clampNumber(parseIntWithDefault(config.microBatchMaxWaitMs ?? config.maxWaitMs, 500), 50, 60000)
  };
}

function detectTabletTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const userAgent = navigator.userAgent ?? '';
  const isiPad =
    /iPad/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const isAndroidTablet = /Android/i.test(userAgent) && !/Mobile/i.test(userAgent);
  const isTouchViewport =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) >= 720
      : false;
  return isiPad || isAndroidTablet || isTouchViewport;
}

export function PipelineBuilderSection({
  t,
  title,
  view,
  contextNotice,
  contextActionLabel,
  onContextAction,
  draftProcessing,
  onChangeSlotBlock,
  onSwapSlots,
  onChangeSlotConfig,
  onInputModeChange,
  onAddSink,
  onRemoveSink,
  onConfigureSendEventSink,
  sendEventTargetTypeOptions,
  allowBroadcastSinkDeviceOption = false,
  onResetSinkCounter,
  sinkRuntimeBusy,
  physicalDeviceIds = [],
  virtualDeviceIds = [],
  lecturerDeviceAvailable = true,
  logModeStatus,
  logModeStatusBusy,
  onRefreshLogModeStatus,
  logReplayFromOffset,
  onLogReplayFromOffsetChange,
  logReplayMaxRecords,
  onLogReplayMaxRecordsChange,
  onLogReplay,
  logReplayBusy,
  logReplayResult,
  onResetState,
  onRestartStateLost,
  onRestartStateRetained,
  stateControlBusy,
  hideRestartControlsInSimpleMode = false,
  showViewModeToggle = false,
  onSimplifiedViewChange,
  forceSinkEditable = false,
  simplifiedView = false,
  formatTs
}: PipelineBuilderSectionProps) {
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);
  const [inspectorModalSlotIndex, setInspectorModalSlotIndex] = useState<number | null>(null);
  const [selectedTraceBySlot, setSelectedTraceBySlot] = useState<Record<number, string>>({});
  const [topicFilterModalSlotIndex, setTopicFilterModalSlotIndex] = useState<number | null>(null);
  const [topicFilterModalMode, setTopicFilterModalMode] = useState<FilterTopicWizardMode>('guided');
  const [topicFilterModalTemplate, setTopicFilterModalTemplate] = useState<FilterTopicTemplate>('EVENT_ALL');
  const [topicFilterModalRawValue, setTopicFilterModalRawValue] = useState('');
  const [payloadFilterModalSlotIndex, setPayloadFilterModalSlotIndex] = useState<number | null>(null);
  const [payloadFilterDraft, setPayloadFilterDraft] = useState<PayloadFilterConfigDraft>({
    mode: 'STRING',
    operator: 'EQ',
    value: '',
    caseSensitive: false
  });
  const [conditionalPayloadModalSlotIndex, setConditionalPayloadModalSlotIndex] = useState<number | null>(null);
  const [conditionalPayloadDraft, setConditionalPayloadDraft] = useState<ConditionalPayloadConfigDraft>({
    mode: 'STRING',
    operator: 'EQ',
    value: '',
    caseSensitive: false,
    onMatchValue: '',
    onNoMatchValue: ''
  });
  const [rateLimitModalSlotIndex, setRateLimitModalSlotIndex] = useState<number | null>(null);
  const [rateLimitDraft, setRateLimitDraft] = useState<RateLimitConfigDraft>({ maxEvents: 20, windowMs: 1000 });
  const [dedupModalSlotIndex, setDedupModalSlotIndex] = useState<number | null>(null);
  const [dedupDraft, setDedupDraft] = useState<DedupConfigDraft>({
    strategy: 'TIME_WINDOW',
    key: 'DEVICE_EVENT_PAYLOAD',
    windowMs: 1000
  });
  const [windowAggregateModalSlotIndex, setWindowAggregateModalSlotIndex] = useState<number | null>(null);
  const [windowAggregateDraft, setWindowAggregateDraft] = useState<WindowAggregateConfigDraft>({
    aggregation: 'COUNT',
    windowMs: 5000,
    timeBasis: 'INGEST_TIME',
    latePolicy: 'IGNORE',
    graceMs: 2000
  });
  const [microBatchModalSlotIndex, setMicroBatchModalSlotIndex] = useState<number | null>(null);
  const [microBatchDraft, setMicroBatchDraft] = useState<MicroBatchConfigDraft>({ batchSize: 10, maxWaitMs: 500 });
  const [transformPayloadModalSlotIndex, setTransformPayloadModalSlotIndex] = useState<number | null>(null);
  const [transformPayloadMappingsDraft, setTransformPayloadMappingsDraft] = useState<TransformPayloadMapping[]>([
    { from: '', to: '' }
  ]);
  const [sinkEditorSinkId, setSinkEditorSinkId] = useState<string | null>(null);
  const [sinkEditorInitialTab, setSinkEditorInitialTab] = useState<ModalTab>('raw');
  const [blockInfoModal, setBlockInfoModal] = useState<{ title: string; bodyKey: I18nKey } | null>(null);
  const [sinkComposerMode, setSinkComposerMode] = useState<MqttComposerMode>('guided');
  const [sinkDraft, setSinkDraft] = useState<MqttEventDraft>(() => createMqttEventDraft());
  const [isTabletTouchDevice, setIsTabletTouchDevice] = useState<boolean>(() => detectTabletTouchDevice());
  const [touchDragState, setTouchDragState] = useState<{ blockType: string; sourceSlotIndex: number | null } | null>(
    null
  );
  const touchDragStateRef = useRef<{ blockType: string; sourceSlotIndex: number | null } | null>(null);
  const dragOverSlotIndexRef = useRef<number | null>(null);
  const touchDragCloneRef = useRef<HTMLElement | null>(null);
  const touchDragCloneOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 24 });
  const suppressTouchClickUntilRef = useRef<number>(0);
  const activePointerIdRef = useRef<number | null>(null);

  const guidedSinkMqttMessage = useMemo(() => {
    const guided = buildGuidedMqttMessage(sinkDraft);
    const isBroadcastDevice =
      allowBroadcastSinkDeviceOption
      && sinkDraft.targetType === 'physical'
      && sinkDraft.deviceId.trim().toUpperCase() === BROADCAST_DEVICE_ID;
    if (!isBroadcastDevice) {
      return guided;
    }
    return {
      ...guided,
      topic: guided.topic.replace(/^(BROADCAST|DEVICE)\//i, '')
    };
  }, [allowBroadcastSinkDeviceOption, sinkDraft]);

  if (!view) {
    return (
      <section className="panel panel-animate full-width">
        <header className="panel-header">
          <h3>{title}</h3>
        </header>
        {contextNotice ? (
          <div className="pipeline-context-banner">
            <span>{contextNotice}</span>
            {onContextAction && contextActionLabel ? (
              <button className="button tiny secondary" type="button" onClick={onContextAction}>
                {contextActionLabel}
              </button>
            ) : null}
          </div>
        ) : null}
        {!contextNotice ? <p className="muted">{t('loading')}</p> : null}
      </section>
    );
  }

  if (!view.permissions.visible) {
    return (
      <section className="panel panel-animate full-width">
        <header className="panel-header">
          <h3>{title}</h3>
        </header>
        <p className="muted">{t('pipelineHiddenByTask')}</p>
      </section>
    );
  }

  const processing = draftProcessing ?? view.processing;
  const blockOptions = ['NONE', ...view.permissions.allowedProcessingBlocks.filter((entry) => entry !== 'NONE')];
  const modeFeatureBadges = view.input.mode === 'LOG_MODE'
    ? ['retention', 'replay', 'offsets', 'consumer_groups']
    : ['realtime_pubsub', 'no_offset_replay'];
  const canControlLogMode = Boolean(
    onRefreshLogModeStatus &&
    onLogReplay &&
    onLogReplayFromOffsetChange &&
    onLogReplayMaxRecordsChange &&
    typeof logReplayMaxRecords === 'number'
  );
  const sinkEditable = forceSinkEditable || view.permissions.sinkEditable;
  const showStateResetControl = view.permissions.stateResetAllowed && !simplifiedView;
  const showStateRestartControls = view.permissions.stateRestartAllowed
    && !(simplifiedView && hideRestartControlsInSimpleMode);
  const processingSlots = buildDisplaySlots(processing);
  const processingSlotByIndex = new Map(processingSlots.map((slot) => [slot.index, slot]));
  const libraryBlockOptions = blockOptions.filter((entry) => entry !== 'NONE');
  const observabilityBySlot = new Map<number, PipelineBlockObservability>();
  for (const block of view.observability?.blocks ?? []) {
    observabilityBySlot.set(block.slotIndex, block);
  }
  const inspectorBlock = inspectorModalSlotIndex === null
    ? null
    : (observabilityBySlot.get(inspectorModalSlotIndex) ?? null);
  const inspectorSlot = inspectorModalSlotIndex === null
    ? null
    : (processingSlotByIndex.get(inspectorModalSlotIndex) ?? null);
  const inspectorSamples = inspectorBlock
    ? (simplifiedView
      ? inspectorBlock.samples.filter((sample) => !isInternalSample(sample))
      : inspectorBlock.samples)
    : [];
  const inspectorSelectedSample = inspectorBlock
    ? selectBlockSample(selectedTraceBySlot, inspectorBlock, inspectorSamples)
    : null;
  const inspectorParsedInput = inspectorSelectedSample ? parseJson(inspectorSelectedSample.inputPayloadJson) : null;
  const inspectorParsedOutput = inspectorSelectedSample ? parseJson(inspectorSelectedSample.outputPayloadJson) : null;
  const inspectorDiff = inspectorSelectedSample
    ? diffTopLevelKeys(inspectorParsedInput, inspectorParsedOutput)
    : null;
  const inspectorInCount = inspectorBlock == null
    ? 0
    : (simplifiedView ? nonInternalMetricValue(inspectorBlock.nonInternalInCount) : inspectorBlock.inCount);
  const inspectorOutCount = inspectorBlock == null
    ? 0
    : (simplifiedView ? nonInternalMetricValue(inspectorBlock.nonInternalOutCount) : inspectorBlock.outCount);
  const inspectorDropCount = inspectorBlock == null
    ? 0
    : (simplifiedView ? nonInternalMetricValue(inspectorBlock.nonInternalDropCount) : inspectorBlock.dropCount);
  const inspectorErrorCount = inspectorBlock == null
    ? 0
    : (simplifiedView ? nonInternalMetricValue(inspectorBlock.nonInternalErrorCount) : inspectorBlock.errorCount);
  const inspectorOutputPayload = inspectorSelectedSample?.outputPayloadJson ?? '';
  const inspectorOutputMissingBecauseDropped = Boolean(
    inspectorSelectedSample?.dropped && inspectorOutputPayload.trim().length === 0
  );
  const touchDragging = touchDragState !== null;

  useEffect(() => {
    touchDragStateRef.current = touchDragState;
  }, [touchDragState]);

  useEffect(() => {
    dragOverSlotIndexRef.current = dragOverSlotIndex;
  }, [dragOverSlotIndex]);

  const moveTouchDragClone = (x: number, y: number) => {
    const clone = touchDragCloneRef.current;
    if (!clone) {
      return;
    }
    const offset = touchDragCloneOffsetRef.current;
    clone.style.transform = `translate(${Math.round(x - offset.x)}px, ${Math.round(y + offset.y)}px)`;
  };

  const removeTouchDragClone = () => {
    const clone = touchDragCloneRef.current;
    if (clone) {
      clone.remove();
      touchDragCloneRef.current = null;
    }
  };

  const createTouchDragClone = (sourceElement: HTMLElement | null, x: number, y: number) => {
    removeTouchDragClone();
    if (!sourceElement || typeof document === 'undefined') {
      return;
    }
    const rect = sourceElement.getBoundingClientRect();
    const clone = sourceElement.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return;
    }
    clone.classList.add('pipeline-touch-drag-clone');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.width = `${Math.max(120, Math.round(rect.width))}px`;
    clone.style.maxWidth = `${Math.max(120, Math.round(rect.width))}px`;
    if (sourceElement.classList.contains('pipeline-flow-node')) {
      clone.classList.add('pipeline-touch-drag-clone-node');
    } else {
      clone.classList.add('pipeline-touch-drag-clone-chip');
    }
    touchDragCloneOffsetRef.current = {
      x: Math.max(40, rect.width / 2),
      y: Math.max(20, Math.min(44, rect.height * 0.45))
    };
    document.body.appendChild(clone);
    touchDragCloneRef.current = clone;
    moveTouchDragClone(x, y);
  };

  useEffect(() => {
    const updateTabletMode = () => {
      setIsTabletTouchDevice(detectTabletTouchDevice());
    };
    updateTabletMode();
    window.addEventListener('resize', updateTabletMode);
    window.addEventListener('orientationchange', updateTabletMode);
    return () => {
      window.removeEventListener('resize', updateTabletMode);
      window.removeEventListener('orientationchange', updateTabletMode);
    };
  }, []);

  const setSlotBlockType = (slotIndex: number, nextBlockType: string) => {
    if (!view.permissions.processingEditable) {
      return;
    }
    if (!blockOptions.includes(nextBlockType)) {
      return;
    }
    onChangeSlotBlock(slotIndex, nextBlockType);
  };

  const setDragPayload = (event: DragEvent<HTMLElement>, blockType: string, sourceSlotIndex: number | null) => {
    event.dataTransfer.setData(DND_BLOCK_TYPE, blockType);
    event.dataTransfer.setData('text/plain', blockType);
    event.dataTransfer.setData(DND_SOURCE_SLOT, sourceSlotIndex === null ? '' : String(sourceSlotIndex));
    event.dataTransfer.effectAllowed = sourceSlotIndex === null ? 'copyMove' : 'move';
  };

  const readDragBlockType = (event: DragEvent<HTMLElement>): string | null => {
    const fromCustom = event.dataTransfer.getData(DND_BLOCK_TYPE);
    const fromText = event.dataTransfer.getData('text/plain');
    const blockType = (fromCustom || fromText || '').trim();
    if (!blockType || !blockOptions.includes(blockType)) {
      return null;
    }
    return blockType;
  };

  const readSourceSlotIndex = (event: DragEvent<HTMLElement>): number | null => {
    const raw = event.dataTransfer.getData(DND_SOURCE_SLOT).trim();
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed >= processingSlots.length) {
      return null;
    }
    return parsed;
  };

  const placeInFirstAvailableSlot = (blockType: string) => {
    if (!view.permissions.processingEditable) {
      return;
    }
    const emptySlot = processingSlots.find((slot) => slot.blockType === 'NONE');
    const targetSlot = emptySlot ?? processingSlots[0];
    if (!targetSlot) {
      return;
    }
    setSlotBlockType(targetSlot.index, blockType);
  };

  const onSlotDragOver = (event: DragEvent<HTMLDivElement>, slotIndex: number, slotLocked: boolean) => {
    if (!view.permissions.processingEditable || slotLocked) {
      return;
    }
    const dragBlockType = readDragBlockType(event);
    if (!dragBlockType) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (dragOverSlotIndex !== slotIndex) {
      setDragOverSlotIndex(slotIndex);
    }
  };

  const onSlotDrop = (event: DragEvent<HTMLDivElement>, slotIndex: number, slotLocked: boolean) => {
    if (!view.permissions.processingEditable || slotLocked) {
      return;
    }
    const dragBlockType = readDragBlockType(event);
    if (!dragBlockType) {
      return;
    }
    event.preventDefault();
    setDragOverSlotIndex(null);

    const sourceSlotIndex = readSourceSlotIndex(event);
    if (sourceSlotIndex === null) {
      setSlotBlockType(slotIndex, dragBlockType);
      return;
    }
    if (sourceSlotIndex === slotIndex) {
      return;
    }
    if (onSwapSlots) {
      onSwapSlots(sourceSlotIndex, slotIndex);
      return;
    }

    const sourceBlockType = processingSlots[sourceSlotIndex]?.blockType ?? 'NONE';
    const targetBlockType = processingSlots[slotIndex]?.blockType ?? 'NONE';
    setSlotBlockType(slotIndex, sourceBlockType);
    setSlotBlockType(sourceSlotIndex, targetBlockType);
  };

  const readTouchSlotIndexFromPoint = (clientX: number, clientY: number): number | null => {
    if (!view.permissions.processingEditable || typeof document === 'undefined') {
      return null;
    }
    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof Element)) {
      return null;
    }
    const slotElement = target.closest('[data-pipeline-slot-index]');
    if (!(slotElement instanceof HTMLElement)) {
      return null;
    }
    if (slotElement.dataset.pipelineSlotLocked === 'true') {
      return null;
    }
    const rawSlotIndex = slotElement.dataset.pipelineSlotIndex ?? '';
    const slotIndex = Number.parseInt(rawSlotIndex, 10);
    if (!Number.isFinite(slotIndex)) {
      return null;
    }
    return slotIndex;
  };

  const clearTouchDrag = () => {
    touchDragStateRef.current = null;
    dragOverSlotIndexRef.current = null;
    activePointerIdRef.current = null;
    removeTouchDragClone();
    setTouchDragState(null);
    setDragOverSlotIndex(null);
  };

  const applyTouchDrop = (slotIndex: number, blockType: string, sourceSlotIndex: number | null) => {
    if (!view.permissions.processingEditable) {
      return;
    }
    if (!blockOptions.includes(blockType)) {
      return;
    }
    if (sourceSlotIndex === null) {
      setSlotBlockType(slotIndex, blockType);
      return;
    }
    if (sourceSlotIndex === slotIndex) {
      return;
    }
    if (onSwapSlots) {
      onSwapSlots(sourceSlotIndex, slotIndex);
      return;
    }
    const sourceBlockType = processingSlots[sourceSlotIndex]?.blockType ?? blockType;
    const targetBlockType = processingSlots[slotIndex]?.blockType ?? 'NONE';
    setSlotBlockType(slotIndex, sourceBlockType);
    setSlotBlockType(sourceSlotIndex, targetBlockType);
  };

  const startTouchDrag = (
    blockType: string,
    sourceSlotIndex: number | null,
    clientX: number,
    clientY: number,
    sourceElement: HTMLElement | null
  ) => {
    const started = { blockType, sourceSlotIndex };
    touchDragStateRef.current = started;
    setTouchDragState(started);
    const hovered = readTouchSlotIndexFromPoint(clientX, clientY);
    const initialTarget = sourceSlotIndex === null ? hovered : hovered ?? sourceSlotIndex;
    dragOverSlotIndexRef.current = initialTarget;
    setDragOverSlotIndex(initialTarget);
    createTouchDragClone(sourceElement, clientX, clientY);
  };

  const onTouchStartLibraryBlock = (event: ReactTouchEvent<HTMLElement>, blockType: string) => {
    if (!view.permissions.processingEditable) {
      return;
    }
    if (event.touches.length === 0) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const touch = event.touches[0];
    startTouchDrag(blockType, null, touch.clientX, touch.clientY, event.currentTarget);
  };

  const onTouchStartSlotBlock = (
    event: ReactTouchEvent<HTMLElement>,
    blockType: string,
    sourceSlotIndex: number,
    slotEditable: boolean
  ) => {
    if (!view.permissions.processingEditable || !slotEditable || event.touches.length === 0) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    const touch = event.touches[0];
    const sourceElement = event.currentTarget.closest('.pipeline-flow-node.slot');
    startTouchDrag(
      blockType,
      sourceSlotIndex,
      touch.clientX,
      touch.clientY,
      sourceElement instanceof HTMLElement ? sourceElement : null
    );
  };

  const onPointerStartLibraryBlock = (event: ReactPointerEvent<HTMLElement>, blockType: string) => {
    if (!view.permissions.processingEditable || event.pointerType !== 'touch') {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    activePointerIdRef.current = event.pointerId;
    startTouchDrag(blockType, null, event.clientX, event.clientY, event.currentTarget);
  };

  const onPointerStartSlotBlock = (
    event: ReactPointerEvent<HTMLElement>,
    blockType: string,
    sourceSlotIndex: number,
    slotEditable: boolean
  ) => {
    if (!view.permissions.processingEditable || !slotEditable || event.pointerType !== 'touch') {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();
    activePointerIdRef.current = event.pointerId;
    const sourceElement = event.currentTarget.closest('.pipeline-flow-node.slot');
    startTouchDrag(
      blockType,
      sourceSlotIndex,
      event.clientX,
      event.clientY,
      sourceElement instanceof HTMLElement ? sourceElement : null
    );
  };

  const shouldSuppressTouchClick = () => Date.now() < suppressTouchClickUntilRef.current;

  useEffect(() => {
    if (!touchDragState) {
      return undefined;
    }

    const handleTouchMove = (event: TouchEvent) => {
      const activeDrag = touchDragStateRef.current;
      if (!activeDrag || event.touches.length === 0) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const touch = event.touches[0];
      moveTouchDragClone(touch.clientX, touch.clientY);
      const hovered = readTouchSlotIndexFromPoint(touch.clientX, touch.clientY);
      if (dragOverSlotIndexRef.current !== hovered) {
        dragOverSlotIndexRef.current = hovered;
        setDragOverSlotIndex(hovered);
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const activeDrag = touchDragStateRef.current;
      if (!activeDrag) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const changedTouch = event.changedTouches[0];
      const slotIndexFromPoint = changedTouch
        ? readTouchSlotIndexFromPoint(changedTouch.clientX, changedTouch.clientY)
        : null;
      const targetSlotIndex = slotIndexFromPoint ?? dragOverSlotIndexRef.current;
      if (targetSlotIndex !== null) {
        applyTouchDrop(targetSlotIndex, activeDrag.blockType, activeDrag.sourceSlotIndex);
      }
      suppressTouchClickUntilRef.current = Date.now() + 450;
      clearTouchDrag();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const activeDrag = touchDragStateRef.current;
      if (!activeDrag) {
        return;
      }
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      moveTouchDragClone(event.clientX, event.clientY);
      const hovered = readTouchSlotIndexFromPoint(event.clientX, event.clientY);
      if (dragOverSlotIndexRef.current !== hovered) {
        dragOverSlotIndexRef.current = hovered;
        setDragOverSlotIndex(hovered);
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const activeDrag = touchDragStateRef.current;
      if (!activeDrag) {
        return;
      }
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const slotIndexFromPoint = readTouchSlotIndexFromPoint(event.clientX, event.clientY);
      const targetSlotIndex = slotIndexFromPoint ?? dragOverSlotIndexRef.current;
      if (targetSlotIndex !== null) {
        applyTouchDrop(targetSlotIndex, activeDrag.blockType, activeDrag.sourceSlotIndex);
      }
      suppressTouchClickUntilRef.current = Date.now() + 450;
      clearTouchDrag();
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd, { passive: false });
    window.addEventListener('pointercancel', handlePointerEnd, { passive: false });
    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };
  }, [touchDragState]);

  const openInspectorModal = (slotIndex: number) => {
    setInspectorModalSlotIndex(slotIndex);
  };

  const closeInspectorModal = () => {
    setInspectorModalSlotIndex(null);
  };

  const openTopicFilterModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    const configuredFilter = extractTopicFilterFromSlotConfig(slotConfig);
    const configuredMode = slotConfig.topicMode === 'raw' ? 'raw' : 'guided';
    const matchedTemplate = templateFromTopicFilter(configuredFilter);

    if (configuredMode === 'raw' || (configuredFilter.length > 0 && !matchedTemplate)) {
      setTopicFilterModalMode('raw');
      setTopicFilterModalRawValue(configuredFilter);
      setTopicFilterModalTemplate(matchedTemplate ?? 'EVENT_ALL');
    } else {
      setTopicFilterModalMode('guided');
      setTopicFilterModalTemplate(matchedTemplate ?? 'EVENT_ALL');
      setTopicFilterModalRawValue(configuredFilter);
    }
    setTopicFilterModalSlotIndex(slotIndex);
  };

  const closeTopicFilterModal = () => {
    setTopicFilterModalSlotIndex(null);
  };

  const saveTopicFilterModal = () => {
    if (topicFilterModalSlotIndex === null || !onChangeSlotConfig) {
      closeTopicFilterModal();
      return;
    }
    const resolvedFilter = topicFilterModalMode === 'guided'
      ? FILTER_TOPIC_TEMPLATE_TO_FILTER[topicFilterModalTemplate]
      : topicFilterModalRawValue.trim();
    onChangeSlotConfig(topicFilterModalSlotIndex, 'topicMode', topicFilterModalMode);
    onChangeSlotConfig(topicFilterModalSlotIndex, 'topicFilter', resolvedFilter);
    if (topicFilterModalMode === 'guided') {
      onChangeSlotConfig(topicFilterModalSlotIndex, 'topicTemplate', topicFilterModalTemplate);
    } else {
      onChangeSlotConfig(topicFilterModalSlotIndex, 'topicTemplate', '');
    }
    closeTopicFilterModal();
  };
  const topicFilterModalPreview = topicFilterModalMode === 'guided'
    ? FILTER_TOPIC_TEMPLATE_TO_FILTER[topicFilterModalTemplate]
    : topicFilterModalRawValue.trim();

  const openPayloadFilterModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    setPayloadFilterDraft(parsePayloadFilterConfig(slotConfig));
    setPayloadFilterModalSlotIndex(slotIndex);
  };

  const closePayloadFilterModal = () => {
    setPayloadFilterModalSlotIndex(null);
  };

  const savePayloadFilterModal = () => {
    if (payloadFilterModalSlotIndex === null || !onChangeSlotConfig) {
      closePayloadFilterModal();
      return;
    }
    const normalizedOperator = normalizePayloadFilterOperator(payloadFilterDraft.mode, payloadFilterDraft.operator);
    onChangeSlotConfig(payloadFilterModalSlotIndex, 'payloadFilterMode', payloadFilterDraft.mode);
    onChangeSlotConfig(payloadFilterModalSlotIndex, 'payloadFilterOperator', normalizedOperator);
    onChangeSlotConfig(payloadFilterModalSlotIndex, 'payloadFilterValue', payloadFilterDraft.value.trim());
    onChangeSlotConfig(payloadFilterModalSlotIndex, 'payloadFilterCaseSensitive', payloadFilterDraft.caseSensitive);
    closePayloadFilterModal();
  };

  const openConditionalPayloadModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    setConditionalPayloadDraft(parseConditionalPayloadConfig(slotConfig));
    setConditionalPayloadModalSlotIndex(slotIndex);
  };

  const closeConditionalPayloadModal = () => {
    setConditionalPayloadModalSlotIndex(null);
  };

  const saveConditionalPayloadModal = () => {
    if (conditionalPayloadModalSlotIndex === null || !onChangeSlotConfig) {
      closeConditionalPayloadModal();
      return;
    }
    const normalizedOperator = normalizePayloadFilterOperator(conditionalPayloadDraft.mode, conditionalPayloadDraft.operator);
    onChangeSlotConfig(conditionalPayloadModalSlotIndex, 'payloadFilterMode', conditionalPayloadDraft.mode);
    onChangeSlotConfig(conditionalPayloadModalSlotIndex, 'payloadFilterOperator', normalizedOperator);
    onChangeSlotConfig(conditionalPayloadModalSlotIndex, 'payloadFilterValue', conditionalPayloadDraft.value.trim());
    onChangeSlotConfig(
      conditionalPayloadModalSlotIndex,
      'payloadFilterCaseSensitive',
      conditionalPayloadDraft.caseSensitive
    );
    onChangeSlotConfig(conditionalPayloadModalSlotIndex, 'payloadOnMatch', conditionalPayloadDraft.onMatchValue);
    onChangeSlotConfig(conditionalPayloadModalSlotIndex, 'payloadOnNoMatch', conditionalPayloadDraft.onNoMatchValue);
    closeConditionalPayloadModal();
  };

  const openRateLimitModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    setRateLimitDraft(parseRateLimitConfig(slotConfig));
    setRateLimitModalSlotIndex(slotIndex);
  };

  const closeRateLimitModal = () => {
    setRateLimitModalSlotIndex(null);
  };

  const saveRateLimitModal = () => {
    if (rateLimitModalSlotIndex === null || !onChangeSlotConfig) {
      closeRateLimitModal();
      return;
    }
    onChangeSlotConfig(rateLimitModalSlotIndex, 'rateLimitMaxEvents', rateLimitDraft.maxEvents);
    onChangeSlotConfig(rateLimitModalSlotIndex, 'rateLimitWindowMs', rateLimitDraft.windowMs);
    closeRateLimitModal();
  };

  const openDedupModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    setDedupDraft(parseDedupConfig(slotConfig));
    setDedupModalSlotIndex(slotIndex);
  };

  const closeDedupModal = () => {
    setDedupModalSlotIndex(null);
  };

  const saveDedupModal = () => {
    if (dedupModalSlotIndex === null || !onChangeSlotConfig) {
      closeDedupModal();
      return;
    }
    onChangeSlotConfig(dedupModalSlotIndex, 'dedupStrategy', dedupDraft.strategy);
    onChangeSlotConfig(dedupModalSlotIndex, 'dedupKey', dedupDraft.key);
    onChangeSlotConfig(dedupModalSlotIndex, 'dedupWindowMs', dedupDraft.windowMs);
    closeDedupModal();
  };

  const openWindowAggregateModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    setWindowAggregateDraft(parseWindowAggregateConfig(slotConfig));
    setWindowAggregateModalSlotIndex(slotIndex);
  };

  const closeWindowAggregateModal = () => {
    setWindowAggregateModalSlotIndex(null);
  };

  const saveWindowAggregateModal = () => {
    if (windowAggregateModalSlotIndex === null || !onChangeSlotConfig) {
      closeWindowAggregateModal();
      return;
    }
    onChangeSlotConfig(windowAggregateModalSlotIndex, 'windowAggregation', windowAggregateDraft.aggregation);
    onChangeSlotConfig(windowAggregateModalSlotIndex, 'windowSizeMs', windowAggregateDraft.windowMs);
    onChangeSlotConfig(windowAggregateModalSlotIndex, 'windowTimeBasis', windowAggregateDraft.timeBasis);
    onChangeSlotConfig(windowAggregateModalSlotIndex, 'windowLatePolicy', windowAggregateDraft.latePolicy);
    onChangeSlotConfig(windowAggregateModalSlotIndex, 'windowGraceMs', windowAggregateDraft.graceMs);
    closeWindowAggregateModal();
  };

  const openMicroBatchModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    setMicroBatchDraft(parseMicroBatchConfig(slotConfig));
    setMicroBatchModalSlotIndex(slotIndex);
  };

  const closeMicroBatchModal = () => {
    setMicroBatchModalSlotIndex(null);
  };

  const saveMicroBatchModal = () => {
    if (microBatchModalSlotIndex === null || !onChangeSlotConfig) {
      closeMicroBatchModal();
      return;
    }
    onChangeSlotConfig(microBatchModalSlotIndex, 'microBatchSize', microBatchDraft.batchSize);
    onChangeSlotConfig(microBatchModalSlotIndex, 'microBatchMaxWaitMs', microBatchDraft.maxWaitMs);
    closeMicroBatchModal();
  };

  const openTransformPayloadModal = (slotIndex: number, slotConfig: Record<string, unknown>) => {
    const existingMappings = parseTransformPayloadMappings(slotConfig);
    setTransformPayloadMappingsDraft(
      existingMappings.length > 0
        ? existingMappings
        : [{ from: '', to: '' }]
    );
    setTransformPayloadModalSlotIndex(slotIndex);
  };

  const closeTransformPayloadModal = () => {
    setTransformPayloadModalSlotIndex(null);
  };

  const updateTransformPayloadDraft = (
    rowIndex: number,
    field: keyof TransformPayloadMapping,
    value: string
  ) => {
    setTransformPayloadMappingsDraft((previous) =>
      previous.map((mapping, index) =>
        index === rowIndex
          ? { ...mapping, [field]: value }
          : mapping
      )
    );
  };

  const addTransformPayloadRow = () => {
    setTransformPayloadMappingsDraft((previous) => [...previous, { from: '', to: '' }]);
  };

  const removeTransformPayloadRow = (rowIndex: number) => {
    setTransformPayloadMappingsDraft((previous) => {
      if (previous.length <= 1) {
        return [{ from: '', to: '' }];
      }
      return previous.filter((_, index) => index !== rowIndex);
    });
  };

  const saveTransformPayloadModal = () => {
    if (transformPayloadModalSlotIndex === null || !onChangeSlotConfig) {
      closeTransformPayloadModal();
      return;
    }
    const normalizedMappings = normalizeTransformPayloadMappings(transformPayloadMappingsDraft);
    onChangeSlotConfig(transformPayloadModalSlotIndex, 'transformMappings', normalizedMappings);
    closeTransformPayloadModal();
  };

  const sinkNodes = normalizeSinkNodes(view.sink.nodes);
  const sinkRuntimeById = new Map(
    (view.sinkRuntime?.nodes ?? []).map((node) => [node.sinkId, node])
  );
  const hasShowPayloadSink = sinkNodes.some((node) => normalizeSinkType(String(node.type)) === 'SHOW_PAYLOAD');
  const availableSinkTypes: Array<'SEND_EVENT' | 'SHOW_PAYLOAD'> = hasShowPayloadSink
    ? ['SEND_EVENT']
    : ['SEND_EVENT', 'SHOW_PAYLOAD'];
  const defaultSinkTargetTypes: MqttComposerTargetType[] = ['physical', 'virtual', 'custom'];
  const sinkAllowedTargetTypes: MqttComposerTargetType[] = (
    sendEventTargetTypeOptions?.length ? sendEventTargetTypeOptions : defaultSinkTargetTypes
  ).filter((entry, index, values) => values.indexOf(entry) === index);

  const setSinkDraftField = <K extends keyof MqttEventDraft>(key: K, value: MqttEventDraft[K]) => {
    setSinkDraft((previous) => ({
      ...previous,
      [key]: value
    }));
  };

  const setSinkTargetType = (targetType: MqttComposerTargetType) => {
    setSinkDraft((previous) => {
      const normalizedTemplate = normalizeMqttTemplateForTarget(targetType, previous.template);
      const keepBroadcastDevice =
        allowBroadcastSinkDeviceOption
        && targetType === 'physical'
        && (
          previous.deviceId.trim().toUpperCase() === BROADCAST_DEVICE_ID
          || previous.deviceId.trim().toUpperCase() === 'DEVICE'
        );
      const resolvedDeviceId = keepBroadcastDevice
        ? BROADCAST_DEVICE_ID
        : resolveMqttDeviceId(
            targetType,
            previous.deviceId,
            physicalDeviceIds,
            virtualDeviceIds
          );
      return {
        ...previous,
        targetType,
        template: normalizedTemplate,
        deviceId: resolvedDeviceId
      };
    });
  };

  const setSinkTemplate = (template: MqttComposerTemplate) => {
    setSinkDraft((previous) => ({
      ...previous,
      template: normalizeMqttTemplateForTarget(
        sinkAllowedTargetTypes.includes(previous.targetType)
          ? previous.targetType
          : (sinkAllowedTargetTypes[0] ?? 'physical'),
        template
      )
    }));
  };

  const setSinkDeviceId = (deviceId: string) => {
    setSinkDraft((previous) => ({
      ...previous,
      deviceId
    }));
  };

  const openSendEventSinkEditor = (node: PipelineSinkNode) => {
    const config = node.config ?? {};
    const topic = readSinkString(config, 'topic');
    const payload = readSinkString(config, 'payload');
    const qos = readSinkQos(config);
    const retained = readSinkRetained(config);
    const useIncomingPayload = readSinkUseIncomingPayload(config);
    const ledBlinkEnabled = readSinkLedBlinkEnabled(config);
    const ledBlinkMs = readSinkLedBlinkMs(config);
    const ledTopicConfig = parseLedSinkTopic(topic);
    const configuredDeviceId = parseTopicDeviceId(topic);
    const inferredTargetType: MqttComposerTargetType = (() => {
      if (ledTopicConfig !== null) {
        return 'physical';
      }
      const normalizedDevice = (configuredDeviceId ?? '').trim().toLowerCase();
      if (normalizedDevice === 'broadcast' || normalizedDevice === 'device') {
        return 'physical';
      }
      if (normalizedDevice.startsWith('eplvd')) {
        return 'virtual';
      }
      if (normalizedDevice.startsWith('epld')) {
        return 'physical';
      }
      return 'custom';
    })();
    const targetType = sinkAllowedTargetTypes.includes(inferredTargetType)
      ? inferredTargetType
      : (sinkAllowedTargetTypes[0] ?? 'physical');
    const base = createMqttEventDraft();
    const initialDeviceIdSource = ledTopicConfig?.deviceId
      ?? configuredDeviceId
      ?? resolveMqttDeviceId(targetType, base.deviceId, physicalDeviceIds, virtualDeviceIds);
    const initialDeviceIdUpper = initialDeviceIdSource.trim().toUpperCase();
    const initialDeviceId = allowBroadcastSinkDeviceOption
      && targetType === 'physical'
      && (initialDeviceIdUpper === BROADCAST_DEVICE_ID || initialDeviceIdUpper === 'DEVICE')
      ? BROADCAST_DEVICE_ID
      : resolveMqttDeviceId(targetType, initialDeviceIdSource, physicalDeviceIds, virtualDeviceIds);
    const shouldOpenLedTab = ledTopicConfig !== null && targetType === 'physical';
    setSinkComposerMode('guided');
    setSinkDraft({
      ...base,
      targetType,
      template: shouldOpenLedTab ? 'led' : normalizeMqttTemplateForTarget(targetType, 'custom'),
      deviceId: initialDeviceId,
      ledColor: ledTopicConfig?.ledColor ?? base.ledColor,
      customTopic: topic,
      customPayload: payload,
      rawTopic: topic,
      rawPayload: payload,
      qos,
      retained,
      useIncomingPayload,
      ledBlinkEnabled,
      ledBlinkMs
    });
    setSinkEditorInitialTab(shouldOpenLedTab ? 'led' : 'guided');
    setSinkEditorSinkId(node.id);
  };

  const saveSendEventSinkEditor = () => {
    if (!sinkEditorSinkId || !onConfigureSendEventSink) {
      return;
    }
    const isBroadcastDevice =
      allowBroadcastSinkDeviceOption
      && sinkDraft.targetType === 'physical'
      && sinkDraft.deviceId.trim().toUpperCase() === BROADCAST_DEVICE_ID;
    let topic = (sinkComposerMode === 'raw' ? sinkDraft.rawTopic : guidedSinkMqttMessage.topic).trim();
    if (isBroadcastDevice) {
      const broadcastPrefixPattern = /^(BROADCAST|DEVICE)\//i;
      topic = topic.replace(broadcastPrefixPattern, '');
    }
    const blinkAllowed = parseLedSinkTopic(topic) !== null;
    onConfigureSendEventSink(sinkEditorSinkId, {
      topic,
      payload: sinkDraft.rawPayload,
      useIncomingPayload: sinkDraft.useIncomingPayload,
      qos: sinkDraft.qos,
      retained: sinkDraft.retained,
      ledBlinkEnabled: blinkAllowed ? sinkDraft.ledBlinkEnabled : false,
      ledBlinkMs: sinkDraft.ledBlinkMs
    });
    setSinkEditorSinkId(null);
  };

  const setSinkComposerModeWithSync = (mode: MqttComposerMode) => {
    setSinkComposerMode(mode);
    setSinkDraft((previous) => ({
      ...previous,
      rawTopic: guidedSinkMqttMessage.topic
    }));
  };

  const sinkTopicPrefixLock = !allowBroadcastSinkDeviceOption
    && (sinkDraft.targetType === 'physical' || sinkDraft.targetType === 'custom')
    && sinkDraft.deviceId.trim().length > 0
    && sinkDraft.deviceId.trim().toUpperCase() !== BROADCAST_DEVICE_ID
    && sinkDraft.deviceId.trim().toUpperCase() !== 'DEVICE'
    ? sinkDraft.deviceId.trim().toLowerCase()
    : null;

  const openProcessingBlockInfo = (blockType: string) => {
    setBlockInfoModal({
      title: displayPipelineBlockType(blockType),
      bodyKey: processingBlockDocBodyKey(blockType)
    });
  };

  const openSinkBlockInfo = (sinkType: PipelineSinkType) => {
    setBlockInfoModal({
      title: t(sinkDisplayNameKey(sinkType)),
      bodyKey: sinkDocBodyKey(sinkType)
    });
  };

  return (
    <section className={`panel pipeline-builder full-width ${isTabletTouchDevice ? 'tablet-touch-mode' : ''}`}>
      <header className="panel-header">
        <h3>{title}</h3>
        {showViewModeToggle && onSimplifiedViewChange ? (
          <div className="pipeline-builder-actions">
            <span className="muted">{t('pipelineViewMode')}</span>
            <button
              type="button"
              className={`button tiny ${!simplifiedView ? 'active' : 'secondary'}`}
              onClick={() => onSimplifiedViewChange(false)}
            >
              {t('pipelineViewModeAdvanced')}
            </button>
            <button
              type="button"
              className={`button tiny ${simplifiedView ? 'active' : 'secondary'}`}
              onClick={() => onSimplifiedViewChange(true)}
            >
              {t('pipelineViewModeSimple')}
            </button>
          </div>
        ) : null}
      </header>
      {contextNotice ? (
        <div className="pipeline-context-banner">
          <span>{contextNotice}</span>
          {onContextAction && contextActionLabel ? (
            <button className="button tiny secondary" type="button" onClick={onContextAction}>
              {contextActionLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <article className="panel panel-animate full-width pipeline-panel pipeline-panel-input">
        <h4>{t('pipelineInput')}</h4>
        <label className="stack pipeline-field">
          <span>{t('pipelineInputMode')}</span>
          <select
            className="input"
            value={view.input.mode}
            onChange={(event) => onInputModeChange?.(event.target.value)}
            disabled={!view.permissions.inputEditable}
          >
            <option value="LIVE_MQTT">{t('pipelineInputModeLive')}</option>
            <option value="LOG_MODE">{t('pipelineInputModeLog')}</option>
          </select>
        </label>
        <div className="pipeline-mode-meta">
          <div className="chip-row">
            {modeFeatureBadges.map((badge) => (
              <span className="chip" key={badge}>
                {t(featureBadgeLabelKey(badge))}
              </span>
            ))}
          </div>
        </div>
        {canControlLogMode && view.input.mode === 'LOG_MODE' ? (
          <section className="pipeline-log-mode-box">
            <div className="pipeline-log-mode-header">
              <strong>{t('pipelineLogModeStatus')}</strong>
              <button
                className="button tiny ghost"
                type="button"
                onClick={onRefreshLogModeStatus}
                disabled={Boolean(logModeStatusBusy)}
              >
                {t('refresh')}
              </button>
            </div>
            <p className="muted">
              {logModeStatus?.message ?? t('loading')}
            </p>
            <div className="pipeline-log-mode-grid muted">
              <span>{t('pipelineLogTopic')}: {logModeStatus?.topic ?? '-'}</span>
              <span>{t('pipelineLogConnected')}: {logModeStatus?.connected ? t('online') : t('offline')}</span>
              <span>{t('pipelineLogEarliestOffset')}: {logModeStatus?.earliestOffset ?? '-'}</span>
              <span>{t('pipelineLogLatestOffset')}: {logModeStatus?.latestOffset ?? '-'}</span>
            </div>
            {view.input.mode === 'LOG_MODE' ? (
              <div className="pipeline-log-replay-controls">
                <label className="stack pipeline-field">
                  <span>{t('pipelineReplayFromOffset')}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={logReplayFromOffset ?? ''}
                    onChange={(event) => onLogReplayFromOffsetChange?.(event.target.value)}
                    placeholder={t('pipelineReplayFromOffsetPlaceholder')}
                  />
                </label>
                <label className="stack pipeline-field">
                  <span>{t('pipelineReplayMaxRecords')}</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={1000}
                    value={logReplayMaxRecords}
                    onChange={(event) =>
                      onLogReplayMaxRecordsChange?.(Number.parseInt(event.target.value || '1', 10) || 1)}
                  />
                </label>
                <button
                  className="button small"
                  type="button"
                  onClick={onLogReplay}
                  disabled={Boolean(logReplayBusy) || logModeStatus?.enabled === false}
                >
                  {logReplayBusy ? t('loading') : t('pipelineReplayAction')}
                </button>
                {logReplayResult ? (
                  <p className="muted">
                    {t('pipelineReplayReturned')}: {logReplayResult.returnedCount} | {t('pipelineReplayNextOffset')}:{' '}
                    {logReplayResult.nextOffset ?? '-'}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {!view.permissions.inputEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
      </article>

      <div className="pipeline-panel-connector" aria-hidden="true">
        <span className="pipeline-panel-connector-track">
          <span className="pipeline-panel-connector-head" />
        </span>
      </div>

      <article className="panel panel-animate full-width pipeline-panel pipeline-processing-panel">
        <h4>{t('pipelineProcessing')}</h4>
        <div className="pipeline-builder-workbench">
          <section className="pipeline-flow-column">
            <section
              className={`pipeline-flow-board ${touchDragging ? 'touch-dragging' : ''}`}
              onDragLeave={() => setDragOverSlotIndex(null)}
            >
              {processingSlots.map((slot) => {
                const isEmpty = slot.blockType === 'NONE';
                const isDropTarget = dragOverSlotIndex === slot.index;
                const isTaskScopeLocked = isTaskScopeLockedFilterSlot(slot);
                const slotEditable = view.permissions.processingEditable && !isTaskScopeLocked;
                const showSlotDeviceScope = !isEmpty && blockSupportsDeviceScope(slot.blockType);
                const isFilterTopic = !isEmpty && slot.blockType.trim().toUpperCase() === 'FILTER_TOPIC';
                const isFilterPayload = !isEmpty
                  && ['FILTER_PAYLOAD', 'FILTER_VALUE'].includes(slot.blockType.trim().toUpperCase());
                const isConditionalPayload = !isEmpty && slot.blockType.trim().toUpperCase() === 'CONDITIONAL_PAYLOAD';
                const isFilterRateLimit = !isEmpty && slot.blockType.trim().toUpperCase() === 'FILTER_RATE_LIMIT';
                const isDedup = !isEmpty && slot.blockType.trim().toUpperCase() === 'DEDUP';
                const isWindowAggregate = !isEmpty && slot.blockType.trim().toUpperCase() === 'WINDOW_AGGREGATE';
                const isMicroBatch = !isEmpty && slot.blockType.trim().toUpperCase() === 'MICRO_BATCH';
                const isTransformPayload = !isEmpty && slot.blockType.trim().toUpperCase() === 'TRANSFORM_PAYLOAD';
                const configuredTopicFilter = isFilterTopic
                  ? extractTopicFilterFromSlotConfig(slot.config ?? {})
                  : '';
                const configuredPayloadFilter = isFilterPayload
                  ? parsePayloadFilterConfig(slot.config ?? {})
                  : null;
                const configuredConditionalPayload = isConditionalPayload
                  ? parseConditionalPayloadConfig(slot.config ?? {})
                  : null;
                const configuredRateLimit = isFilterRateLimit ? parseRateLimitConfig(slot.config ?? {}) : null;
                const configuredDedup = isDedup ? parseDedupConfig(slot.config ?? {}) : null;
                const configuredWindowAggregate = isWindowAggregate
                  ? parseWindowAggregateConfig(slot.config ?? {})
                  : null;
                const configuredMicroBatch = isMicroBatch ? parseMicroBatchConfig(slot.config ?? {}) : null;
                const configuredTransformPayloadMappings = isTransformPayload
                  ? parseTransformPayloadMappings(slot.config ?? {})
                  : [];
                const slotDeviceScope = normalizeSlotDeviceScope(slot.config.deviceScope);
                const slotObservability = !isEmpty ? (observabilityBySlot.get(slot.index) ?? null) : null;
                const slotSamples = slotObservability
                  ? (simplifiedView
                    ? slotObservability.samples.filter((sample) => !isInternalSample(sample))
                    : slotObservability.samples)
                  : [];
                const displayInCount = slotObservability == null
                  ? 0
                  : (simplifiedView
                    ? nonInternalMetricValue(slotObservability.nonInternalInCount)
                    : slotObservability.inCount);
                const displayOutCount = slotObservability == null
                  ? 0
                  : (simplifiedView
                    ? nonInternalMetricValue(slotObservability.nonInternalOutCount)
                    : slotObservability.outCount);
                const displayDropCount = slotObservability == null
                  ? 0
                  : (simplifiedView
                    ? nonInternalMetricValue(slotObservability.nonInternalDropCount)
                    : slotObservability.dropCount);
                const displayErrorCount = slotObservability == null
                  ? 0
                  : (simplifiedView
                    ? nonInternalMetricValue(slotObservability.nonInternalErrorCount)
                    : slotObservability.errorCount);
                return (
                  <Fragment key={slot.index}>
                    {slot.index > 0 ? (
                      <div className="pipeline-flow-connector" aria-hidden="true">
                        <span className="pipeline-flow-arrow">↓</span>
                      </div>
                    ) : null}
                    <div
                      className={`pipeline-flow-node slot ${isEmpty ? 'empty' : 'filled'} ${
                        isDropTarget ? 'drag-over' : ''
                      } ${isTabletTouchDevice && slotEditable && !isEmpty ? 'tablet-grabbable' : ''} ${
                        touchDragging && slotEditable ? 'touch-drop-candidate' : ''
                      } ${
                        touchDragging && touchDragState?.sourceSlotIndex === slot.index ? 'touch-drag-source' : ''
                      }`}
                      data-pipeline-slot-index={slot.index}
                      data-pipeline-slot-locked={isTaskScopeLocked ? 'true' : 'false'}
                      draggable={!isTabletTouchDevice && slotEditable && !isEmpty}
                      onDragStart={(event) => {
                        if (isEmpty || !slotEditable) {
                          event.preventDefault();
                          return;
                        }
                        setDragPayload(event, slot.blockType, slot.index);
                      }}
                      onDragEnd={() => setDragOverSlotIndex(null)}
                      onDragOver={(event) => onSlotDragOver(event, slot.index, isTaskScopeLocked)}
                      onDrop={(event) => onSlotDrop(event, slot.index, isTaskScopeLocked)}
                    >
                      <div className="pipeline-flow-node-header">
                        <div className="pipeline-node-title-wrap">
                          {!isEmpty && slotEditable && isTabletTouchDevice ? (
                            <span
                              className="pipeline-drag-grab-handle slot-handle"
                              aria-label={t('pipelineDragHandle')}
                              title={t('pipelineDragHandle')}
                              onTouchStart={(event) => onTouchStartSlotBlock(event, slot.blockType, slot.index, slotEditable)}
                              onPointerDown={(event) => onPointerStartSlotBlock(event, slot.blockType, slot.index, slotEditable)}
                            >
                              ⋮⋮
                            </span>
                          ) : null}
                          <strong
                            className="mono pipeline-node-label"
                            onTouchStart={(event) => {
                              if (isEmpty || isTabletTouchDevice) {
                                return;
                              }
                              onTouchStartSlotBlock(event, slot.blockType, slot.index, slotEditable);
                            }}
                          >
                            {isEmpty ? t('pipelineDropBlockHint') : displayPipelineBlockType(slot.blockType)}
                          </strong>
                          {!isEmpty ? (
                            <button
                              type="button"
                              className="pipeline-node-icon-button pipeline-info-button"
                              onClick={() => openProcessingBlockInfo(slot.blockType)}
                              aria-label={t('pipelineBlockInfo')}
                              title={t('pipelineBlockInfo')}
                            >
                              <InfoIcon />
                            </button>
                          ) : null}
                        </div>
                        <div className="pipeline-node-header-actions">
                          {slotEditable && !isEmpty ? (
                            <button
                              type="button"
                              className="pipeline-node-icon-button"
                              onClick={() => setSlotBlockType(slot.index, 'NONE')}
                              aria-label={t('pipelineSinkRemove')}
                              title={t('pipelineSinkRemove')}
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {showSlotDeviceScope ? (
                        <label className="stack pipeline-slot-config">
                          <span>{t('pipelineDeviceScope')}</span>
                          {isTaskScopeLocked ? (
                            <p className="muted">
                              {slotDeviceScopeLabel(t, slot.config?.deviceScope)}
                            </p>
                          ) : (
                            <select
                              className="input pipeline-slot-select"
                              value={slotDeviceScope}
                              onChange={(event) =>
                                onChangeSlotConfig?.(slot.index, 'deviceScope', event.target.value)}
                              disabled={!slotEditable}
                            >
                              <option value="LECTURER_DEVICE" disabled={!lecturerDeviceAvailable}>
                                {t('pipelineDeviceScopeLecturer')}
                              </option>
                              <option value="OWN_DEVICE">{t('pipelineDeviceScopeOwn')}</option>
                              <option value="ALL_DEVICES">{t('pipelineDeviceScopeAll')}</option>
                            </select>
                          )}
                        </label>
                      ) : null}
                      {isFilterTopic ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineFilterTopicLabel')}</span>
                          <p className="muted mono">
                            {configuredTopicFilter.length > 0
                              ? configuredTopicFilter
                              : t('pipelineFilterTopicNotConfigured')}
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openTopicFilterModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineFilterTopicConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isFilterPayload && configuredPayloadFilter ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineFilterPayloadLabel')}</span>
                          <p className="muted mono">
                            {configuredPayloadFilter.value.trim().length > 0
                              ? `${t(
                                configuredPayloadFilter.mode === 'NUMERIC'
                                  ? 'pipelineFilterPayloadModeNumeric'
                                  : 'pipelineFilterPayloadModeString'
                              )} | ${t(payloadFilterOperatorLabelKey(configuredPayloadFilter.operator))} | ${
                                configuredPayloadFilter.value.trim()
                              }${
                                configuredPayloadFilter.mode === 'STRING' && configuredPayloadFilter.caseSensitive
                                  ? ` | ${t('pipelineFilterPayloadCaseSensitive')}`
                                  : ''
                              }`
                              : t('pipelineFilterPayloadNotConfigured')}
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openPayloadFilterModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineFilterPayloadConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isConditionalPayload && configuredConditionalPayload ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineConditionalPayloadLabel')}</span>
                          <p className="muted mono">
                            {configuredConditionalPayload.value.trim().length > 0
                              ? `${t(
                                configuredConditionalPayload.mode === 'NUMERIC'
                                  ? 'pipelineFilterPayloadModeNumeric'
                                  : 'pipelineFilterPayloadModeString'
                              )} | ${t(payloadFilterOperatorLabelKey(configuredConditionalPayload.operator))} | ${
                                configuredConditionalPayload.value.trim()
                              }${
                                configuredConditionalPayload.mode === 'STRING'
                                && configuredConditionalPayload.caseSensitive
                                  ? ` | ${t('pipelineFilterPayloadCaseSensitive')}`
                                  : ''
                              } | ${t('pipelineConditionalPayloadWhenTrue')}: ${
                                configuredConditionalPayload.onMatchValue || '""'
                              } | ${t('pipelineConditionalPayloadWhenFalse')}: ${
                                configuredConditionalPayload.onNoMatchValue || '""'
                              }`
                              : t('pipelineFilterPayloadNotConfigured')}
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openConditionalPayloadModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineConditionalPayloadConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isTransformPayload ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineTransformPayloadLabel')}</span>
                          <p className="muted mono">
                            {configuredTransformPayloadMappings.length > 0
                              ? `${t('pipelineTransformPayloadMappings')}: ${configuredTransformPayloadMappings.length}`
                              : t('pipelineTransformPayloadNoMappings')}
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openTransformPayloadModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineTransformPayloadConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isFilterRateLimit && configuredRateLimit ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineRateLimitLabel')}</span>
                          <p className="muted mono">
                            {configuredRateLimit.maxEvents} / {configuredRateLimit.windowMs} ms
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openRateLimitModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineRateLimitConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isDedup && configuredDedup ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineDedupLabel')}</span>
                          <p className="muted mono">
                            {t(
                              configuredDedup.strategy === 'OFF'
                                ? 'pipelineDedupStrategyOff'
                                : configuredDedup.strategy === 'EVENT_ID'
                                  ? 'pipelineDedupStrategyEventId'
                                  : 'pipelineDedupStrategyTimeWindow'
                            )}
                            {' | '}
                            {t(
                              configuredDedup.key === 'DEVICE_EVENT'
                                ? 'pipelineDedupKeyDeviceEvent'
                                : configuredDedup.key === 'TOPIC_PAYLOAD'
                                  ? 'pipelineDedupKeyTopicPayload'
                                  : configuredDedup.key === 'PAYLOAD_ONLY'
                                    ? 'pipelineDedupKeyPayloadOnly'
                                    : configuredDedup.key === 'EVENT_ID'
                                      ? 'pipelineDedupKeyEventId'
                                      : 'pipelineDedupKeyDeviceEventPayload'
                            )}
                            {' | '}
                            {configuredDedup.windowMs} ms
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openDedupModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineDedupConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isWindowAggregate && configuredWindowAggregate ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineWindowAggregateLabel')}</span>
                          <p className="muted mono">
                            {t(
                              configuredWindowAggregate.aggregation === 'COUNT_DISTINCT_DEVICES'
                                ? 'pipelineWindowAggregationCountDistinct'
                                : configuredWindowAggregate.aggregation === 'AVG'
                                  ? 'pipelineWindowAggregationAvg'
                                  : configuredWindowAggregate.aggregation === 'MIN'
                                    ? 'pipelineWindowAggregationMin'
                                    : configuredWindowAggregate.aggregation === 'MAX'
                                      ? 'pipelineWindowAggregationMax'
                                      : 'pipelineWindowAggregationCount'
                            )}
                            {' | '}
                            {configuredWindowAggregate.windowMs} ms
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openWindowAggregateModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineWindowAggregateConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {isMicroBatch && configuredMicroBatch ? (
                        <div className="pipeline-slot-config">
                          <span>{t('pipelineMicroBatchLabel')}</span>
                          <p className="muted mono">
                            {configuredMicroBatch.batchSize} | {configuredMicroBatch.maxWaitMs} ms
                          </p>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openMicroBatchModal(slot.index, slot.config ?? {})}
                            disabled={!slotEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineMicroBatchConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {slotObservability ? (
                        <>
                          <div className="pipeline-slot-observability-summary">
                            <span className="chip">{t('pipelineMetricIn')}: {displayInCount}</span>
                            <span className="chip">{t('pipelineMetricOut')}: {displayOutCount}</span>
                            <span className="chip warn">{t('pipelineMetricDrop')}: {displayDropCount}</span>
                            {!simplifiedView || displayErrorCount > 0 ? (
                              <span className="chip">{t('pipelineMetricErrors')}: {displayErrorCount}</span>
                            ) : null}
                            {simplifiedView ? (
                              <span className="chip">{t('pipelineMetricLatency')}: {slotObservability.latencyP50Ms.toFixed(2)} ms</span>
                            ) : (
                              <span className="chip">{t('pipelineMetricLatencyP95')}: {slotObservability.latencyP95Ms.toFixed(2)} ms</span>
                            )}
                            {!simplifiedView ? (
                              <>
                                <span className="chip">{t('pipelineMetricBacklog')}: {slotObservability.backlogDepth}</span>
                                <span className="chip">{t('pipelineStateType')}: {slotObservability.stateType}</span>
                              </>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() => openInspectorModal(slot.index)}
                          >
                            {`${t('pipelineInspect')} (${slotSamples.length})`}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </Fragment>
                );
              })}
            </section>
          </section>

          <aside className="pipeline-processing-sidebar">
            <section className="pipeline-block-library">
              <header className="pipeline-block-library-header">
                <strong>{t('pipelineAllowedBlocks')}</strong>
              </header>
              <div className="pipeline-block-library-list">
                {libraryBlockOptions.map((blockType) => (
                  <button
                    key={blockType}
                    type="button"
                    className={`pipeline-library-chip ${isTabletTouchDevice ? 'tablet-grabbable' : ''}`}
                    data-touch-dragging={
                      touchDragging && touchDragState?.sourceSlotIndex === null && touchDragState.blockType === blockType
                        ? 'true'
                        : 'false'
                    }
                    disabled={!view.permissions.processingEditable}
                    draggable={!isTabletTouchDevice && view.permissions.processingEditable}
                    onDragStart={(event) => setDragPayload(event, blockType, null)}
                    onDragEnd={() => setDragOverSlotIndex(null)}
                    onTouchStart={(event) => {
                      if (isTabletTouchDevice) {
                        return;
                      }
                      onTouchStartLibraryBlock(event, blockType);
                    }}
                    onClick={() => {
                      if (shouldSuppressTouchClick()) {
                        return;
                      }
                      placeInFirstAvailableSlot(blockType);
                    }}
                  >
                    {isTabletTouchDevice ? (
                      <span
                        className="pipeline-drag-grab-handle library-handle"
                        aria-label={t('pipelineDragHandle')}
                        title={t('pipelineDragHandle')}
                        onTouchStart={(event) => onTouchStartLibraryBlock(event, blockType)}
                        onPointerDown={(event) => onPointerStartLibraryBlock(event, blockType)}
                      >
                        ⋮⋮
                      </span>
                    ) : null}
                    <span className="mono">{displayPipelineBlockType(blockType)}</span>
                  </button>
                ))}
              </div>
            </section>

            {!simplifiedView ? (
              <p className="muted">
                {t('pipelineObservedEvents')}: {view.observability?.observedEvents ?? 0}
                {' | '}
                {t('pipelineSampling')} 1/{view.observability?.sampleEvery ?? 1}
                {' | '}
                {t('pipelineStateMode')}: {view.observability?.statePersistenceMode ?? '-'}
                {' | '}
                {t('pipelineRestartCount')}: {view.observability?.restartCount ?? 0}
                {view.observability?.lastRestartAt ? ` | ${formatTs(view.observability.lastRestartAt)}` : ''}
                {view.observability?.lastRestartMode ? ` (${view.observability.lastRestartMode})` : ''}
              </p>
            ) : null}
            {(showStateRestartControls || showStateResetControl) ? (
              <div className="pipeline-state-controls">
                {showStateResetControl ? (
                  <button
                    type="button"
                    className="button tiny secondary"
                    onClick={onResetState}
                    disabled={Boolean(stateControlBusy)}
                  >
                    {t('pipelineStateReset')}
                  </button>
                ) : null}
                {showStateRestartControls ? (
                  <>
                    <button
                      type="button"
                      className="button tiny secondary"
                      onClick={onRestartStateLost}
                      disabled={Boolean(stateControlBusy)}
                    >
                      {t('pipelineRestartLost')}
                    </button>
                    <button
                      type="button"
                      className="button tiny secondary"
                      onClick={onRestartStateRetained}
                      disabled={Boolean(stateControlBusy)}
                    >
                      {t('pipelineRestartRetained')}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
        {!view.permissions.processingEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
      </article>

      <div className="pipeline-panel-connector" aria-hidden="true">
        <span className="pipeline-panel-connector-track">
          <span className="pipeline-panel-connector-head" />
        </span>
      </div>

      <article className="panel panel-animate full-width pipeline-panel pipeline-panel-sink">
        <h4>{t('pipelineSink')}</h4>
        <div className="pipeline-sink-board">
          {sinkNodes.map((sinkNode) => {
            const sinkType = normalizeSinkType(String(sinkNode.type));
            const runtimeNode = sinkRuntimeById.get(sinkNode.id);
            const receivedCount = runtimeNode?.receivedCount ?? 0;
            const lastReceivedAt = runtimeNode?.lastReceivedAt ?? null;
            const lastPayloadPreview = (runtimeNode?.lastPayloadPreview ?? '').trim();
            const sendConfig = sinkNode.config ?? {};
            const sendTopic = readSinkString(sendConfig, 'topic');
            const sendPayload = readSinkString(sendConfig, 'payload');
            const sendUsesIncomingPayload = readSinkUseIncomingPayload(sendConfig);
            const sinkLabel = t(sinkDisplayNameKey(sinkType));
            return (
              <article className="pipeline-sink-node" key={sinkNode.id}>
                <header className="pipeline-sink-node-header">
                  <div className="pipeline-node-title-wrap">
                    <strong className="pipeline-node-label">{sinkLabel}</strong>
                    <button
                      className="pipeline-node-icon-button pipeline-info-button"
                      type="button"
                      onClick={() => openSinkBlockInfo(sinkType)}
                      aria-label={t('pipelineBlockInfo')}
                      title={t('pipelineBlockInfo')}
                    >
                      <InfoIcon />
                    </button>
                  </div>
                  <div className="pipeline-node-header-actions">
                    {sinkEditable && sinkType !== 'EVENT_FEED' && sinkType !== 'VIRTUAL_SIGNAL' ? (
                      <button
                        className="pipeline-node-icon-button"
                        type="button"
                        onClick={() => onRemoveSink?.(sinkNode.id)}
                        aria-label={t('pipelineSinkRemove')}
                        title={t('pipelineSinkRemove')}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                </header>

                {sinkType === 'EVENT_FEED' ? (
                  <p className="muted">{t('pipelineSinkEventFeedHint')}</p>
                ) : null}

                {sinkType === 'SEND_EVENT' ? (
                  <div className="pipeline-sink-details">
                    <p className="muted mono">
                      {sendTopic.length > 0 ? sendTopic : t('pipelineSinkNoTopic')}
                    </p>
                    <p className="muted">
                      {sendUsesIncomingPayload ? t('pipelineSinkPayloadModeIncoming') : t('pipelineSinkPayloadModeCustom')}
                    </p>
                    {!sendUsesIncomingPayload ? (
                      <p className="muted mono">
                        {sendPayload.trim().length > 0 ? sendPayload.trim() : t('pipelineSinkNoPayload')}
                      </p>
                    ) : null}
                    {readSinkLedBlinkEnabled(sinkNode.config ?? {}) ? (
                      <p className="muted">
                        {t('mqttLedBlink')}: {readSinkLedBlinkMs(sinkNode.config ?? {})} ms
                      </p>
                    ) : null}
                    <div className="pipeline-sink-actions">
                      <button
                        className="button tiny secondary"
                        type="button"
                        onClick={() => openSendEventSinkEditor(sinkNode)}
                        disabled={!sinkEditable}
                      >
                        {t('pipelineSinkConfigure')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {sinkType === 'VIRTUAL_SIGNAL' ? (
                  <div className="pipeline-sink-details">
                    <div className="pipeline-virtual-signal-line">
                      <span
                        key={String(lastReceivedAt ?? 'idle')}
                        className={`pipeline-virtual-signal-lamp ${lastReceivedAt ? 'blink' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="muted">{t('pipelineSinkVirtualSignalHint')}</span>
                    </div>
                    <p className="muted">
                      {t('pipelineSinkCounterLabel')}: {receivedCount}
                    </p>
                    {onResetSinkCounter ? (
                      <button
                        className="button tiny secondary"
                        type="button"
                        onClick={() => onResetSinkCounter(sinkNode.id)}
                        disabled={Boolean(sinkRuntimeBusy)}
                      >
                        {t('pipelineSinkResetCounter')}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {sinkType === 'SHOW_PAYLOAD' ? (
                  <div className="pipeline-sink-details">
                    <p className="muted">{t('pipelineSinkShowPayloadHint')}</p>
                    <p className="muted mono">{lastPayloadPreview.length > 0 ? lastPayloadPreview : '-'}</p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {sinkEditable ? (
          <div className="pipeline-sink-add-row">
            <span className="muted">{t('pipelineSinkAdd')}</span>
            {availableSinkTypes.map((sinkType) => (
              <button
                key={sinkType}
                type="button"
                className="button tiny secondary"
                onClick={() => onAddSink?.(sinkType)}
              >
                {t(sinkDisplayNameKey(sinkType))}
              </button>
            ))}
          </div>
        ) : null}
        {!sinkEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
      </article>

      {inspectorModalSlotIndex !== null && inspectorBlock !== null && inspectorSlot !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeInspectorModal}>
            <div className="event-modal pipeline-inspector-modal" onClick={(event) => event.stopPropagation()}>
              <div className="panel-header">
                <h2>{t('pipelineInspect')}</h2>
                <button
                  className="modal-close-button"
                  type="button"
                  onClick={closeInspectorModal}
                  aria-label={t('close')}
                  title={t('close')}
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="pipeline-inspector-overview">
                <span className="chip">#{inspectorSlot.index + 1}</span>
                <span className="chip mono">{displayPipelineBlockType(inspectorBlock.blockType)}</span>
                <span className="chip">{t('pipelineMetricIn')}: {inspectorInCount}</span>
                <span className="chip">{t('pipelineMetricOut')}: {inspectorOutCount}</span>
                <span className="chip warn">{t('pipelineMetricDrop')}: {inspectorDropCount}</span>
                {!simplifiedView || inspectorErrorCount > 0 ? (
                  <span className="chip">{t('pipelineMetricErrors')}: {inspectorErrorCount}</span>
                ) : null}
                {simplifiedView ? (
                  <span className="chip">{t('pipelineMetricLatency')}: {inspectorBlock.latencyP50Ms.toFixed(2)} ms</span>
                ) : (
                  <>
                    <span className="chip">{t('pipelineMetricLatencyP95')}: {inspectorBlock.latencyP95Ms.toFixed(2)} ms</span>
                    <span className="chip">{t('pipelineMetricBacklog')}: {inspectorBlock.backlogDepth}</span>
                    <span className="chip">{t('pipelineStateType')}: {inspectorBlock.stateType}</span>
                  </>
                )}
              </div>

              <div className="pipeline-inspector-controls">
                <label className="stack pipeline-field pipeline-inspector-trace-select">
                  <span>Trace</span>
                  <select
                    className="input"
                    value={inspectorSelectedSample?.traceId ?? ''}
                    onChange={(event) =>
                      setSelectedTraceBySlot((previous) => ({
                        ...previous,
                        [inspectorBlock.slotIndex]: event.target.value
                      }))
                    }
                  >
                    {inspectorSamples.length === 0 ? (
                      <option value="">{t('pipelineNoSamples')}</option>
                    ) : null}
                    {inspectorSamples.map((sample) => (
                      <option key={sample.traceId} value={sample.traceId}>
                        {sample.traceId.slice(0, 8)} - {formatTs(sample.ingestTs)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {inspectorSelectedSample ? (
                <div className="pipeline-inspector-body">
                  <div className="pipeline-inspector-meta-grid">
                    <div className="pipeline-inspector-meta-row">
                      <span className="pipeline-inspector-meta-key">Trace</span>
                      <span className="pipeline-inspector-meta-value mono">{inspectorSelectedSample.traceId}</span>
                    </div>
                    <div className="pipeline-inspector-meta-row">
                      <span className="pipeline-inspector-meta-key">{t('eventFieldIngestTs')}</span>
                      <span className="pipeline-inspector-meta-value">{formatTs(inspectorSelectedSample.ingestTs)}</span>
                    </div>
                    <div className="pipeline-inspector-meta-row">
                      <span className="pipeline-inspector-meta-key">{t('feedHeaderDeviceId')}</span>
                      <span className="pipeline-inspector-meta-value mono">{inspectorSelectedSample.deviceId}</span>
                    </div>
                    <div className="pipeline-inspector-meta-row">
                      <span className="pipeline-inspector-meta-key">{t('feedHeaderTopic')}</span>
                      <span className="pipeline-inspector-meta-value mono">{inspectorSelectedSample.topic}</span>
                    </div>
                    {inspectorSelectedSample.dropped ? (
                      <div className="pipeline-inspector-meta-row">
                        <span className="pipeline-inspector-meta-key">{t('pipelineDropped')}</span>
                        <span className="pipeline-inspector-meta-value pipeline-inspector-meta-value-warn">
                          {inspectorSelectedSample.dropReason ?? '-'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="pipeline-sample-grid">
                    <div className="pipeline-inspector-io-card">
                      <h6>{t('pipelineInputShort')}</h6>
                      <pre className="json-box">{prettyJson(inspectorParsedInput)}</pre>
                    </div>
                    <div className="pipeline-inspector-io-card">
                      <h6>{t('pipelineOutput')}</h6>
                      {inspectorOutputMissingBecauseDropped ? (
                        <div className="pipeline-inspector-output-dropped" aria-label={t('pipelineDropped')}>
                          <span className="pipeline-inspector-output-cross">✕</span>
                        </div>
                      ) : (
                        <pre className="json-box">{prettyJson(inspectorParsedOutput)}</pre>
                      )}
                    </div>
                  </div>
                  {inspectorDiff ? (
                    <div className="pipeline-diff-grid">
                      <span className="chip ok">{t('pipelineDiffAdded')}: {inspectorDiff.added.join(', ') || '-'}</span>
                      <span className="chip warn">{t('pipelineDiffChanged')}: {inspectorDiff.changed.join(', ') || '-'}</span>
                      <span className="chip">{t('pipelineDiffRemoved')}: {inspectorDiff.removed.join(', ') || '-'}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="muted">{t('pipelineNoSamples')}</p>
              )}
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {topicFilterModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeTopicFilterModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('pipelineFilterTopicModalTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeTopicFilterModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="mqtt-compose-mode-row">
              <button
                className={`button tiny ${topicFilterModalMode === 'guided' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setTopicFilterModalMode('guided')}
              >
                {t('pipelineFilterTopicModeGuided')}
              </button>
              <button
                className={`button tiny ${topicFilterModalMode === 'raw' ? 'active' : 'secondary'}`}
                type="button"
                onClick={() => setTopicFilterModalMode('raw')}
              >
                {t('pipelineFilterTopicModeRaw')}
              </button>
            </div>

            {topicFilterModalMode === 'guided' ? (
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterTopicTemplate')}</span>
                <select
                  className="input"
                  value={topicFilterModalTemplate}
                  onChange={(event) => setTopicFilterModalTemplate(event.target.value as FilterTopicTemplate)}
                >
                  {FILTER_TOPIC_TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterTopicRawLabel')}</span>
                <input
                  className="input mono"
                  value={topicFilterModalRawValue}
                  onChange={(event) => setTopicFilterModalRawValue(event.target.value)}
                  placeholder="+/event/#"
                />
              </label>
            )}

            <label className="stack pipeline-field">
              <span>{t('pipelineFilterTopicPreview')}</span>
              <input className="input mono mqtt-preview-input" value={topicFilterModalPreview} readOnly />
            </label>

            <div className="event-modal-actions">
              <button className="button" type="button" onClick={saveTopicFilterModal}>
                {t('save')}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {payloadFilterModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closePayloadFilterModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
              <div className="panel-header">
                <h2>{t('pipelineFilterPayloadModalTitle')}</h2>
                <button
                  className="modal-close-button"
                  type="button"
                  onClick={closePayloadFilterModal}
                  aria-label={t('close')}
                  title={t('close')}
                >
                  <CloseIcon />
                </button>
              </div>
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterPayloadMode')}</span>
                <select
                  className="input"
                  value={payloadFilterDraft.mode}
                  onChange={(event) => {
                    const nextMode = event.target.value === 'NUMERIC' ? 'NUMERIC' : 'STRING';
                    setPayloadFilterDraft((previous) => ({
                      ...previous,
                      mode: nextMode,
                      operator: normalizePayloadFilterOperator(nextMode, previous.operator)
                    }));
                  }}
                >
                  <option value="NUMERIC">{t('pipelineFilterPayloadModeNumeric')}</option>
                  <option value="STRING">{t('pipelineFilterPayloadModeString')}</option>
                </select>
              </label>
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterPayloadOperator')}</span>
                <select
                  className="input"
                  value={payloadFilterDraft.operator}
                  onChange={(event) =>
                    setPayloadFilterDraft((previous) => ({
                      ...previous,
                      operator: normalizePayloadFilterOperator(previous.mode, event.target.value)
                    }))
                  }
                >
                  {(payloadFilterDraft.mode === 'NUMERIC'
                    ? PAYLOAD_FILTER_NUMERIC_OPERATORS
                    : PAYLOAD_FILTER_STRING_OPERATORS
                  ).map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {t(operator.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterPayloadValue')}</span>
                <input
                  className="input mono"
                  type={payloadFilterDraft.mode === 'NUMERIC' ? 'number' : 'text'}
                  value={payloadFilterDraft.value}
                  onChange={(event) =>
                    setPayloadFilterDraft((previous) => ({
                      ...previous,
                      value: event.target.value
                    }))
                  }
                />
              </label>
              {payloadFilterDraft.mode === 'STRING' ? (
                <label className="checkbox-inline pipeline-field">
                  <input
                    type="checkbox"
                    checked={payloadFilterDraft.caseSensitive}
                    onChange={(event) =>
                      setPayloadFilterDraft((previous) => ({
                        ...previous,
                        caseSensitive: event.target.checked
                      }))
                    }
                  />
                  <span>{t('pipelineFilterPayloadCaseSensitive')}</span>
                </label>
              ) : null}
              <div className="event-modal-actions">
                <button className="button" type="button" onClick={savePayloadFilterModal}>
                  {t('save')}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {conditionalPayloadModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeConditionalPayloadModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
              <div className="panel-header">
                <h2>{t('pipelineConditionalPayloadModalTitle')}</h2>
                <button
                  className="modal-close-button"
                  type="button"
                  onClick={closeConditionalPayloadModal}
                  aria-label={t('close')}
                  title={t('close')}
                >
                  <CloseIcon />
                </button>
              </div>
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterPayloadMode')}</span>
                <select
                  className="input"
                  value={conditionalPayloadDraft.mode}
                  onChange={(event) => {
                    const nextMode = event.target.value === 'NUMERIC' ? 'NUMERIC' : 'STRING';
                    setConditionalPayloadDraft((previous) => ({
                      ...previous,
                      mode: nextMode,
                      operator: normalizePayloadFilterOperator(nextMode, previous.operator)
                    }));
                  }}
                >
                  <option value="NUMERIC">{t('pipelineFilterPayloadModeNumeric')}</option>
                  <option value="STRING">{t('pipelineFilterPayloadModeString')}</option>
                </select>
              </label>
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterPayloadOperator')}</span>
                <select
                  className="input"
                  value={conditionalPayloadDraft.operator}
                  onChange={(event) =>
                    setConditionalPayloadDraft((previous) => ({
                      ...previous,
                      operator: normalizePayloadFilterOperator(previous.mode, event.target.value)
                    }))
                  }
                >
                  {(conditionalPayloadDraft.mode === 'NUMERIC'
                    ? PAYLOAD_FILTER_NUMERIC_OPERATORS
                    : PAYLOAD_FILTER_STRING_OPERATORS
                  ).map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {t(operator.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack pipeline-field">
                <span>{t('pipelineFilterPayloadValue')}</span>
                <input
                  className="input mono"
                  type="text"
                  value={conditionalPayloadDraft.value}
                  onChange={(event) =>
                    setConditionalPayloadDraft((previous) => ({
                      ...previous,
                      value: event.target.value
                    }))
                  }
                />
              </label>
              {conditionalPayloadDraft.mode === 'STRING' ? (
                <label className="checkbox-inline pipeline-field">
                  <input
                    type="checkbox"
                    checked={conditionalPayloadDraft.caseSensitive}
                    onChange={(event) =>
                      setConditionalPayloadDraft((previous) => ({
                        ...previous,
                        caseSensitive: event.target.checked
                      }))
                    }
                  />
                  <span>{t('pipelineFilterPayloadCaseSensitive')}</span>
                </label>
              ) : null}
              <label className="stack pipeline-field">
                <span>{t('pipelineConditionalPayloadWhenTrue')}</span>
                <input
                  className="input mono"
                  value={conditionalPayloadDraft.onMatchValue}
                  onChange={(event) =>
                    setConditionalPayloadDraft((previous) => ({
                      ...previous,
                      onMatchValue: event.target.value
                    }))
                  }
                />
              </label>
              <label className="stack pipeline-field">
                <span>{t('pipelineConditionalPayloadWhenFalse')}</span>
                <input
                  className="input mono"
                  value={conditionalPayloadDraft.onNoMatchValue}
                  onChange={(event) =>
                    setConditionalPayloadDraft((previous) => ({
                      ...previous,
                      onNoMatchValue: event.target.value
                    }))
                  }
                />
              </label>
              <div className="event-modal-actions">
                <button className="button" type="button" onClick={saveConditionalPayloadModal}>
                  {t('save')}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {rateLimitModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeRateLimitModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('pipelineRateLimitModalTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeRateLimitModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <label className="stack pipeline-field">
              <span>{t('pipelineRateLimitMaxEvents')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={10000}
                value={rateLimitDraft.maxEvents}
                onChange={(event) =>
                  setRateLimitDraft((previous) => ({
                    ...previous,
                    maxEvents: clampNumber(parseIntWithDefault(event.target.value, 20), 1, 10000)
                  }))
                }
              />
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineRateLimitWindowMs')}</span>
              <input
                className="input"
                type="number"
                min={50}
                max={600000}
                value={rateLimitDraft.windowMs}
                onChange={(event) =>
                  setRateLimitDraft((previous) => ({
                    ...previous,
                    windowMs: clampNumber(parseIntWithDefault(event.target.value, 1000), 50, 600000)
                  }))
                }
              />
            </label>
            <div className="event-modal-actions">
              <button className="button" type="button" onClick={saveRateLimitModal}>
                {t('save')}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {dedupModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeDedupModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('pipelineDedupModalTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeDedupModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <label className="stack pipeline-field">
              <span>{t('pipelineDedupStrategy')}</span>
              <select
                className="input"
                value={dedupDraft.strategy}
                onChange={(event) =>
                  setDedupDraft((previous) => ({
                    ...previous,
                    strategy: event.target.value as DedupStrategy
                  }))
                }
              >
                <option value="TIME_WINDOW">{t('pipelineDedupStrategyTimeWindow')}</option>
                <option value="EVENT_ID">{t('pipelineDedupStrategyEventId')}</option>
                <option value="OFF">{t('pipelineDedupStrategyOff')}</option>
              </select>
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineDedupKey')}</span>
              <select
                className="input"
                value={dedupDraft.key}
                onChange={(event) =>
                  setDedupDraft((previous) => ({
                    ...previous,
                    key: event.target.value as DedupKey
                  }))
                }
                disabled={dedupDraft.strategy === 'EVENT_ID'}
              >
                <option value="DEVICE_EVENT_PAYLOAD">{t('pipelineDedupKeyDeviceEventPayload')}</option>
                <option value="DEVICE_EVENT">{t('pipelineDedupKeyDeviceEvent')}</option>
                <option value="TOPIC_PAYLOAD">{t('pipelineDedupKeyTopicPayload')}</option>
                <option value="PAYLOAD_ONLY">{t('pipelineDedupKeyPayloadOnly')}</option>
                <option value="EVENT_ID">{t('pipelineDedupKeyEventId')}</option>
              </select>
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineDedupWindowMs')}</span>
              <input
                className="input"
                type="number"
                min={50}
                max={600000}
                value={dedupDraft.windowMs}
                onChange={(event) =>
                  setDedupDraft((previous) => ({
                    ...previous,
                    windowMs: clampNumber(parseIntWithDefault(event.target.value, 1000), 50, 600000)
                  }))
                }
                disabled={dedupDraft.strategy === 'OFF'}
              />
            </label>
            <div className="event-modal-actions">
              <button className="button" type="button" onClick={saveDedupModal}>
                {t('save')}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {windowAggregateModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeWindowAggregateModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('pipelineWindowAggregateModalTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeWindowAggregateModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <label className="stack pipeline-field">
              <span>{t('pipelineWindowAggregation')}</span>
              <select
                className="input"
                value={windowAggregateDraft.aggregation}
                onChange={(event) =>
                  setWindowAggregateDraft((previous) => ({
                    ...previous,
                    aggregation: event.target.value as WindowAggregation
                  }))
                }
              >
                <option value="COUNT">{t('pipelineWindowAggregationCount')}</option>
                <option value="COUNT_DISTINCT_DEVICES">{t('pipelineWindowAggregationCountDistinct')}</option>
                <option value="AVG">{t('pipelineWindowAggregationAvg')}</option>
                <option value="MIN">{t('pipelineWindowAggregationMin')}</option>
                <option value="MAX">{t('pipelineWindowAggregationMax')}</option>
              </select>
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineWindowSizeMs')}</span>
              <input
                className="input"
                type="number"
                min={500}
                max={600000}
                value={windowAggregateDraft.windowMs}
                onChange={(event) =>
                  setWindowAggregateDraft((previous) => ({
                    ...previous,
                    windowMs: clampNumber(parseIntWithDefault(event.target.value, 5000), 500, 600000)
                  }))
                }
              />
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineWindowTimeBasis')}</span>
              <select
                className="input"
                value={windowAggregateDraft.timeBasis}
                onChange={(event) =>
                  setWindowAggregateDraft((previous) => ({
                    ...previous,
                    timeBasis: event.target.value as WindowTimeBasis
                  }))
                }
              >
                <option value="INGEST_TIME">{t('pipelineWindowTimeBasisIngest')}</option>
                <option value="EVENT_TIME">{t('pipelineWindowTimeBasisEvent')}</option>
              </select>
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineWindowLatePolicy')}</span>
              <select
                className="input"
                value={windowAggregateDraft.latePolicy}
                onChange={(event) =>
                  setWindowAggregateDraft((previous) => ({
                    ...previous,
                    latePolicy: event.target.value as WindowLatePolicy
                  }))
                }
              >
                <option value="IGNORE">{t('pipelineWindowLatePolicyIgnore')}</option>
                <option value="GRACE">{t('pipelineWindowLatePolicyGrace')}</option>
              </select>
            </label>
            {windowAggregateDraft.latePolicy === 'GRACE' ? (
              <label className="stack pipeline-field">
                <span>{t('pipelineWindowGraceMs')}</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={120000}
                  value={windowAggregateDraft.graceMs}
                  onChange={(event) =>
                    setWindowAggregateDraft((previous) => ({
                      ...previous,
                      graceMs: clampNumber(parseIntWithDefault(event.target.value, 2000), 0, 120000)
                    }))
                  }
                />
              </label>
            ) : null}
            <div className="event-modal-actions">
              <button className="button" type="button" onClick={saveWindowAggregateModal}>
                {t('save')}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {microBatchModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeMicroBatchModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('pipelineMicroBatchModalTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeMicroBatchModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <label className="stack pipeline-field">
              <span>{t('pipelineMicroBatchSize')}</span>
              <input
                className="input"
                type="number"
                min={1}
                max={500}
                value={microBatchDraft.batchSize}
                onChange={(event) =>
                  setMicroBatchDraft((previous) => ({
                    ...previous,
                    batchSize: clampNumber(parseIntWithDefault(event.target.value, 10), 1, 500)
                  }))
                }
              />
            </label>
            <label className="stack pipeline-field">
              <span>{t('pipelineMicroBatchMaxWaitMs')}</span>
              <input
                className="input"
                type="number"
                min={50}
                max={60000}
                value={microBatchDraft.maxWaitMs}
                onChange={(event) =>
                  setMicroBatchDraft((previous) => ({
                    ...previous,
                    maxWaitMs: clampNumber(parseIntWithDefault(event.target.value, 500), 50, 60000)
                  }))
                }
              />
            </label>
            <div className="event-modal-actions">
              <button className="button" type="button" onClick={saveMicroBatchModal}>
                {t('save')}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {transformPayloadModalSlotIndex !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeTransformPayloadModal}>
            <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('pipelineTransformPayloadModalTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={closeTransformPayloadModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="pipeline-transform-mappings">
              {transformPayloadMappingsDraft.map((mapping, index) => (
                <div className="pipeline-transform-row" key={`transform-mapping-${index}`}>
                  <label className="stack pipeline-field">
                    <span>{t('pipelineTransformPayloadFrom')}</span>
                    <input
                      className="input mono"
                      value={mapping.from}
                      onChange={(event) => updateTransformPayloadDraft(index, 'from', event.target.value)}
                    />
                  </label>
                  <span className="pipeline-transform-arrow" aria-hidden="true">
                    →
                  </span>
                  <label className="stack pipeline-field">
                    <span>{t('pipelineTransformPayloadTo')}</span>
                    <input
                      className="input mono"
                      value={mapping.to}
                      onChange={(event) => updateTransformPayloadDraft(index, 'to', event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="button tiny ghost"
                    onClick={() => removeTransformPayloadRow(index)}
                    aria-label={t('pipelineTransformPayloadRemoveRow')}
                    title={t('pipelineTransformPayloadRemoveRow')}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="pipeline-transform-actions">
              <button className="button tiny secondary" type="button" onClick={addTransformPayloadRow}>
                {t('pipelineTransformPayloadAddRow')}
              </button>
            </div>

            <div className="event-modal-actions">
              <button className="button" type="button" onClick={saveTransformPayloadModal}>
                {t('save')}
              </button>
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {blockInfoModal !== null ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={() => setBlockInfoModal(null)}>
            <div className="event-modal pipeline-doc-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{blockInfoModal.title}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={() => setBlockInfoModal(null)}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <div className="pipeline-doc-modal-body">
              {t(blockInfoModal.bodyKey).split('\n').map((line, index) => (
                <p key={`pipeline-doc-line-${index}`}>{line}</p>
              ))}
            </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {sinkEditorSinkId !== null ? (
        <AdminMqttEventModal
          t={t}
          open
          busy={false}
          mode={sinkComposerMode}
          draft={sinkDraft}
          physicalDeviceIds={physicalDeviceIds}
          virtualDeviceIds={virtualDeviceIds}
          guidedTopic={guidedSinkMqttMessage.topic}
          guidedPayload={guidedSinkMqttMessage.payload}
          onClose={() => setSinkEditorSinkId(null)}
          onSubmit={saveSendEventSinkEditor}
          onModeChange={setSinkComposerModeWithSync}
          onTargetTypeChange={setSinkTargetType}
          onTemplateChange={setSinkTemplate}
          onDeviceIdChange={setSinkDeviceId}
          onDraftChange={setSinkDraftField}
          targetTypeOptions={sendEventTargetTypeOptions}
          allowBroadcastDeviceOption={allowBroadcastSinkDeviceOption}
          titleKey="pipelineSinkSendEventConfigTitle"
          submitLabelKey="save"
          hidePayloadFields
          enableLedBlinkControls
          showSinkPayloadControls
          hideRawTab
          guidedTabLabelKey="mqttModeCustom"
          topicPrefixLock={sinkTopicPrefixLock}
          initialTab={sinkEditorInitialTab}
          simpleMode={simplifiedView}
        />
      ) : null}
    </section>
  );
}
