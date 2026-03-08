import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type {
  AdminSystemStatus,
  AuthMe,
  CanonicalEvent,
  DeviceCommandType,
  ExternalStreamSource,
  FeedScenarioConfig,
  LanguageMode,
  PipelineLogModeStatus,
  PipelineLogReplayResponse,
  PipelineObservabilityUpdate,
  PipelineCompareRow,
  PipelineProcessingSection,
  PipelineSinkNode,
  PipelineSinkRuntimeUpdate,
  PipelineSinkSection,
  StudentDeviceState,
  StudentDeviceScope,
  TaskPipelineConfig,
  PipelineView,
  SystemDataImportVerifyResponse,
  SystemDataPart,
  TimestampValue,
  VirtualDeviceTopicMode,
  VirtualDeviceState
} from './types';
import {
  type I18nKey,
  type Language,
  resolveLanguageFromMode,
  taskActiveDescription,
  taskDescription,
  taskTitle,
  tr
} from './i18n';
import {
  TOKEN_STORAGE_KEY,
  MAX_FEED_EVENTS,
  MAX_FEED_SOURCE_EVENTS,
  isAdminFeedHotPage,
  createSystemDataPartSelection,
  selectedSystemDataParts,
  systemDataPartLabel,
  MetricIcon,
  SettingsIcon,
  AdminIcon,
  mergeEventsBounded,
  clampFeed,
  applyFeedScenarioDisturbances,
  nextFeedScenarioReleaseAt,
  ipAddressToHref,
  findIpAddress,
  extractIpAddressFromDeviceStatus,
  extractIpAddressesFromEvents,
  sameTaskInfo,
  sameGroupOverviewList,
  sameAdminSystemStatus,
  sameVirtualDeviceState,
  sameStudentDeviceState,
  sameVirtualDevicePatch,
  getStoredToken,
  getStoredLanguageOverride,
  setStoredLanguageOverride,
  toErrorMessage,
  formatTimestamp,
  statusLabel,
  feedMatchesTopic,
  tryParsePayload,
  isTelemetryEvent,
  formatBrightnessMeasurement,
  eventValueSummary,
  eventFeedKey,
  buildDeviceTelemetrySnapshots,
  mergeTelemetrySnapshotCache,
  mergeIpAddressCache,
  formatRoundedDuration,
  estimateUptimeNow,
  formatRelativeFromNow,
  rssiBars,
  rssiClassName,
  patchFromVirtualDevice
} from './app/shared';
import type {
  StudentViewData,
  AdminViewData,
  WsConnectionState,
  FeedViewMode,
  EventDetailsViewMode,
  AdminPage,
  AdminFeedSource,
  StudentFeedSource,
  CounterResetTarget,
  VirtualDevicePatch,
  DeviceTelemetrySnapshot,
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft
} from './app/shared-types';
import { SystemStatusSection } from './components/admin/SystemStatusSection';
import { AdminDevicesSection } from './components/admin/AdminDevicesSection';
import { AdminFeedSection } from './components/admin/AdminFeedSection';
import { AdminMqttEventModal } from './components/admin/AdminMqttEventModal';
import { AdminDashboardSection } from './components/admin/AdminDashboardSection';
import { AdminTasksSection } from './components/admin/AdminTasksSection';
import { AdminGroupsSection } from './components/admin/AdminGroupsSection';
import { AdminPageNav } from './components/admin/AdminPageNav';
import { AdminSettingsSection } from './components/admin/AdminSettingsSection';
import { AdminStreamSourcesSection } from './components/admin/AdminStreamSourcesSection';
import { AppTopBar } from './components/layout/AppTopBar';
import { AboutEplModal } from './components/layout/AboutEplModal';
import { MainStateBanners } from './components/layout/MainStateBanners';
import { ToastStack, type ToastMessage } from './components/layout/ToastStack';
import { LoginSection } from './components/auth/LoginSection';
import { StudentFeedSection } from './components/student/StudentFeedSection';
import { StudentOnboardingSection } from './components/student/StudentOnboardingSection';
import { StudentOverviewSection } from './components/student/StudentOverviewSection';
import { StudentSettingsModal } from './components/student/StudentSettingsModal';
import { StudentCommandsSection } from './components/student/StudentCommandsSection';
import { StudentVirtualDeviceSection } from './components/student/StudentVirtualDeviceSection';
import { AppModals } from './components/AppModals';
import { PipelineBuilderSection } from './components/pipeline/PipelineBuilderSection';
import { PipelineScenariosSection } from './components/pipeline/PipelineScenariosSection';
import { useAdminSystemStatusPolling } from './hooks/useAdminSystemStatusPolling';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import {
  buildGuidedMqttMessage,
  createMqttEventDraft,
  lockTopicToDevicePrefix,
  normalizeLegacyLedCommandTopic,
  normalizeMqttTemplateForTarget,
  resolveMqttDeviceId
} from './app/mqtt-composer';

const PIPELINE_AUTOSAVE_DEBOUNCE_MS = 650;
const VIRTUAL_DEVICE_AUTOSAVE_DEBOUNCE_MS = 160;
const STUDENT_PIPELINE_SIMPLIFIED_STORAGE_KEY = 'epl.student.pipeline.simplifiedView';
const ADMIN_PIPELINE_SIMPLIFIED_STORAGE_KEY = 'epl.admin.pipeline.simplifiedView';

function processingSectionSignature(value: PipelineProcessingSection | null | undefined): string {
  return JSON.stringify(value ?? null);
}

function sinkSectionSignature(value: PipelineSinkSection | null | undefined): string {
  return JSON.stringify(value ? withNormalizedPipelineSinkSection(value) : null);
}

function pipelineStudentDraftSignature(
  processing: PipelineProcessingSection | null | undefined,
  sink: PipelineSinkSection | null | undefined
): string {
  return `${processingSectionSignature(processing)}::${sinkSectionSignature(sink)}`;
}

function pipelineAdminDraftSignature(
  view: Pick<PipelineView, 'input' | 'processing' | 'sink'> | null | undefined
): string {
  if (!view) {
    return 'null';
  }
  return JSON.stringify(view.input)
    + '::'
    + processingSectionSignature(view.processing)
    + '::'
    + sinkSectionSignature(view.sink);
}

function normalizePipelineSinkNodes(nodes: PipelineSinkNode[] | null | undefined): PipelineSinkNode[] {
  const normalized = Array.isArray(nodes) ? [...nodes] : [];
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
  for (const node of normalized) {
    if (!node || typeof node.type !== 'string') {
      continue;
    }
    const type = node.type.trim().toUpperCase();
    if (type === 'SHOW_PAYLOAD' || type === 'LAST_PAYLOAD') {
      includeShowPayload = true;
      continue;
    }
    if (type !== 'SEND_EVENT' && type !== 'DEVICE_CONTROL') {
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

function withNormalizedPipelineSinkSection(sink: PipelineSinkSection): PipelineSinkSection {
  const nodes = normalizePipelineSinkNodes(sink.nodes);
  const targets = nodes
    .map((node) => node.type)
    .filter((type) => type !== 'EVENT_FEED')
    .map((type) => (type === 'SEND_EVENT' ? 'DEVICE_CONTROL' : type));
  return {
    ...sink,
    nodes,
    targets
  };
}

function addPipelineSinkNode(
  sink: PipelineSinkSection,
  sinkType: 'SEND_EVENT' | 'VIRTUAL_SIGNAL' | 'SHOW_PAYLOAD'
): PipelineSinkSection {
  if (sinkType === 'VIRTUAL_SIGNAL') {
    return withNormalizedPipelineSinkSection(sink);
  }
  if (sinkType === 'SHOW_PAYLOAD') {
    const current = normalizePipelineSinkNodes(sink.nodes);
    if (current.some((node) => node.type === 'SHOW_PAYLOAD' || node.type === 'LAST_PAYLOAD')) {
      return withNormalizedPipelineSinkSection(sink);
    }
    return withNormalizedPipelineSinkSection({
      ...sink,
      nodes: [...current, { id: 'show-payload', type: 'SHOW_PAYLOAD', config: {} }]
    });
  }
  const current = normalizePipelineSinkNodes(sink.nodes);
  let sendIndex = 1;
  let nextId = 'send-event';
  const existingIds = new Set(current.map((node) => node.id));
  while (existingIds.has(nextId)) {
    sendIndex += 1;
    nextId = `send-event-${sendIndex}`;
  }
  const nextNode: PipelineSinkNode = {
    id: nextId,
    type: 'SEND_EVENT',
    config: { topic: '', payload: '', useIncomingPayload: true, qos: 1, retained: false }
  };
  return withNormalizedPipelineSinkSection({
    ...sink,
    nodes: [...current, nextNode]
  });
}

function removePipelineSinkNode(sink: PipelineSinkSection, sinkId: string): PipelineSinkSection {
  const current = normalizePipelineSinkNodes(sink.nodes);
  const nextNodes = current.filter(
    (node) => node.id !== sinkId || node.type === 'EVENT_FEED' || node.type === 'VIRTUAL_SIGNAL'
  );
  return withNormalizedPipelineSinkSection({
    ...sink,
    nodes: nextNodes
  });
}

function updatePipelineSendEventSinkConfig(
  sink: PipelineSinkSection,
  sinkId: string,
  config: Record<string, unknown>
): PipelineSinkSection {
  const current = normalizePipelineSinkNodes(sink.nodes);
  const nextNodes = current.map((node) => {
    if (node.id !== sinkId || node.type !== 'SEND_EVENT') {
      return node;
    }
    return {
      ...node,
      config: {
        topic: typeof config.topic === 'string' ? config.topic : '',
        payload: typeof config.payload === 'string' ? config.payload : '',
        useIncomingPayload:
          typeof config.useIncomingPayload === 'boolean'
            ? config.useIncomingPayload
            : String(config.useIncomingPayload ?? 'true').trim().toLowerCase() !== 'false',
        qos:
          typeof config.qos === 'number'
            ? Math.max(0, Math.min(2, Math.round(config.qos)))
            : Number.parseInt(String(config.qos ?? '1'), 10) || 1,
        retained: Boolean(config.retained),
        ledBlinkEnabled: Boolean(config.ledBlinkEnabled),
        ledBlinkMs:
          typeof config.ledBlinkMs === 'number'
            ? Math.max(50, Math.min(10000, Math.round(config.ledBlinkMs)))
            : Math.max(50, Math.min(10000, Number.parseInt(String(config.ledBlinkMs ?? '200'), 10) || 200))
      }
    };
  });
  return withNormalizedPipelineSinkSection({
    ...sink,
    nodes: nextNodes
  });
}

function applyPipelineSinkRuntimeUpdate(view: PipelineView, update: PipelineSinkRuntimeUpdate): PipelineView {
  if (view.groupKey !== update.groupKey || view.taskId !== update.taskId) {
    return view;
  }
  return {
    ...view,
    sinkRuntime: update.sinkRuntime
  };
}

function normalizePipelineView(view: PipelineView): PipelineView {
  return {
    ...view,
    sink: withNormalizedPipelineSinkSection(view.sink),
    sinkRuntime: {
      nodes: Array.isArray(view.sinkRuntime?.nodes) ? view.sinkRuntime.nodes : []
    }
  };
}

function setPipelineSlotBlock(
  processing: PipelineProcessingSection,
  slotIndex: number,
  blockType: string
): PipelineProcessingSection {
  const nextSlots = processing.slots.some((slot) => slot.index === slotIndex)
    ? processing.slots.map((slot) =>
        slot.index === slotIndex
          ? slot.blockType === blockType
            ? slot
            : { ...slot, blockType, config: {} }
          : slot
      )
    : [...processing.slots, { index: slotIndex, blockType, config: {} }];

  return {
    ...processing,
    slots: nextSlots.sort((a, b) => a.index - b.index)
  };
}

function setPipelineSlotConfigValue(
  processing: PipelineProcessingSection,
  slotIndex: number,
  key: string,
  value: unknown
): PipelineProcessingSection {
  const nextSlots = processing.slots.some((slot) => slot.index === slotIndex)
    ? processing.slots.map((slot) => {
        if (slot.index !== slotIndex) {
          return slot;
        }
        const nextConfig = { ...(slot.config ?? {}) };
        if (value === undefined || value === null || value === '') {
          delete nextConfig[key];
        } else {
          nextConfig[key] = value;
        }
        return {
          ...slot,
          config: nextConfig
        };
      })
    : [
        ...processing.slots,
        {
          index: slotIndex,
          blockType: 'NONE',
          config: value === undefined || value === null || value === '' ? {} : { [key]: value }
        }
      ];

  return {
    ...processing,
    slots: nextSlots.sort((a, b) => a.index - b.index)
  };
}

function swapPipelineSlots(
  processing: PipelineProcessingSection,
  sourceSlotIndex: number,
  targetSlotIndex: number
): PipelineProcessingSection {
  if (sourceSlotIndex === targetSlotIndex) {
    return processing;
  }

  const byIndex = new Map<number, PipelineProcessingSection['slots'][number]>();
  for (const slot of processing.slots) {
    byIndex.set(slot.index, slot);
  }

  const sourceSlot = byIndex.get(sourceSlotIndex) ?? {
    index: sourceSlotIndex,
    blockType: 'NONE',
    config: {}
  };
  const targetSlot = byIndex.get(targetSlotIndex) ?? {
    index: targetSlotIndex,
    blockType: 'NONE',
    config: {}
  };

  const nextSource = {
    index: sourceSlotIndex,
    blockType: targetSlot.blockType,
    config: { ...(targetSlot.config ?? {}) }
  };
  const nextTarget = {
    index: targetSlotIndex,
    blockType: sourceSlot.blockType,
    config: { ...(sourceSlot.config ?? {}) }
  };

  const sourceUnchanged =
    sourceSlot.blockType === nextSource.blockType &&
    JSON.stringify(sourceSlot.config ?? {}) === JSON.stringify(nextSource.config);
  const targetUnchanged =
    targetSlot.blockType === nextTarget.blockType &&
    JSON.stringify(targetSlot.config ?? {}) === JSON.stringify(nextTarget.config);
  if (sourceUnchanged && targetUnchanged) {
    return processing;
  }

  byIndex.set(sourceSlotIndex, nextSource);
  byIndex.set(targetSlotIndex, nextTarget);

  return {
    ...processing,
    slots: Array.from(byIndex.values()).sort((a, b) => a.index - b.index)
  };
}

function toggleStringInList(values: string[], value: string, enabled: boolean): string[] {
  if (enabled) {
    if (values.includes(value)) {
      return values;
    }
    return [...values, value];
  }
  return values.filter((entry) => entry !== value);
}

function normalizeStudentDeviceScope(raw: string | null | undefined): StudentDeviceScope {
  if (
    raw === 'ADMIN_DEVICE'
    || raw === 'ALL_DEVICES'
    || raw === 'OWN_DEVICE'
    || raw === 'OWN_AND_ADMIN_DEVICE'
  ) {
    return raw;
  }
  return 'OWN_DEVICE';
}

function sortExternalStreamSources(sources: ExternalStreamSource[]): ExternalStreamSource[] {
  return [...sources].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function upsertExternalStreamSource(
  sources: ExternalStreamSource[],
  updated: ExternalStreamSource
): ExternalStreamSource[] {
  const next = [...sources];
  const index = next.findIndex((entry) => entry.sourceId === updated.sourceId);
  if (index >= 0) {
    next[index] = updated;
    return sortExternalStreamSources(next);
  }
  next.push(updated);
  return sortExternalStreamSources(next);
}

function endpointDraftsFromSources(
  sources: ExternalStreamSource[],
  previous: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const source of sources) {
    const previousDraft = previous[source.sourceId];
    next[source.sourceId] = previousDraft ?? source.endpointUrl;
  }
  return next;
}

const VIRTUAL_PATCH_KEYS: Array<keyof VirtualDevicePatch> = [
  'buttonRedPressed',
  'buttonBlackPressed',
  'ledGreenOn',
  'ledOrangeOn',
  'temperatureC',
  'humidityPct',
  'brightness',
  'counterValue'
];
const VIRTUAL_BUTTON_PATCH_KEYS: Array<keyof VirtualDevicePatch> = ['buttonRedPressed', 'buttonBlackPressed'];

function hasOnlyButtonPatchDifferences(
  current: VirtualDevicePatch,
  baseline: VirtualDevicePatch
): boolean {
  let hasDifference = false;
  for (const key of VIRTUAL_PATCH_KEYS) {
    const currentValue = current[key];
    const baselineValue = baseline[key];
    if (currentValue === baselineValue) {
      continue;
    }
    hasDifference = true;
    if (!VIRTUAL_BUTTON_PATCH_KEYS.includes(key)) {
      return false;
    }
  }
  return hasDifference;
}

function extractTopicTargetGroupKey(topic: string): string | null {
  const normalizedTopic = topic.trim().toLowerCase();
  if (!normalizedTopic) {
    return null;
  }
  const firstSegment = normalizedTopic.split('/', 1)[0]?.trim() ?? '';
  if (/^epld\d+$/.test(firstSegment)) {
    return firstSegment;
  }
  const virtualMatch = /^eplvd(\d+)$/.exec(firstSegment);
  if (virtualMatch) {
    return `epld${virtualMatch[1]}`;
  }
  return null;
}

function isTopicAllowedForStudentScope(
  scopeRaw: StudentDeviceScope | null | undefined,
  topic: string,
  ownDeviceIdRaw: string | null | undefined,
  adminDeviceIdRaw: string | null | undefined
): boolean {
  const scope = normalizeStudentDeviceScope(scopeRaw);
  if (scope === 'ALL_DEVICES') {
    return true;
  }
  const targetGroupKey = extractTopicTargetGroupKey(topic);
  if (!targetGroupKey) {
    return false;
  }
  const ownDeviceId = (ownDeviceIdRaw ?? '').trim().toLowerCase();
  const adminDeviceId = (adminDeviceIdRaw ?? '').trim().toLowerCase();
  if (scope === 'OWN_DEVICE') {
    return ownDeviceId.length > 0 && targetGroupKey === ownDeviceId;
  }
  if (scope === 'ADMIN_DEVICE') {
    return adminDeviceId.length > 0 && targetGroupKey === adminDeviceId;
  }
  return (
    (ownDeviceId.length > 0 && targetGroupKey === ownDeviceId) ||
    (adminDeviceId.length > 0 && targetGroupKey === adminDeviceId)
  );
}

function allowedPhysicalTargetsForScope(
  scopeRaw: StudentDeviceScope | null | undefined,
  ownDeviceIdRaw: string | null | undefined,
  adminDeviceIdRaw: string | null | undefined
): string[] {
  const scope = normalizeStudentDeviceScope(scopeRaw);
  const ownDeviceId = (ownDeviceIdRaw ?? '').trim().toLowerCase();
  const adminDeviceId = (adminDeviceIdRaw ?? '').trim().toLowerCase();
  const values: string[] = [];
  const pushIfValid = (value: string) => {
    if (!isLikelyPhysicalDeviceId(value)) {
      return;
    }
    if (!values.includes(value)) {
      values.push(value);
    }
  };
  if (scope === 'OWN_DEVICE') {
    pushIfValid(ownDeviceId);
    return values;
  }
  if (scope === 'ADMIN_DEVICE') {
    pushIfValid(adminDeviceId);
    return values;
  }
  if (scope === 'OWN_AND_ADMIN_DEVICE') {
    pushIfValid(ownDeviceId);
    pushIfValid(adminDeviceId);
    return values;
  }
  pushIfValid(ownDeviceId);
  pushIfValid(adminDeviceId);
  return values;
}

function isLikelyPhysicalDeviceId(deviceId: string): boolean {
  const normalized = deviceId.trim().toLowerCase();
  return /^epld\d+$/.test(normalized);
}

function normalizeTopicPrefixDeviceId(deviceId: string | null | undefined): string {
  const normalized = (deviceId ?? '').trim().toLowerCase();
  return isLikelyPhysicalDeviceId(normalized) ? normalized : '';
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [session, setSession] = useState<AuthMe | null>(null);
  const [booting, setBooting] = useState(true);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPin, setLoginPin] = useState('');

  const [studentData, setStudentData] = useState<StudentViewData | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [studentTopicFilter, setStudentTopicFilter] = useState('');
  const [studentShowInternal, setStudentShowInternal] = useState(false);
  const [studentFeedSource, setStudentFeedSource] = useState<StudentFeedSource>('BEFORE_PIPELINE');
  const [studentFeedPaused, setStudentFeedPaused] = useState(false);
  const [studentPipelineFeed, setStudentPipelineFeed] = useState<CanonicalEvent[]>([]);
  const [studentOnboardingDone, setStudentOnboardingDone] = useState(false);
  const [studentPipeline, setStudentPipeline] = useState<PipelineView | null>(null);
  const [studentPipelineDraft, setStudentPipelineDraft] = useState<PipelineProcessingSection | null>(null);
  const [studentPipelineSinkDraft, setStudentPipelineSinkDraft] = useState<PipelineSinkSection | null>(null);
  const [studentDeviceStatesById, setStudentDeviceStatesById] = useState<Record<string, StudentDeviceState>>({});

  const [adminData, setAdminData] = useState<AdminViewData | null>(null);
  const [adminSystemStatus, setAdminSystemStatus] = useState<AdminSystemStatus | null>(null);
  const [adminStreamSources, setAdminStreamSources] = useState<ExternalStreamSource[]>([]);
  const [adminStreamSourceEndpointDrafts, setAdminStreamSourceEndpointDrafts] = useState<Record<string, string>>({});
  const [adminTopicFilter, setAdminTopicFilter] = useState('');
  const [adminIncludeInternal, setAdminIncludeInternal] = useState(false);
  const [adminFeedSource, setAdminFeedSource] = useState<AdminFeedSource>('AFTER_DISTURBANCES');
  const [adminFeedPaused, setAdminFeedPaused] = useState(false);
  const [adminPipelineFeed, setAdminPipelineFeed] = useState<CanonicalEvent[]>([]);
  const [adminSettingsDraftMode, setAdminSettingsDraftMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [adminSettingsDraftTimeFormat24h, setAdminSettingsDraftTimeFormat24h] = useState(true);
  const [adminSettingsDraftVirtualVisible, setAdminSettingsDraftVirtualVisible] = useState(true);
  const [adminSettingsDraftAdminDeviceId, setAdminSettingsDraftAdminDeviceId] = useState<string | null>(null);
  const [adminSettingsDraftVirtualDeviceTopicMode, setAdminSettingsDraftVirtualDeviceTopicMode] =
    useState<VirtualDeviceTopicMode>('OWN_TOPIC');
  const [adminDeviceSnapshots, setAdminDeviceSnapshots] = useState<Record<string, DeviceTelemetrySnapshot>>({});
  const [adminDeviceIpById, setAdminDeviceIpById] = useState<Record<string, string>>({});
  const [adminPipeline, setAdminPipeline] = useState<PipelineView | null>(null);
  const [adminPipelineDraft, setAdminPipelineDraft] = useState<PipelineView | null>(null);
  const [adminPipelineGroupKey, setAdminPipelineGroupKey] = useState('');
  const [adminPipelineGroupContextKey, setAdminPipelineGroupContextKey] = useState<string | null>(null);
  const [adminPipelineLogModeStatus, setAdminPipelineLogModeStatus] = useState<PipelineLogModeStatus | null>(null);
  const [adminPipelineReplayFromOffset, setAdminPipelineReplayFromOffset] = useState('');
  const [adminPipelineReplayMaxRecords, setAdminPipelineReplayMaxRecords] = useState(200);
  const [adminPipelineReplayResult, setAdminPipelineReplayResult] = useState<PipelineLogReplayResponse | null>(null);
  const [adminPipelineTaskId, setAdminPipelineTaskId] = useState('');
  const [adminTaskPipelineConfig, setAdminTaskPipelineConfig] = useState<TaskPipelineConfig | null>(null);
  const [adminTaskPipelineConfigDraft, setAdminTaskPipelineConfigDraft] = useState<TaskPipelineConfig | null>(null);
  const [_adminPipelineCompareRows, setAdminPipelineCompareRows] = useState<PipelineCompareRow[]>([]);
  const [studentVirtualPatch, setStudentVirtualPatch] = useState<VirtualDevicePatch | null>(null);
  const [virtualControlDeviceId, setVirtualControlDeviceId] = useState<string | null>(null);
  const [virtualControlPatch, setVirtualControlPatch] = useState<VirtualDevicePatch | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [wsConnection, setWsConnection] = useState<WsConnectionState>('disconnected');

  const [defaultLanguageMode, setDefaultLanguageMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [timeFormat24h, setTimeFormat24h] = useState(true);
  const [languageOverride, setLanguageOverride] = useState<Language | null>(() => getStoredLanguageOverride());
  const [feedViewMode, setFeedViewMode] = useState<FeedViewMode>('rendered');
  const [selectedEvent, setSelectedEvent] = useState<CanonicalEvent | null>(null);
  const [eventDetailsViewMode, setEventDetailsViewMode] = useState<EventDetailsViewMode>('rendered');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [studentSettingsOpen, setStudentSettingsOpen] = useState(false);
  const [adminPasswordModalOpen, setAdminPasswordModalOpen] = useState(false);
  const [adminPasswordCurrent, setAdminPasswordCurrent] = useState('');
  const [adminPasswordNext, setAdminPasswordNext] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  const [studentPipelineSimplifiedView, setStudentPipelineSimplifiedView] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    try {
      const stored = window.localStorage.getItem(STUDENT_PIPELINE_SIMPLIFIED_STORAGE_KEY);
      if (stored === null) {
        return true;
      }
      return stored === 'true';
    } catch {
      return true;
    }
  });
  const [adminPipelineSimplifiedView, setAdminPipelineSimplifiedView] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      const stored = window.localStorage.getItem(ADMIN_PIPELINE_SIMPLIFIED_STORAGE_KEY);
      if (stored === null) {
        return false;
      }
      return stored === 'true';
    } catch {
      return false;
    }
  });
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());
  const [feedDisturbanceClockMs, setFeedDisturbanceClockMs] = useState<number>(() => Date.now());
  const [counterResetTarget, setCounterResetTarget] = useState<CounterResetTarget | null>(null);
  const [resetEventsModalOpen, setResetEventsModalOpen] = useState(false);
  const [pinEditorDeviceId, setPinEditorDeviceId] = useState<string | null>(null);
  const [pinEditorValue, setPinEditorValue] = useState('');
  const [pinEditorLoading, setPinEditorLoading] = useState(false);
  const [mqttModalOpen, setMqttModalOpen] = useState(false);
  const [mqttComposerMode, setMqttComposerMode] = useState<MqttComposerMode>('guided');
  const [mqttEventDraft, setMqttEventDraft] = useState<MqttEventDraft>(() => createMqttEventDraft());
  const [studentMqttModalOpen, setStudentMqttModalOpen] = useState(false);
  const [studentMqttComposerMode, setStudentMqttComposerMode] = useState<MqttComposerMode>('guided');
  const [studentMqttEventDraft, setStudentMqttEventDraft] = useState<MqttEventDraft>(() => createMqttEventDraft());
  const [adminPage, setAdminPage] = useState<AdminPage>('dashboard');
  const [recentFeedEventIds, setRecentFeedEventIds] = useState<Record<string, true>>({});
  const [systemDataExportSelection, setSystemDataExportSelection] = useState<Record<SystemDataPart, boolean>>(
    () => createSystemDataPartSelection(true)
  );
  const [systemDataImportFileName, setSystemDataImportFileName] = useState('');
  const [systemDataImportFile, setSystemDataImportFile] = useState<File | null>(null);
  const [systemDataImportVerify, setSystemDataImportVerify] = useState<SystemDataImportVerifyResponse | null>(null);
  const [systemDataImportSelection, setSystemDataImportSelection] = useState<Record<SystemDataPart, boolean>>(
    () => createSystemDataPartSelection(false)
  );
  const [feedScenarioConfig, setFeedScenarioConfig] = useState<FeedScenarioConfig | null>(null);
  const [feedScenarioDraft, setFeedScenarioDraft] = useState<string[]>([]);
  const [feedScenarioStudentDeviceViewDisturbedDraft, setFeedScenarioStudentDeviceViewDisturbedDraft] =
    useState<boolean>(false);

  const studentPauseRef = useRef(studentFeedPaused);
  const adminPauseRef = useRef(adminFeedPaused);
  const wsLastActivityAtRef = useRef<number>(Date.now());
  const wsBackfillInFlightRef = useRef(false);
  const wsBackfillLastRunAtRef = useRef<number>(0);
  const adminDataRef = useRef<AdminViewData | null>(null);
  const adminPageRef = useRef(adminPage);
  const deferredAdminFeedRef = useRef<CanonicalEvent[]>([]);
  const studentVisibleFeedIdsRef = useRef<Set<string>>(new Set());
  const studentVisibleFeedInitializedRef = useRef(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const recentFeedClearTimerRef = useRef<number | null>(null);
  const studentFeedSourceManualRef = useRef(false);
  const adminPipelineGroupKeyRef = useRef<string>('');
  const nextToastIdRef = useRef(1);
  const studentPipelineAutosaveTimerRef = useRef<number | null>(null);
  const adminPipelineAutosaveTimerRef = useRef<number | null>(null);
  const studentPipelineSaveInFlightRef = useRef(false);
  const adminPipelineSaveInFlightRef = useRef(false);
  const studentVirtualSaveInFlightRef = useRef(false);
  const adminVirtualSaveInFlightRef = useRef(false);
  const studentVirtualAutosaveTimerRef = useRef<number | null>(null);
  const adminVirtualAutosaveTimerRef = useRef<number | null>(null);
  const studentVirtualMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const adminVirtualMutationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const reportBackgroundError = useCallback((context: string, error: unknown) => {
    const message = toErrorMessage(error);
    console.warn(`[EPL UI background] ${context}: ${message}`);
  }, []);

  const markWsActivity = useCallback(() => {
    wsLastActivityAtRef.current = Date.now();
  }, []);

  const pushToast = useCallback((text: string) => {
    const toastId = nextToastIdRef.current;
    nextToastIdRef.current += 1;

    setToasts((previous) => {
      const next = [...previous, { id: toastId, text }];
      if (next.length > 4) {
        return next.slice(next.length - 4);
      }
      return next;
    });
  }, []);

  const dismissToast = useCallback((toastId: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
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
      let changed = false;
      const next = { ...previous };
      for (const event of events) {
        const key = eventFeedKey(event);
        if (next[key]) {
          continue;
        }
        next[key] = true;
        changed = true;
      }
      return changed ? next : previous;
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
      MAX_FEED_SOURCE_EVENTS
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
        const nextFeed = mergeEventsBounded(previous.events, deferredEvents, MAX_FEED_SOURCE_EVENTS);
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
    adminPipelineGroupKeyRef.current = adminPipelineGroupKey;
  }, [adminPipelineGroupKey]);

  useEffect(() => {
    adminDataRef.current = adminData;
  }, [adminData]);

  useEffect(() => {
    if (adminPage !== 'feed') {
      return;
    }
    if (adminFeedSource !== 'AFTER_PIPELINE') {
      return;
    }
    setAdminFeedSource('AFTER_DISTURBANCES');
  }, [adminFeedSource, adminPage]);

  useEffect(() => {
    if (!isAdminFeedHotPage(adminPage)) {
      return;
    }
    flushDeferredAdminFeedEvents(adminPage === 'feed');
  }, [adminPage, flushDeferredAdminFeedEvents]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || adminPage !== 'streamSources') {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const sources = sortExternalStreamSources(await api.adminStreamSources(token));
        if (cancelled) {
          return;
        }
        setAdminStreamSources(sources);
        setAdminStreamSourceEndpointDrafts((previous) => endpointDraftsFromSources(sources, previous));
      } catch (error) {
        reportBackgroundError('adminStreamSources', error);
      }
    };

    void refresh();
    const timerId = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [adminPage, reportBackgroundError, session?.role, token]);

  useEffect(() => {
    if (adminPage !== 'devices') {
      return;
    }
    const initialEvents = adminDataRef.current?.events ?? [];
    if (initialEvents.length > 0) {
      const initialSnapshots = buildDeviceTelemetrySnapshots(initialEvents);
      if (Object.keys(initialSnapshots).length > 0) {
        setAdminDeviceSnapshots((previous) => mergeTelemetrySnapshotCache(previous, initialSnapshots));
      }
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        STUDENT_PIPELINE_SIMPLIFIED_STORAGE_KEY,
        studentPipelineSimplifiedView ? 'true' : 'false'
      );
    } catch {
      // Ignore storage failures; this preference is best-effort.
    }
  }, [studentPipelineSimplifiedView]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        ADMIN_PIPELINE_SIMPLIFIED_STORAGE_KEY,
        adminPipelineSimplifiedView ? 'true' : 'false'
      );
    } catch {
      // Ignore storage failures; this preference is best-effort.
    }
  }, [adminPipelineSimplifiedView]);

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
    setDisplayNameDraft('');
    setStudentTopicFilter('');
    setStudentShowInternal(false);
    setStudentFeedSource('BEFORE_PIPELINE');
    studentFeedSourceManualRef.current = false;
    setStudentFeedPaused(false);
    setStudentPipelineFeed([]);
    setStudentOnboardingDone(false);
    setStudentPipeline(null);
    setStudentPipelineDraft(null);
    setStudentPipelineSinkDraft(null);
    setStudentDeviceStatesById({});
    setStudentMqttModalOpen(false);
    setStudentMqttComposerMode('guided');
    setStudentMqttEventDraft(createMqttEventDraft());

    setAdminData(null);
    setAdminSystemStatus(null);
    setAdminStreamSources([]);
    setAdminStreamSourceEndpointDrafts({});
    setAdminTopicFilter('');
    setAdminIncludeInternal(false);
    setAdminFeedSource('AFTER_DISTURBANCES');
    setAdminFeedPaused(false);
    setAdminPipelineFeed([]);
    setAdminSettingsDraftMode('BROWSER_EN_FALLBACK');
    setAdminSettingsDraftTimeFormat24h(true);
    setAdminSettingsDraftVirtualVisible(true);
    setAdminSettingsDraftAdminDeviceId(null);
    setAdminSettingsDraftVirtualDeviceTopicMode('OWN_TOPIC');
    setAdminDeviceSnapshots({});
    setAdminDeviceIpById({});
    setAdminPipeline(null);
    setAdminPipelineDraft(null);
    setAdminPipelineGroupKey('');
    setAdminPipelineGroupContextKey(null);
    setAdminPipelineLogModeStatus(null);
    setAdminPipelineReplayFromOffset('');
    setAdminPipelineReplayMaxRecords(200);
    setAdminPipelineReplayResult(null);
    setAdminPipelineTaskId('');
    setAdminTaskPipelineConfig(null);
    setAdminTaskPipelineConfigDraft(null);
    setAdminPipelineCompareRows([]);
    adminPipelineGroupKeyRef.current = '';
    setStudentVirtualPatch(null);
    setVirtualControlDeviceId(null);
    setVirtualControlPatch(null);
    setCounterResetTarget(null);
    setResetEventsModalOpen(false);
    setPinEditorDeviceId(null);
    setPinEditorValue('');
    setPinEditorLoading(false);
    setMqttModalOpen(false);
    setMqttComposerMode('guided');
    setMqttEventDraft(createMqttEventDraft());
    setAdminPage('dashboard');
    setSystemDataExportSelection(createSystemDataPartSelection(true));
    setSystemDataImportFileName('');
    setSystemDataImportFile(null);
    setSystemDataImportVerify(null);
    setSystemDataImportSelection(createSystemDataPartSelection(false));
    setFeedScenarioConfig(null);
    setFeedScenarioDraft([]);
    setFeedScenarioStudentDeviceViewDisturbedDraft(false);
    setStudentSettingsOpen(false);
    setAdminPasswordModalOpen(false);
    setAdminPasswordCurrent('');
    setAdminPasswordNext('');
    setAdminPasswordConfirm('');
    setAdminPasswordError(null);
    setAboutModalOpen(false);
    setToasts([]);
    adminDataRef.current = null;
    deferredAdminFeedRef.current = [];
    studentVirtualMutationQueueRef.current = Promise.resolve();
    adminVirtualMutationQueueRef.current = Promise.resolve();
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
      if (sameGroupOverviewList(previous.groups, groups)) {
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
      if (
        previous.tasks.length === tasks.length &&
        previous.tasks.every((task, index) => sameTaskInfo(task, tasks[index]))
      ) {
        return previous;
      }
      return { ...previous, tasks };
    });
  }, []);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || adminPage !== 'groups') {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        await refreshAdminGroups(token);
      } catch (error) {
        if (!cancelled) {
          reportBackgroundError('adminGroups', error);
        }
      }
    };

    void refresh();
    const timerId = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [adminPage, refreshAdminGroups, reportBackgroundError, session?.role, token]);

  const loadAdminPipelineForGroup = useCallback(
    async (groupKey: string) => {
      if (!token) {
        return;
      }
      if (!groupKey) {
        setAdminPipeline(null);
        setAdminPipelineDraft(null);
        return;
      }

      setBusyKey('admin-pipeline-load');
      setErrorMessage(null);
      try {
        const view = normalizePipelineView(await api.adminPipeline(token, groupKey));
        setAdminPipeline(view);
        setAdminPipelineDraft(view);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
    },
    [token]
  );

  const loadAdminTaskPipelineConfig = useCallback(
    async (taskId: string) => {
      if (!token || !taskId) {
        setAdminTaskPipelineConfig(null);
        setAdminTaskPipelineConfigDraft(null);
        return;
      }

      setBusyKey('admin-task-pipeline-config-load');
      setErrorMessage(null);
      try {
        const config = await api.adminTaskPipelineConfig(token, taskId);
        setAdminTaskPipelineConfig(config);
        setAdminTaskPipelineConfigDraft(config);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
    },
    [token]
  );

  const loadAdminPipelineCompare = useCallback(async () => {
    if (!token) {
      setAdminPipelineCompareRows([]);
      return;
    }
    try {
      const rows = await api.adminPipelineCompare(token);
      setAdminPipelineCompareRows(rows);
    } catch (error) {
      reportBackgroundError('adminPipelineCompare', error);
    }
  }, [reportBackgroundError, token]);

  const loadAdminPipelineLogModeStatus = useCallback(async () => {
    if (!token) {
      setAdminPipelineLogModeStatus(null);
      return;
    }
    try {
      const status = await api.adminPipelineLogModeStatus(token);
      setAdminPipelineLogModeStatus(status);
      setAdminPipelineReplayMaxRecords((previous) => {
        if (previous > 0) {
          return previous;
        }
        return status.replayDefaultMaxRecords;
      });
    } catch (error) {
      reportBackgroundError('adminPipelineLogModeStatus', error);
    }
  }, [reportBackgroundError, token]);

  const loadDashboards = useCallback(async (auth: AuthMe, activeToken: string) => {
    if (auth.role === 'STUDENT') {
      const [bootstrap, pipelineRaw, scenarios, pipelineEvents] = await Promise.all([
        api.studentBootstrap(activeToken),
        api.studentPipeline(activeToken),
        api.scenarios(activeToken),
        api.eventsFeed(activeToken, { limit: MAX_FEED_SOURCE_EVENTS, includeInternal: true, stage: 'AFTER_PIPELINE' })
      ]);
      const pipeline = normalizePipelineView(pipelineRaw);
      setStudentData({
        activeTask: bootstrap.activeTask,
        capabilities: bootstrap.capabilities,
        groupConfig: bootstrap.groupConfig,
        groupPresence: bootstrap.groupPresence,
        feed: clampFeed(bootstrap.recentFeed),
        virtualDevice: bootstrap.virtualDevice,
        settings: bootstrap.settings
      });
      setStudentPipelineFeed(clampFeed(pipelineEvents));
      setDisplayNameDraft(bootstrap.me.displayName);
      setStudentVirtualPatch(bootstrap.virtualDevice ? patchFromVirtualDevice(bootstrap.virtualDevice) : null);
      setStudentOnboardingDone(false);
      setDefaultLanguageMode(bootstrap.settings.defaultLanguageMode);
      setTimeFormat24h(bootstrap.settings.timeFormat24h);
      setStudentPipeline(pipeline);
      setStudentPipelineDraft(pipeline.processing);
      setStudentPipelineSinkDraft(pipeline.sink);
      setFeedScenarioConfig(scenarios);
      return;
    }

    const logModeStatusPromise = api.adminPipelineLogModeStatus(activeToken).catch(() => null);
    const [tasks, devices, virtualDevices, groups, settings, streamSources, events, pipelineEvents, systemStatus, logModeStatus, scenarios] = await Promise.all([
      api.adminTasks(activeToken),
      api.adminDevices(activeToken),
      api.adminVirtualDevices(activeToken),
      api.adminGroups(activeToken),
      api.adminSettings(activeToken),
      api.adminStreamSources(activeToken),
      api.eventsFeed(activeToken, { limit: MAX_FEED_SOURCE_EVENTS, includeInternal: true }),
      api.eventsFeed(activeToken, { limit: MAX_FEED_SOURCE_EVENTS, includeInternal: true, stage: 'AFTER_PIPELINE' }),
      api.adminSystemStatus(activeToken),
      logModeStatusPromise,
      api.adminScenarios(activeToken)
    ]);

    setAdminData({
      tasks,
      devices,
      virtualDevices,
      groups,
      settings,
      events: clampFeed(events)
    });
    setAdminPipelineFeed(clampFeed(pipelineEvents));
    deferredAdminFeedRef.current = [];
    setAdminSettingsDraftMode(settings.defaultLanguageMode);
    setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
    setAdminSettingsDraftVirtualVisible(settings.studentVirtualDeviceVisible);
    setAdminSettingsDraftAdminDeviceId(settings.adminDeviceId);
    setAdminSettingsDraftVirtualDeviceTopicMode(settings.virtualDeviceTopicMode);
    setDefaultLanguageMode(settings.defaultLanguageMode);
    setTimeFormat24h(settings.timeFormat24h);
    setAdminSystemStatus(systemStatus);
    const sortedStreamSources = sortExternalStreamSources(streamSources);
    setAdminStreamSources(sortedStreamSources);
    setAdminStreamSourceEndpointDrafts(endpointDraftsFromSources(sortedStreamSources, {}));
    setAdminPipelineLogModeStatus(logModeStatus);
    setAdminPipelineReplayFromOffset('');
    setAdminPipelineReplayMaxRecords(logModeStatus?.replayDefaultMaxRecords ?? 200);
    setAdminPipelineReplayResult(null);
    setAdminPage('dashboard');
    setFeedScenarioConfig(scenarios);

    const initialGroupKey = settings.adminDeviceId?.trim() ?? '';
    const initialTaskId = tasks.find((task) => task.active)?.id ?? tasks[0]?.id ?? '';
    setAdminPipelineGroupKey(initialGroupKey);
    setAdminPipelineGroupContextKey(null);
    setAdminPipelineTaskId(initialTaskId);
    adminPipelineGroupKeyRef.current = initialGroupKey;

    const pipelinePromise = initialGroupKey
      ? api.adminPipeline(activeToken, initialGroupKey)
      : Promise.resolve<PipelineView | null>(null);
    const taskConfigPromise = initialTaskId
      ? api.adminTaskPipelineConfig(activeToken, initialTaskId)
      : Promise.resolve<TaskPipelineConfig | null>(null);
    const comparePromise = api.adminPipelineCompare(activeToken);

    const [pipelineRaw, taskConfig, compareRows] = await Promise.all([
      pipelinePromise,
      taskConfigPromise,
      comparePromise
    ]);
    const pipeline = pipelineRaw ? normalizePipelineView(pipelineRaw) : null;

    setAdminPipeline(pipeline);
    setAdminPipelineDraft(pipeline);
    setAdminTaskPipelineConfig(taskConfig);
    setAdminTaskPipelineConfigDraft(taskConfig);
    setAdminPipelineCompareRows(compareRows);
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
    if (!studentPipelineSimplifiedView || !studentShowInternal) {
      return;
    }
    setStudentShowInternal(false);
  }, [studentPipelineSimplifiedView, studentShowInternal]);

  useEffect(() => {
    if (!adminPipelineSimplifiedView || !adminIncludeInternal) {
      return;
    }
    setAdminIncludeInternal(false);
  }, [adminIncludeInternal, adminPipelineSimplifiedView]);

  useEffect(() => {
    if (studentData?.capabilities.studentSendEventEnabled) {
      return;
    }
    setStudentMqttModalOpen(false);
  }, [studentData?.capabilities.studentSendEventEnabled]);

  const studentCommandTargetScope = normalizeStudentDeviceScope(
    studentData?.capabilities.studentCommandTargetScope
  );
  const studentDeviceViewDisturbed = Boolean(feedScenarioConfig?.studentDeviceViewDisturbed);
  const studentOwnDeviceId = (session?.groupKey ?? '').trim();
  const studentAdminDeviceId = (studentData?.settings.adminDeviceId ?? '').trim();
  const studentSendEventTargetTypeOptions = useMemo<MqttComposerTargetType[]>(
    () => (
      studentCommandTargetScope === 'ALL_DEVICES'
        ? (['physical', 'custom'] as MqttComposerTargetType[])
        : (['physical'] as MqttComposerTargetType[])
    ),
    [studentCommandTargetScope]
  );
  const studentAllowedPhysicalTargetIds = useMemo(
    () => allowedPhysicalTargetsForScope(
      studentCommandTargetScope,
      studentOwnDeviceId,
      studentAdminDeviceId
    ),
    [studentAdminDeviceId, studentCommandTargetScope, studentOwnDeviceId]
  );
  const studentSelectedTopicPrefixDeviceId = useMemo(
    () => normalizeTopicPrefixDeviceId(studentMqttEventDraft.deviceId),
    [studentMqttEventDraft.deviceId]
  );
  const studentSelectedDeviceStateBase = studentOwnDeviceId
    ? studentDeviceStatesById[studentOwnDeviceId] ?? null
    : null;

  const studentActiveTaskId = studentData?.activeTask.id ?? '';
  const hasStudentData = studentData !== null;
  const studentPipelineDraftSig = useMemo(
    () => pipelineStudentDraftSignature(studentPipelineDraft, studentPipelineSinkDraft),
    [studentPipelineDraft, studentPipelineSinkDraft]
  );
  const studentPipelineSavedSig = useMemo(
    () => (studentPipeline ? pipelineStudentDraftSignature(studentPipeline.processing, studentPipeline.sink) : 'null'),
    [studentPipeline]
  );
  const studentPipelineEditorView = useMemo<PipelineView | null>(() => {
    if (!studentPipeline) {
      return null;
    }
    return {
      ...studentPipeline,
      processing: studentPipelineDraft ?? studentPipeline.processing,
      sink: studentPipelineSinkDraft ?? studentPipeline.sink
    };
  }, [studentPipeline, studentPipelineDraft, studentPipelineSinkDraft]);
  const studentPipelineEnabled = studentPipelineEditorView?.permissions.visible === true;
  const adminPipelineEditorView = adminPipelineDraft ?? adminPipeline;
  const adminPipelineDraftSig = useMemo(
    () => pipelineAdminDraftSignature(adminPipelineDraft),
    [adminPipelineDraft]
  );
  const adminPipelineSavedSig = useMemo(
    () => pipelineAdminDraftSignature(adminPipeline),
    [adminPipeline]
  );

  useEffect(() => {
    if (!studentPipelineEnabled) {
      if (studentFeedSource !== 'BEFORE_PIPELINE') {
        setStudentFeedSource('BEFORE_PIPELINE');
      }
      studentFeedSourceManualRef.current = false;
      return;
    }
    if (studentPipelineSimplifiedView) {
      if (studentFeedSource !== 'AFTER_PIPELINE') {
        setStudentFeedSource('AFTER_PIPELINE');
      }
      studentFeedSourceManualRef.current = false;
      return;
    }
    if (studentFeedSourceManualRef.current) {
      return;
    }
    if (studentFeedSource !== 'AFTER_PIPELINE') {
      setStudentFeedSource('AFTER_PIPELINE');
    }
  }, [studentFeedSource, studentPipelineEnabled, studentPipelineSimplifiedView]);

  const setStudentFeedSourceFromUi = useCallback((value: StudentFeedSource) => {
    studentFeedSourceManualRef.current = true;
    setStudentFeedSource(value);
  }, []);

  useEffect(() => {
    if (!token || session?.role !== 'STUDENT' || !hasStudentData) {
      return;
    }

    let cancelled = false;
    api.studentPipeline(token)
      .then((view) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizePipelineView(view);
        setStudentPipeline(normalized);
        setStudentPipelineDraft(normalized.processing);
        setStudentPipelineSinkDraft(normalized.sink);
      })
      .catch((error) => reportBackgroundError('studentPipeline', error));

    return () => {
      cancelled = true;
    };
  }, [token, session?.role, hasStudentData, studentActiveTaskId, reportBackgroundError]);

  const adminGroupKeysSignature = useMemo(
    () => (adminData?.groups ?? []).map((group) => group.groupKey).join('|'),
    [adminData?.groups]
  );
  const adminTaskIdsSignature = useMemo(
    () => (adminData?.tasks ?? []).map((task) => task.id).join('|'),
    [adminData?.tasks]
  );
  const adminTaskActivitySignature = useMemo(
    () => (adminData?.tasks ?? []).map((task) => `${task.id}:${task.active}`).join('|'),
    [adminData?.tasks]
  );
  const adminGroups = useMemo(() => adminData?.groups ?? [], [adminData?.groups]);
  const adminTasks = useMemo(() => adminData?.tasks ?? [], [adminData?.tasks]);
  const adminConfiguredPipelineDevice = useMemo(
    () => adminData?.settings.adminDeviceId?.trim() ?? '',
    [adminData?.settings.adminDeviceId]
  );
  const adminDefaultPipelineGroupKey = useMemo(() => {
    return adminConfiguredPipelineDevice;
  }, [adminConfiguredPipelineDevice]);
  const hasAdminData = adminData !== null;

  useEffect(() => {
    const isGroupContextValid = !adminPipelineGroupContextKey
      || adminGroups.some((group) => group.groupKey === adminPipelineGroupContextKey);
    const resolvedGroupContextKey = isGroupContextValid ? adminPipelineGroupContextKey : null;
    const targetGroupKey = resolvedGroupContextKey
      ? resolvedGroupContextKey
      : adminDefaultPipelineGroupKey;

    if (!isGroupContextValid && adminPipelineGroupContextKey !== null) {
      setAdminPipelineGroupContextKey(null);
    }

    if (!targetGroupKey) {
      if (adminPipelineGroupKey !== '') {
        setAdminPipelineGroupKey('');
      }
      adminPipelineGroupKeyRef.current = '';
      setAdminPipeline(null);
      setAdminPipelineDraft(null);
      return;
    }

    if (adminPipelineGroupKey !== targetGroupKey) {
      setAdminPipelineGroupKey(targetGroupKey);
      adminPipelineGroupKeyRef.current = targetGroupKey;
      void loadAdminPipelineForGroup(targetGroupKey);
    }
  }, [
    adminDefaultPipelineGroupKey,
    adminGroups,
    adminPipelineGroupContextKey,
    adminPipelineGroupKey,
    loadAdminPipelineForGroup
  ]);

  useEffect(() => {
    const taskIds = adminTasks.map((task) => task.id);
    if (taskIds.length === 0) {
      setAdminPipelineTaskId('');
      setAdminTaskPipelineConfig(null);
      setAdminTaskPipelineConfigDraft(null);
      return;
    }
    if (!adminPipelineTaskId || !taskIds.includes(adminPipelineTaskId)) {
      const activeTaskId = adminTasks.find((task) => task.active)?.id ?? taskIds[0];
      setAdminPipelineTaskId(activeTaskId);
      void loadAdminTaskPipelineConfig(activeTaskId);
    }
  }, [adminTaskIdsSignature, adminTasks, adminPipelineTaskId, loadAdminTaskPipelineConfig]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !adminPipelineGroupKey || !hasAdminData) {
      return;
    }
    void loadAdminPipelineForGroup(adminPipelineGroupKey);
  }, [
    token,
    session?.role,
    hasAdminData,
    adminPipelineGroupKey,
    adminTaskActivitySignature,
    loadAdminPipelineForGroup
  ]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !adminPipelineTaskId || !hasAdminData) {
      return;
    }
    void loadAdminTaskPipelineConfig(adminPipelineTaskId);
  }, [token, session?.role, adminPipelineTaskId, hasAdminData, loadAdminTaskPipelineConfig]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !hasAdminData) {
      return;
    }
    void loadAdminPipelineCompare();
  }, [
    token,
    session?.role,
    hasAdminData,
    adminGroupKeysSignature,
    adminTaskActivitySignature,
    loadAdminPipelineCompare
  ]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !hasAdminData) {
      return;
    }
    void loadAdminPipelineLogModeStatus();
  }, [token, session?.role, hasAdminData, loadAdminPipelineLogModeStatus]);

  useEffect(() => {
    const virtualDevice = studentData?.virtualDevice;
    if (!virtualDevice) {
      setStudentVirtualPatch(null);
      return;
    }
    setStudentVirtualPatch((previous) => {
      if (!previous) {
        return patchFromVirtualDevice(virtualDevice);
      }
      return previous;
    });
  }, [studentData?.virtualDevice]);

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
    if (!counterResetTarget) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCounterResetTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [counterResetTarget]);

  useEffect(() => {
    if (!resetEventsModalOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setResetEventsModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [resetEventsModalOpen]);

  useEffect(() => {
    if (!pinEditorDeviceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinEditorDeviceId(null);
        setPinEditorValue('');
        setPinEditorLoading(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pinEditorDeviceId]);

  useEffect(() => {
    if (!virtualControlDeviceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVirtualControlDeviceId(null);
        setVirtualControlPatch(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [virtualControlDeviceId]);

  useEffect(() => {
    if (!mqttModalOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMqttModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mqttModalOpen]);

  useEffect(() => {
    if (!studentMqttModalOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setStudentMqttModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [studentMqttModalOpen]);

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
    const adminDevices = adminData?.devices;
    const adminEvents = adminData?.events;
    if (!adminDevices || !adminEvents || adminPage !== 'devices') {
      return;
    }

    const latestIpByDeviceId: Record<string, string> = {};
    for (const device of adminDevices) {
      const ipAddress = extractIpAddressFromDeviceStatus(device, adminEvents);
      if (ipAddress) {
        latestIpByDeviceId[device.deviceId] = ipAddress;
      }
    }
    setAdminDeviceIpById((previous) =>
      mergeIpAddressCache(
        previous,
        latestIpByDeviceId,
        adminDevices.map((device) => device.deviceId)
      )
    );
  }, [adminData?.devices, adminPage]);

  useEffect(() => {
    const adminDevices = adminData?.devices;
    if (!adminDevices || adminPage !== 'devices') {
      return;
    }

    const latestWifiIpByDeviceId: Record<string, string> = {};
    for (const device of adminDevices) {
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
        adminDevices.map((device) => device.deviceId)
      )
    );
  }, [adminData?.devices, adminPage]);

  useAdminSystemStatusPolling({
    token,
    role: session?.role ?? null,
    adminPage,
    reportBackgroundError,
    setAdminSystemStatus
  });

  const applyStudentPipelineFromWs = useCallback((view: PipelineView) => {
    const normalizedView = normalizePipelineView(view);
    setStudentPipeline((previous) => {
      if (
        previous &&
        previous.taskId === normalizedView.taskId &&
        previous.groupKey === normalizedView.groupKey &&
        previous.revision === normalizedView.revision
      ) {
        return previous;
      }
      return normalizedView;
    });
    setStudentPipelineDraft(normalizedView.processing);
    setStudentPipelineSinkDraft(normalizedView.sink);
  }, []);

  const applyStudentPipelineObservabilityFromWs = useCallback((update: PipelineObservabilityUpdate) => {
    setStudentPipeline((previous) => {
      if (!previous) {
        return previous;
      }
      if (previous.groupKey !== update.groupKey || previous.taskId !== update.taskId) {
        return previous;
      }
      return {
        ...previous,
        observability: update.observability
      };
    });
  }, []);

  const applyStudentPipelineSinkRuntimeFromWs = useCallback((update: PipelineSinkRuntimeUpdate) => {
    setStudentPipeline((previous) => {
      if (!previous) {
        return previous;
      }
      return applyPipelineSinkRuntimeUpdate(previous, update);
    });
  }, []);

  const applyAdminPipelineFromWs = useCallback((view: PipelineView) => {
    const normalizedView = normalizePipelineView(view);
    setAdminPipeline((previous) => {
      if (
        previous &&
        previous.taskId === normalizedView.taskId &&
        previous.groupKey === normalizedView.groupKey &&
        previous.revision === normalizedView.revision
      ) {
        return previous;
      }
      return normalizedView;
    });
    setAdminPipelineDraft(normalizedView);
  }, []);

  const applyAdminPipelineObservabilityFromWs = useCallback(
    (update: PipelineObservabilityUpdate, selectedGroupKey: string) => {
      if (update.groupKey !== selectedGroupKey) {
        return;
      }
      setAdminPipeline((previous) => {
        if (!previous) {
          return previous;
        }
        if (previous.groupKey !== update.groupKey || previous.taskId !== update.taskId) {
          return previous;
        }
        return {
          ...previous,
          observability: update.observability
        };
      });
      setAdminPipelineDraft((previous) => {
        if (!previous) {
          return previous;
        }
        if (previous.groupKey !== update.groupKey || previous.taskId !== update.taskId) {
          return previous;
        }
        return {
          ...previous,
          observability: update.observability
        };
      });
    },
    []
  );

  const applyAdminPipelineSinkRuntimeFromWs = useCallback(
    (update: PipelineSinkRuntimeUpdate, selectedGroupKey: string) => {
      if (update.groupKey !== selectedGroupKey) {
        return;
      }
      setAdminPipeline((previous) => {
        if (!previous) {
          return previous;
        }
        return applyPipelineSinkRuntimeUpdate(previous, update);
      });
      setAdminPipelineDraft((previous) => {
        if (!previous) {
          return previous;
        }
        return applyPipelineSinkRuntimeUpdate(previous, update);
      });
    },
    []
  );

  const applyAdminPipelineObservedFromWs = useCallback((view: PipelineView, selectedGroupKey: string) => {
    const normalizedView = normalizePipelineView(view);
    setAdminPipelineCompareRows((previous) => {
      const nextRow: PipelineCompareRow = {
        taskId: normalizedView.taskId,
        groupKey: normalizedView.groupKey,
        revision: normalizedView.revision,
        updatedAt: normalizedView.updatedAt,
        updatedBy: normalizedView.updatedBy,
        slotBlocks: Array.from({ length: normalizedView.processing.slotCount }).map((_, index) => {
          const slot = normalizedView.processing.slots.find((entry) => entry.index === index);
          return slot?.blockType ?? 'NONE';
        })
      };

      const existingIndex = previous.findIndex((row) => row.groupKey === normalizedView.groupKey);
      const next = existingIndex >= 0
        ? previous.map((row, index) => (index === existingIndex ? nextRow : row))
        : [...previous, nextRow];

      return [...next].sort((left, right) => left.groupKey.localeCompare(right.groupKey));
    });

    if (normalizedView.groupKey === selectedGroupKey) {
      setAdminPipeline(normalizedView);
      setAdminPipelineDraft(normalizedView);
    }
  }, []);

  useRealtimeSync({
    session,
    token,
    markWsActivity,
    studentPauseRef,
    adminPauseRef,
    adminDataRef,
    adminPageRef,
    reportBackgroundError,
    refreshAdminGroups,
    refreshAdminTasks,
    markFeedEventsRecent,
    queueDeferredAdminFeedEvents,
    flushDeferredAdminFeedEvents,
    setWsConnection,
    setErrorMessage,
    setStudentData,
    setStudentDeviceStatesById,
    setStudentPipelineFeed,
    setStudentVirtualPatch,
    setAdminData,
    setAdminPipelineFeed,
    setAdminDeviceSnapshots,
    setAdminDeviceIpById,
    setAdminSettingsDraftMode,
    setAdminSettingsDraftTimeFormat24h,
    setAdminSettingsDraftVirtualVisible,
    setAdminSettingsDraftAdminDeviceId,
    setAdminSettingsDraftVirtualDeviceTopicMode,
    setDefaultLanguageMode,
    setTimeFormat24h,
    setFeedScenarioConfig,
    selectedAdminPipelineGroupKeyRef: adminPipelineGroupKeyRef,
    onStudentPipelineUpdated: applyStudentPipelineFromWs,
    onStudentPipelineObservabilityUpdated: applyStudentPipelineObservabilityFromWs,
    onStudentPipelineSinkRuntimeUpdated: applyStudentPipelineSinkRuntimeFromWs,
    onAdminPipelineUpdated: applyAdminPipelineFromWs,
    onAdminPipelineObservabilityUpdated: applyAdminPipelineObservabilityFromWs,
    onAdminPipelineSinkRuntimeUpdated: applyAdminPipelineSinkRuntimeFromWs,
    onAdminPipelineObserved: applyAdminPipelineObservedFromWs
  });

  useEffect(() => {
    if (!session || !token) {
      return;
    }
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      if (now - wsLastActivityAtRef.current < 6000) {
        return;
      }
      if (wsBackfillInFlightRef.current || now - wsBackfillLastRunAtRef.current < 5000) {
        return;
      }
      if (session.role === 'STUDENT' && studentPauseRef.current) {
        return;
      }
      if (session.role === 'ADMIN' && adminPauseRef.current) {
        return;
      }

      wsBackfillInFlightRef.current = true;
      wsBackfillLastRunAtRef.current = now;
      const limit = 120;

      if (session.role === 'STUDENT') {
        Promise.all([
          api.eventsFeed(token, { limit, includeInternal: true, stage: 'BEFORE_PIPELINE' }),
          api.eventsFeed(token, { limit, includeInternal: true, stage: 'AFTER_PIPELINE' })
        ])
          .then(([beforePipeline, afterPipeline]) => {
            if (beforePipeline.length > 0) {
              setStudentData((previous) => {
                if (!previous) {
                  return previous;
                }
                const nextFeed = mergeEventsBounded(previous.feed, beforePipeline, MAX_FEED_SOURCE_EVENTS);
                if (nextFeed === previous.feed) {
                  return previous;
                }
                return {
                  ...previous,
                  feed: nextFeed
                };
              });
            }
            if (afterPipeline.length > 0) {
              setStudentPipelineFeed((previous) =>
                mergeEventsBounded(previous, afterPipeline, MAX_FEED_SOURCE_EVENTS)
              );
            }
          })
          .catch((error) => reportBackgroundError('wsBackfill.student', error))
          .finally(() => {
            wsBackfillInFlightRef.current = false;
          });
        return;
      }

      Promise.all([
        api.eventsFeed(token, { limit, includeInternal: true, stage: 'BEFORE_PIPELINE' }),
        api.eventsFeed(token, { limit, includeInternal: true, stage: 'AFTER_PIPELINE' })
      ])
        .then(([beforePipeline, afterPipeline]) => {
          if (beforePipeline.length > 0) {
            setAdminData((previous) => {
              if (!previous) {
                return previous;
              }
              const nextFeed = mergeEventsBounded(previous.events, beforePipeline, MAX_FEED_SOURCE_EVENTS);
              if (nextFeed === previous.events) {
                return previous;
              }
              return {
                ...previous,
                events: nextFeed
              };
            });
          }
          if (afterPipeline.length > 0) {
            setAdminPipelineFeed((previous) =>
              mergeEventsBounded(previous, afterPipeline, MAX_FEED_SOURCE_EVENTS)
            );
          }
        })
        .catch((error) => reportBackgroundError('wsBackfill.admin', error))
        .finally(() => {
          wsBackfillInFlightRef.current = false;
        });
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [reportBackgroundError, session, token]);

  useEffect(() => {
    if (!feedScenarioConfig) {
      setFeedScenarioDraft([]);
      setFeedScenarioStudentDeviceViewDisturbedDraft(false);
      return;
    }
    setFeedScenarioDraft(feedScenarioConfig.scenarioOverlays);
    setFeedScenarioStudentDeviceViewDisturbedDraft(Boolean(feedScenarioConfig.studentDeviceViewDisturbed));
  }, [feedScenarioConfig]);

  const adminPhysicalDeviceIds = useMemo(() => {
    return adminData?.devices.map((entry) => entry.deviceId) ?? [];
  }, [adminData?.devices]);

  const adminVirtualDeviceIds = useMemo(() => {
    return adminData?.virtualDevices.map((entry) => entry.deviceId) ?? [];
  }, [adminData?.virtualDevices]);

  const guidedMqttMessage = useMemo(() => {
    return buildGuidedMqttMessage(mqttEventDraft);
  }, [mqttEventDraft]);
  const guidedStudentMqttMessage = useMemo(() => {
    return buildGuidedMqttMessage(studentMqttEventDraft);
  }, [studentMqttEventDraft]);

  useEffect(() => {
    if (mqttComposerMode !== 'guided') {
      return;
    }
    setMqttEventDraft((previous) => {
      if (
        previous.rawTopic === guidedMqttMessage.topic &&
        previous.rawPayload === guidedMqttMessage.payload
      ) {
        return previous;
      }
      return {
        ...previous,
        rawTopic: guidedMqttMessage.topic,
        rawPayload: guidedMqttMessage.payload
      };
    });
  }, [guidedMqttMessage.payload, guidedMqttMessage.topic, mqttComposerMode]);

  useEffect(() => {
    if (studentMqttComposerMode !== 'guided') {
      return;
    }
    setStudentMqttEventDraft((previous) => {
      if (
        previous.rawTopic === guidedStudentMqttMessage.topic &&
        previous.rawPayload === guidedStudentMqttMessage.payload
      ) {
        return previous;
      }
      return {
        ...previous,
        rawTopic: guidedStudentMqttMessage.topic,
        rawPayload: guidedStudentMqttMessage.payload
      };
    });
  }, [guidedStudentMqttMessage.payload, guidedStudentMqttMessage.topic, studentMqttComposerMode]);

  const handleLogin = async () => {
    setBusyKey('login');
    setErrorMessage(null);

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
      pushToast(t('displayNameSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const continueStudentOnboarding = async () => {
    if (!token || !session || session.role !== 'STUDENT') {
      return;
    }

    const nextDisplayName = displayNameDraft.trim();
    if (nextDisplayName.length === 0) {
      setErrorMessage(t('onboardingNameRequired'));
      return;
    }

    setBusyKey('student-onboarding');
    setErrorMessage(null);

    try {
      if (nextDisplayName !== session.displayName) {
        const updated = await api.updateDisplayName(token, nextDisplayName);
        setSession(updated);
        setDisplayNameDraft(updated.displayName);
      }
      setStudentOnboardingDone(true);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveStudentPipeline = useCallback(async () => {
    if (!token || !studentPipelineDraft || !studentPipelineSinkDraft) {
      return;
    }
    if (studentPipelineSaveInFlightRef.current) {
      return;
    }

    const currentDraftSig = pipelineStudentDraftSignature(studentPipelineDraft, studentPipelineSinkDraft);
    if (currentDraftSig === studentPipelineSavedSig) {
      return;
    }

    studentPipelineSaveInFlightRef.current = true;
    const sentProcessing = studentPipelineDraft;
    const sentSink = studentPipelineSinkDraft;
    const sentProcessingSig = processingSectionSignature(sentProcessing);
    const sentSinkSig = sinkSectionSignature(sentSink);

    try {
      const updated = normalizePipelineView(await api.updateStudentPipeline(
        token,
        sentProcessing,
        sentSink
      ));
      setStudentPipeline(updated);
      setStudentPipelineDraft((previous) => {
        if (!previous) {
          return updated.processing;
        }
        return processingSectionSignature(previous) === sentProcessingSig
          ? updated.processing
          : previous;
      });
      setStudentPipelineSinkDraft((previous) => {
        if (!previous) {
          return updated.sink;
        }
        return sinkSectionSignature(previous) === sentSinkSig
          ? updated.sink
          : previous;
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      studentPipelineSaveInFlightRef.current = false;
    }
  }, [token, studentPipelineDraft, studentPipelineSinkDraft, studentPipelineSavedSig]);

  const resetStudentPipelineState = async () => {
    if (!token || !studentPipeline) {
      return;
    }
    setBusyKey('student-pipeline-state');
    setErrorMessage(null);
    try {
      const updated = normalizePipelineView(await api.resetStudentPipelineState(token));
      setStudentPipeline(updated);
      setStudentPipelineDraft(updated.processing);
      setStudentPipelineSinkDraft(updated.sink);
      pushToast(t('pipelineStateResetDone'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const resetStudentPipelineSinkCounter = async (sinkId: string) => {
    if (!token || !studentPipeline || !sinkId.trim()) {
      return;
    }
    setBusyKey('student-pipeline-sink');
    setErrorMessage(null);
    try {
      const update = await api.resetStudentPipelineSinkCounter(token, sinkId.trim());
      setStudentPipeline((previous) => {
        if (!previous) {
          return previous;
        }
        return applyPipelineSinkRuntimeUpdate(previous, update);
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const changeStudentPipelineSlot = useCallback((slotIndex: number, blockType: string) => {
    setStudentPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return setPipelineSlotBlock(previous, slotIndex, blockType);
    });
  }, []);

  const swapStudentPipelineSlots = useCallback((sourceSlotIndex: number, targetSlotIndex: number) => {
    setStudentPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return swapPipelineSlots(previous, sourceSlotIndex, targetSlotIndex);
    });
  }, []);

  const changeStudentPipelineSlotConfig = useCallback((slotIndex: number, key: string, value: unknown) => {
    setStudentPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return setPipelineSlotConfigValue(previous, slotIndex, key, value);
    });
  }, []);

  const addStudentPipelineSink = useCallback((sinkType: 'SEND_EVENT' | 'VIRTUAL_SIGNAL' | 'SHOW_PAYLOAD') => {
    setStudentPipelineSinkDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return addPipelineSinkNode(previous, sinkType);
    });
  }, []);

  const removeStudentPipelineSink = useCallback((sinkId: string) => {
    setStudentPipelineSinkDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return removePipelineSinkNode(previous, sinkId);
    });
  }, []);

  const configureStudentPipelineSendSink = useCallback((sinkId: string, config: Record<string, unknown>) => {
    const configuredTopic = typeof config.topic === 'string' ? config.topic.trim() : '';
    const dynamicTopic = /^(\$\{deviceId\}|\{deviceId\}|DEVICE|OWN_DEVICE)(\/|$)/i.test(configuredTopic);
    if (
      configuredTopic.length > 0 &&
      !dynamicTopic &&
      !isTopicAllowedForStudentScope(
        studentCommandTargetScope,
        configuredTopic,
        studentOwnDeviceId,
        studentAdminDeviceId
      )
    ) {
      setErrorMessage(t('mqttTopicNotAllowedForTaskScope'));
      return;
    }
    setStudentPipelineSinkDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return updatePipelineSendEventSinkConfig(previous, sinkId, config);
    });
  }, [studentAdminDeviceId, studentCommandTargetScope, studentOwnDeviceId, t]);

  useEffect(() => {
    if (studentPipelineAutosaveTimerRef.current !== null) {
      window.clearTimeout(studentPipelineAutosaveTimerRef.current);
      studentPipelineAutosaveTimerRef.current = null;
    }
    if (
      !token
      || session?.role !== 'STUDENT'
      || !studentPipelineDraft
      || !studentPipelineSinkDraft
      || studentPipelineSavedSig === 'null'
    ) {
      return;
    }
    if (studentPipelineDraftSig === studentPipelineSavedSig) {
      return;
    }
    studentPipelineAutosaveTimerRef.current = window.setTimeout(() => {
      studentPipelineAutosaveTimerRef.current = null;
      void saveStudentPipeline();
    }, PIPELINE_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (studentPipelineAutosaveTimerRef.current !== null) {
        window.clearTimeout(studentPipelineAutosaveTimerRef.current);
        studentPipelineAutosaveTimerRef.current = null;
      }
    };
  }, [
    token,
    session?.role,
    studentPipelineDraft,
    studentPipelineSinkDraft,
    studentPipelineDraftSig,
    studentPipelineSavedSig,
    saveStudentPipeline
  ]);

  const openAdminDefaultPipelineBuilder = useCallback(() => {
    setAdminPage('pipeline');
    setAdminPipelineGroupContextKey(null);
    setAdminPipelineReplayResult(null);

    if (!adminDefaultPipelineGroupKey) {
      setAdminPipelineGroupKey('');
      adminPipelineGroupKeyRef.current = '';
      setAdminPipeline(null);
      setAdminPipelineDraft(null);
      return;
    }
    setAdminPipelineGroupKey(adminDefaultPipelineGroupKey);
    adminPipelineGroupKeyRef.current = adminDefaultPipelineGroupKey;
    void loadAdminPipelineForGroup(adminDefaultPipelineGroupKey);
  }, [adminDefaultPipelineGroupKey, loadAdminPipelineForGroup]);

  const openAdminPipelineBuilderForGroup = useCallback(
    (groupKey: string) => {
      setAdminPipelineGroupContextKey(groupKey);
      setAdminPipelineGroupKey(groupKey);
      adminPipelineGroupKeyRef.current = groupKey;
      setAdminPipelineReplayResult(null);
      void loadAdminPipelineForGroup(groupKey);
      setAdminPage('pipeline');
    },
    [loadAdminPipelineForGroup]
  );

  const resetAdminGroupProgress = async (groupKey: string) => {
    if (!token) {
      return;
    }
    setBusyKey(`group-reset-${groupKey}`);
    setErrorMessage(null);
    try {
      const reset = await api.adminResetGroupProgress(token, groupKey);
      await refreshAdminGroups(token);
      if (reset.resetVirtualDevice) {
        const virtualDevices = await api.adminVirtualDevices(token);
        setAdminData((previous) => (previous ? { ...previous, virtualDevices } : previous));
      }
      if (adminPipelineGroupKeyRef.current === groupKey) {
        await loadAdminPipelineForGroup(groupKey);
      }
      pushToast(reset.hadProgress ? t('groupResetDone') : t('groupNoChangesYet'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveAdminPipeline = useCallback(async () => {
    if (!token || !adminPipelineDraft || !adminPipelineGroupKey) {
      return;
    }
    if (adminPipelineSaveInFlightRef.current) {
      return;
    }

    const currentDraftSig = pipelineAdminDraftSignature(adminPipelineDraft);
    if (currentDraftSig === adminPipelineSavedSig) {
      return;
    }

    adminPipelineSaveInFlightRef.current = true;
    const sentDraft = adminPipelineDraft;
    const sentDraftSig = pipelineAdminDraftSignature(sentDraft);

    try {
      const updated = normalizePipelineView(await api.updateAdminPipeline(
        token,
        adminPipelineGroupKey,
        sentDraft.input,
        sentDraft.processing,
        sentDraft.sink
      ));
      setAdminPipeline(updated);
      setAdminPipelineDraft((previous) => {
        if (!previous) {
          return updated;
        }
        return pipelineAdminDraftSignature(previous) === sentDraftSig
          ? updated
          : previous;
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      adminPipelineSaveInFlightRef.current = false;
    }
  }, [token, adminPipelineDraft, adminPipelineGroupKey, adminPipelineSavedSig]);

  useEffect(() => {
    if (adminPipelineAutosaveTimerRef.current !== null) {
      window.clearTimeout(adminPipelineAutosaveTimerRef.current);
      adminPipelineAutosaveTimerRef.current = null;
    }
    if (
      !token
      || session?.role !== 'ADMIN'
      || !adminPipelineDraft
      || !adminPipelineGroupKey
      || adminPipelineSavedSig === 'null'
    ) {
      return;
    }
    if (adminPipelineDraftSig === adminPipelineSavedSig) {
      return;
    }
    adminPipelineAutosaveTimerRef.current = window.setTimeout(() => {
      adminPipelineAutosaveTimerRef.current = null;
      void saveAdminPipeline();
    }, PIPELINE_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (adminPipelineAutosaveTimerRef.current !== null) {
        window.clearTimeout(adminPipelineAutosaveTimerRef.current);
        adminPipelineAutosaveTimerRef.current = null;
      }
    };
  }, [
    token,
    session?.role,
    adminPipelineDraft,
    adminPipelineGroupKey,
    adminPipelineDraftSig,
    adminPipelineSavedSig,
    saveAdminPipeline
  ]);

  const controlAdminPipelineState = async (
    action: 'RESET_STATE' | 'RESTART_STATE_LOST' | 'RESTART_STATE_RETAINED'
  ) => {
    if (!token || !adminPipelineGroupKey) {
      return;
    }
    setBusyKey('admin-pipeline-state');
    setErrorMessage(null);
    try {
      const updated = normalizePipelineView(
        await api.controlAdminPipelineState(token, adminPipelineGroupKey, action)
      );
      setAdminPipeline(updated);
      setAdminPipelineDraft(updated);
      if (action === 'RESET_STATE') {
        pushToast(t('pipelineStateResetDone'));
      } else {
        pushToast(t('pipelineRestartDone'));
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const resetAdminPipelineSinkCounter = async (sinkId: string) => {
    if (!token || !adminPipelineGroupKey || !sinkId.trim()) {
      return;
    }
    setBusyKey('admin-pipeline-sink');
    setErrorMessage(null);
    try {
      const update = await api.resetAdminPipelineSinkCounter(token, adminPipelineGroupKey, sinkId.trim());
      setAdminPipeline((previous) => {
        if (!previous) {
          return previous;
        }
        return applyPipelineSinkRuntimeUpdate(previous, update);
      });
      setAdminPipelineDraft((previous) => {
        if (!previous) {
          return previous;
        }
        return applyPipelineSinkRuntimeUpdate(previous, update);
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const refreshAdminPipelineLogModeStatus = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    setBusyKey('admin-pipeline-log-status');
    setErrorMessage(null);
    try {
      const status = await api.adminPipelineLogModeStatus(token);
      setAdminPipelineLogModeStatus(status);
      setAdminPipelineReplayMaxRecords((previous) => {
        if (previous > 0) {
          return previous;
        }
        return status.replayDefaultMaxRecords;
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const replayAdminPipelineLog = async () => {
    if (!token || !session || session.role !== 'ADMIN' || !adminPipelineGroupKey) {
      return;
    }

    const fromOffsetRaw = adminPipelineReplayFromOffset.trim();
    let fromOffset: number | null = null;
    if (fromOffsetRaw.length > 0) {
      const parsedOffset = Number.parseInt(fromOffsetRaw, 10);
      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        setErrorMessage(t('pipelineReplayOffsetInvalid'));
        return;
      }
      fromOffset = parsedOffset;
    }

    const normalizedMaxRecords = Math.max(1, Math.min(1000, Math.round(adminPipelineReplayMaxRecords || 0)));
    setAdminPipelineReplayMaxRecords(normalizedMaxRecords);

    setBusyKey('admin-pipeline-log-replay');
    setErrorMessage(null);
    try {
      const replay = await api.adminPipelineLogReplay(token, {
        groupKey: adminPipelineGroupKey,
        fromOffset,
        maxRecords: normalizedMaxRecords
      });
      setAdminPipelineReplayResult(replay);
      if (replay.nextOffset !== null && replay.nextOffset !== undefined) {
        setAdminPipelineReplayFromOffset(String(replay.nextOffset));
      }
      pushToast(t('pipelineReplayDone'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const changeAdminPipelineSlot = useCallback((slotIndex: number, blockType: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        processing: setPipelineSlotBlock(previous.processing, slotIndex, blockType)
      };
    });
  }, []);

  const swapAdminPipelineSlots = useCallback((sourceSlotIndex: number, targetSlotIndex: number) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        processing: swapPipelineSlots(previous.processing, sourceSlotIndex, targetSlotIndex)
      };
    });
  }, []);

  const changeAdminPipelineSlotConfig = useCallback((slotIndex: number, key: string, value: unknown) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        processing: setPipelineSlotConfigValue(previous.processing, slotIndex, key, value)
      };
    });
  }, []);

  const changeAdminPipelineInputMode = useCallback((nextMode: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        input: {
          ...previous.input,
          mode: nextMode
        }
      };
    });
  }, []);

  const addAdminPipelineSink = useCallback((sinkType: 'SEND_EVENT' | 'VIRTUAL_SIGNAL' | 'SHOW_PAYLOAD') => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sink: addPipelineSinkNode(previous.sink, sinkType)
      };
    });
  }, []);

  const removeAdminPipelineSink = useCallback((sinkId: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sink: removePipelineSinkNode(previous.sink, sinkId)
      };
    });
  }, []);

  const configureAdminPipelineSendSink = useCallback((sinkId: string, config: Record<string, unknown>) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sink: updatePipelineSendEventSinkConfig(previous.sink, sinkId, config)
      };
    });
  }, []);

  const selectAdminPipelineTask = useCallback(
    (taskId: string) => {
      setAdminPipelineTaskId(taskId);
      void loadAdminTaskPipelineConfig(taskId);
    },
    [loadAdminTaskPipelineConfig]
  );

  const changeTaskPipelineVisibleToStudents = useCallback((visible: boolean) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        visibleToStudents: visible
      };
    });
  }, []);

  const changeTaskPipelineStudentEventVisibilityScope = useCallback((scope: StudentDeviceScope) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        studentEventVisibilityScope: scope
      };
    });
  }, []);

  const changeTaskPipelineStudentCommandTargetScope = useCallback((scope: StudentDeviceScope) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        studentCommandTargetScope: scope
      };
    });
  }, []);

  const changeTaskPipelineStudentSendEventEnabled = useCallback((enabled: boolean) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        studentSendEventEnabled: enabled
      };
    });
  }, []);

  const changeTaskPipelineStudentDeviceViewDisturbed = useCallback((disturbed: boolean) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        studentDeviceViewDisturbed: disturbed
      };
    });
  }, []);

  const toggleTaskPipelineAllowedBlock = useCallback((blockType: string, enabled: boolean) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      const nextAllowed = toggleStringInList(previous.allowedProcessingBlocks, blockType, enabled);
      if (nextAllowed.length === 0) {
        return previous;
      }
      return {
        ...previous,
        allowedProcessingBlocks: nextAllowed
      };
    });
  }, []);

  const changeTaskPipelineScenarioOverlays = useCallback((scenarioOverlays: string[]) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        scenarioOverlays
      };
    });
  }, []);

  const changeFeedScenarioOverlays = useCallback((scenarioOverlays: string[]) => {
    setFeedScenarioDraft(scenarioOverlays);
  }, []);

  const changeFeedScenarioStudentDeviceViewDisturbed = useCallback((disturbed: boolean) => {
    setFeedScenarioStudentDeviceViewDisturbedDraft(disturbed);
  }, []);

  const saveAdminFeedScenarios = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    setBusyKey('admin-scenarios');
    setErrorMessage(null);
    try {
      const updated = await api.updateAdminScenarios(
        token,
        feedScenarioDraft,
        feedScenarioStudentDeviceViewDisturbedDraft
      );
      setFeedScenarioConfig(updated);
      setFeedScenarioDraft(updated.scenarioOverlays);
      setFeedScenarioStudentDeviceViewDisturbedDraft(Boolean(updated.studentDeviceViewDisturbed));
      pushToast(t('settingsUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveAdminTaskPipelineConfig = async () => {
    if (!token || !adminTaskPipelineConfigDraft) {
      return;
    }

    setBusyKey('admin-task-pipeline-config');
    setErrorMessage(null);
    try {
      const updated = await api.updateAdminTaskPipelineConfig(
        token,
        adminTaskPipelineConfigDraft.taskId,
        adminTaskPipelineConfigDraft.visibleToStudents,
        adminTaskPipelineConfigDraft.slotCount,
        adminTaskPipelineConfigDraft.allowedProcessingBlocks,
        adminTaskPipelineConfigDraft.scenarioOverlays,
        normalizeStudentDeviceScope(adminTaskPipelineConfigDraft.studentEventVisibilityScope),
        normalizeStudentDeviceScope(adminTaskPipelineConfigDraft.studentCommandTargetScope),
        Boolean(adminTaskPipelineConfigDraft.studentSendEventEnabled),
        Boolean(adminTaskPipelineConfigDraft.studentDeviceViewDisturbed)
      );
      setAdminTaskPipelineConfig(updated);
      setAdminTaskPipelineConfigDraft(updated);
      pushToast(t('pipelineTaskConfigSaved'));

      const activeTaskId = adminData?.tasks.find((task) => task.active)?.id ?? '';
      if (activeTaskId && activeTaskId === updated.taskId) {
        if (adminPipelineGroupKey) {
          await loadAdminPipelineForGroup(adminPipelineGroupKey);
        }
        await loadAdminPipelineCompare();
      }
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveAdminTaskDetails = async (
    taskId: string,
    details: {
      titleDe: string;
      titleEn: string;
      descriptionDe: string;
      descriptionEn: string;
      activeDescriptionDe: string;
      activeDescriptionEn: string;
    }
  ) => {
    if (!token) {
      return;
    }

    const payload = {
      taskId: taskId.trim(),
      titleDe: details.titleDe.trim(),
      titleEn: details.titleEn.trim(),
      descriptionDe: details.descriptionDe.trim(),
      descriptionEn: details.descriptionEn.trim(),
      activeDescriptionDe: details.activeDescriptionDe.trim(),
      activeDescriptionEn: details.activeDescriptionEn.trim()
    };
    if (
      !payload.taskId ||
      !payload.titleDe ||
      !payload.titleEn ||
      !payload.descriptionDe ||
      !payload.descriptionEn ||
      !payload.activeDescriptionDe ||
      !payload.activeDescriptionEn
    ) {
      setErrorMessage(t('invalidInput'));
      return;
    }

    setBusyKey('admin-task-update');
    setErrorMessage(null);
    try {
      const updated = await api.updateAdminTaskDetails(token, payload);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        const hasExisting = previous.tasks.some((task) => task.id === updated.id);
        const nextTasks = hasExisting
          ? previous.tasks.map((task) => (task.id === updated.id ? updated : task))
          : [...previous.tasks, updated];
        return {
          ...previous,
          tasks: nextTasks
        };
      });
      pushToast(t('taskUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const createAdminTask = async (draft: {
    titleDe: string;
    titleEn: string;
    descriptionDe: string;
    descriptionEn: string;
    activeDescriptionDe: string;
    activeDescriptionEn: string;
    templateTaskId: string;
  }) => {
    if (!token) {
      return;
    }

    const payload = {
      titleDe: draft.titleDe.trim(),
      titleEn: draft.titleEn.trim(),
      descriptionDe: draft.descriptionDe.trim(),
      descriptionEn: draft.descriptionEn.trim(),
      activeDescriptionDe: draft.activeDescriptionDe.trim(),
      activeDescriptionEn: draft.activeDescriptionEn.trim(),
      templateTaskId: draft.templateTaskId.trim() || null
    };
    if (
      !payload.titleDe ||
      !payload.titleEn ||
      !payload.descriptionDe ||
      !payload.descriptionEn ||
      !payload.activeDescriptionDe ||
      !payload.activeDescriptionEn
    ) {
      setErrorMessage(t('invalidInput'));
      return;
    }

    setBusyKey('admin-task-create');
    setErrorMessage(null);
    try {
      const created = await api.createAdminTask(token, payload);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        if (previous.tasks.some((task) => task.id === created.id)) {
          return previous;
        }
        return {
          ...previous,
          tasks: [...previous.tasks, created]
        };
      });
      setAdminPipelineTaskId(created.id);
      void loadAdminTaskPipelineConfig(created.id);
      pushToast(t('taskCreated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const reorderAdminTasks = async (taskIds: string[]) => {
    if (!token || taskIds.length === 0) {
      return;
    }

    setBusyKey('admin-task-reorder');
    setErrorMessage(null);
    try {
      const reordered = await api.reorderAdminTasks(token, taskIds);
      setAdminData((previous) => (previous ? { ...previous, tasks: reordered } : previous));
      pushToast(t('tasksReordered'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const deleteAdminTask = async (taskId: string) => {
    if (!token) {
      return;
    }

    setBusyKey(`admin-task-delete-${taskId}`);
    setErrorMessage(null);
    try {
      const remaining = await api.deleteAdminTask(token, taskId);
      setAdminData((previous) => (previous ? { ...previous, tasks: remaining } : previous));

      const nextSelectedTaskId = remaining.some((task) => task.id === adminPipelineTaskId)
        ? adminPipelineTaskId
        : (remaining.find((task) => task.active)?.id ?? remaining[0]?.id ?? '');

      setAdminPipelineTaskId(nextSelectedTaskId);
      if (nextSelectedTaskId) {
        void loadAdminTaskPipelineConfig(nextSelectedTaskId);
      } else {
        setAdminTaskPipelineConfig(null);
        setAdminTaskPipelineConfigDraft(null);
      }

      pushToast(t('taskDeleted'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const refreshStudentDeviceState = useCallback(async (deviceIdRaw: string) => {
    const activeToken = token;
    if (!activeToken || session?.role !== 'STUDENT') {
      return;
    }
    const deviceId = deviceIdRaw.trim().toLowerCase();
    if (!isLikelyPhysicalDeviceId(deviceId)) {
      return;
    }
    try {
      const nextState = await api.studentDeviceState(activeToken, deviceId);
      setStudentDeviceStatesById((previous) => {
        const previousState = previous[nextState.deviceId] ?? null;
        if (sameStudentDeviceState(previousState, nextState)) {
          return previous;
        }
        return {
          ...previous,
          [nextState.deviceId]: nextState
        };
      });
    } catch (error) {
      reportBackgroundError(`studentDeviceState:${deviceId}`, error);
    }
  }, [reportBackgroundError, session?.role, token]);

  useEffect(() => {
    if (
      !token
      || session?.role !== 'STUDENT'
      || !studentData?.capabilities.canSendDeviceCommands
    ) {
      return;
    }

    const ownDeviceId = session.groupKey?.trim().toLowerCase() ?? '';
    if (!isLikelyPhysicalDeviceId(ownDeviceId)) {
      return;
    }

    const runRefresh = () => {
      void refreshStudentDeviceState(ownDeviceId);
    };

    runRefresh();
    const timerId = window.setInterval(runRefresh, 2500);
    return () => {
      window.clearInterval(timerId);
    };
  }, [
    refreshStudentDeviceState,
    session?.groupKey,
    session?.role,
    studentData?.capabilities.canSendDeviceCommands,
    token
  ]);

  const sendStudentCommand = async (command: DeviceCommandType, on?: boolean) => {
    if (!token || !session || session.role !== 'STUDENT' || !session.groupKey) {
      return;
    }

    const targetDeviceId = session.groupKey.trim().toLowerCase();
    if (!isLikelyPhysicalDeviceId(targetDeviceId)) {
      setErrorMessage(t('invalidInput'));
      return;
    }

    setBusyKey(`student-command-${command}-${String(on)}-${targetDeviceId}`);
    setErrorMessage(null);

    try {
      await api.sendStudentCommand(token, targetDeviceId, command, on);
      void refreshStudentDeviceState(targetDeviceId);
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
      setAdminPipelineTaskId(task.id);
      void loadAdminTaskPipelineConfig(task.id);
      pushToast(t('taskUpdated'));
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
        adminSettingsDraftTimeFormat24h,
        adminSettingsDraftVirtualVisible,
        adminSettingsDraftAdminDeviceId,
        adminSettingsDraftVirtualDeviceTopicMode
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
      setAdminSettingsDraftVirtualVisible(updated.studentVirtualDeviceVisible);
      setAdminSettingsDraftAdminDeviceId(updated.adminDeviceId);
      setAdminSettingsDraftVirtualDeviceTopicMode(updated.virtualDeviceTopicMode);
      pushToast(t('settingsUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const changeAdminStreamSourceEndpointDraft = useCallback((sourceId: string, value: string) => {
    setAdminStreamSourceEndpointDrafts((previous) => ({
      ...previous,
      [sourceId]: value
    }));
  }, []);

  const applyAdminStreamSourceUpdate = useCallback((updated: ExternalStreamSource) => {
    setAdminStreamSources((previous) => upsertExternalStreamSource(previous, updated));
    setAdminStreamSourceEndpointDrafts((previous) => ({
      ...previous,
      [updated.sourceId]: updated.endpointUrl
    }));
  }, []);

  const toggleAdminStreamSourceEnabled = async (sourceId: string, enabled: boolean) => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    setBusyKey(`stream-source-toggle-${sourceId}`);
    setErrorMessage(null);
    try {
      const updated = enabled
        ? await api.enableAdminStreamSource(token, sourceId)
        : await api.disableAdminStreamSource(token, sourceId);
      applyAdminStreamSourceUpdate(updated);
      pushToast(t(enabled ? 'streamSourceEnabled' : 'streamSourceDisabled'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveAdminStreamSourceConfig = async (sourceId: string) => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    const endpointUrl = (adminStreamSourceEndpointDrafts[sourceId] ?? '').trim();
    if (!endpointUrl) {
      setErrorMessage(t('invalidInput'));
      return;
    }
    setBusyKey(`stream-source-config-${sourceId}`);
    setErrorMessage(null);
    try {
      const updated = await api.updateAdminStreamSourceConfig(token, sourceId, endpointUrl);
      applyAdminStreamSourceUpdate(updated);
      pushToast(t('streamSourceConfigSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const resetAdminStreamSourceCounter = async (sourceId: string) => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    setBusyKey(`stream-source-reset-${sourceId}`);
    setErrorMessage(null);
    try {
      const updated = await api.resetAdminStreamSourceCounter(token, sourceId);
      applyAdminStreamSourceUpdate(updated);
      pushToast(t('streamSourceCounterReset'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendAdminDeviceCommand = useCallback(
    async (
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
    },
    [token]
  );

  const applyStudentVirtualPatchImmediate = useCallback((patch: Partial<VirtualDeviceState>) => {
    if (!token || session?.role !== 'STUDENT') {
      return;
    }
    studentVirtualMutationQueueRef.current = studentVirtualMutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const updated = await api.studentVirtualDeviceControl(token, patch);
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            if (previous.virtualDevice && sameVirtualDeviceState(previous.virtualDevice, updated)) {
              return previous;
            }
            return {
              ...previous,
              virtualDevice: updated
            };
          });
          const nextPatch = patchFromVirtualDevice(updated);
          setStudentVirtualPatch((previous) =>
            sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch
          );
        } catch (error) {
          setErrorMessage(toErrorMessage(error));
        }
      });
  }, [session?.role, token]);

  const setStudentVirtualField = useCallback(<K extends keyof VirtualDevicePatch>(key: K, value: VirtualDevicePatch[K]) => {
    setStudentVirtualPatch((previous) => {
      if (previous && previous[key] === value) {
        return previous;
      }
      const base = previous ?? {};
      return {
        ...base,
        [key]: value
      };
    });
  }, []);

  const setStudentVirtualButtonState = useCallback((button: 'red' | 'black', pressed: boolean) => {
    const field: keyof VirtualDevicePatch = button === 'red' ? 'buttonRedPressed' : 'buttonBlackPressed';
    setStudentVirtualField(field, pressed);
    if (studentVirtualAutosaveTimerRef.current !== null) {
      window.clearTimeout(studentVirtualAutosaveTimerRef.current);
      studentVirtualAutosaveTimerRef.current = null;
    }
    const patch = button === 'red'
      ? { buttonRedPressed: pressed }
      : { buttonBlackPressed: pressed };
    applyStudentVirtualPatchImmediate(patch);
  }, [applyStudentVirtualPatchImmediate, setStudentVirtualField]);

  const setModalVirtualField = useCallback(<K extends keyof VirtualDevicePatch>(key: K, value: VirtualDevicePatch[K]) => {
    setVirtualControlPatch((previous) => {
      if (previous && previous[key] === value) {
        return previous;
      }
      const base = previous ?? {};
      return {
        ...base,
        [key]: value
      };
    });
  }, []);

  const saveStudentVirtualDevice = useCallback(async () => {
    if (!token || !studentVirtualPatch || !studentData?.virtualDevice) {
      return;
    }
    if (studentVirtualSaveInFlightRef.current) {
      return;
    }
    studentVirtualSaveInFlightRef.current = true;

    setBusyKey('student-virtual-control');
    setErrorMessage(null);

    try {
      const updated = await api.studentVirtualDeviceControl(token, studentVirtualPatch);
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        if (previous.virtualDevice && sameVirtualDeviceState(previous.virtualDevice, updated)) {
          return previous;
        }
        return {
          ...previous,
          virtualDevice: updated
        };
      });
      const nextPatch = patchFromVirtualDevice(updated);
      setStudentVirtualPatch((previous) => (sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      studentVirtualSaveInFlightRef.current = false;
      setBusyKey(null);
    }
  }, [token, studentVirtualPatch, studentData?.virtualDevice]);

  useEffect(() => {
    if (studentVirtualAutosaveTimerRef.current !== null) {
      window.clearTimeout(studentVirtualAutosaveTimerRef.current);
      studentVirtualAutosaveTimerRef.current = null;
    }
    if (
      !token
      || session?.role !== 'STUDENT'
      || !studentData?.virtualDevice
      || !studentVirtualPatch
    ) {
      return;
    }
    const baseline = patchFromVirtualDevice(studentData.virtualDevice);
    if (sameVirtualDevicePatch(studentVirtualPatch, baseline)) {
      return;
    }
    if (hasOnlyButtonPatchDifferences(studentVirtualPatch, baseline)) {
      return;
    }

    studentVirtualAutosaveTimerRef.current = window.setTimeout(() => {
      studentVirtualAutosaveTimerRef.current = null;
      void saveStudentVirtualDevice();
    }, VIRTUAL_DEVICE_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (studentVirtualAutosaveTimerRef.current !== null) {
        window.clearTimeout(studentVirtualAutosaveTimerRef.current);
        studentVirtualAutosaveTimerRef.current = null;
      }
    };
  }, [token, session?.role, studentData?.virtualDevice, studentVirtualPatch, saveStudentVirtualDevice]);

  const openVirtualControlModal = useCallback((deviceId: string) => {
    setVirtualControlDeviceId(deviceId);
    const state = adminDataRef.current?.virtualDevices.find((entry) => entry.deviceId === deviceId) ?? null;
    setVirtualControlPatch(state ? patchFromVirtualDevice(state) : null);
  }, []);

  const closeVirtualControlModal = useCallback(() => {
    setVirtualControlDeviceId(null);
    setVirtualControlPatch(null);
  }, []);

  const applyUpdatedVirtualDevice = useCallback((updated: VirtualDeviceState) => {
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      const existing = previous.virtualDevices.find((entry) => entry.deviceId === updated.deviceId);
      if (existing && sameVirtualDeviceState(existing, updated)) {
        return previous;
      }
      const hasExisting = Boolean(existing);
      const nextVirtualDevices = hasExisting
        ? previous.virtualDevices.map((entry) =>
            entry.deviceId === updated.deviceId ? updated : entry
          )
        : [...previous.virtualDevices, updated].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
      return {
        ...previous,
        virtualDevices: nextVirtualDevices
      };
    });
  }, []);

  const applyAdminVirtualPatchImmediate = useCallback((deviceId: string, patch: Partial<VirtualDeviceState>) => {
    if (!token) {
      return;
    }
    adminVirtualMutationQueueRef.current = adminVirtualMutationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const updated = await api.adminVirtualDeviceControl(token, deviceId, patch);
          applyUpdatedVirtualDevice(updated);
          if (virtualControlDeviceId === updated.deviceId) {
            const nextPatch = patchFromVirtualDevice(updated);
            setVirtualControlPatch((previous) =>
              sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch
            );
          }
        } catch (error) {
          setErrorMessage(toErrorMessage(error));
        }
      });
  }, [applyUpdatedVirtualDevice, token, virtualControlDeviceId]);

  const setModalVirtualButtonState = useCallback((button: 'red' | 'black', pressed: boolean) => {
    if (!virtualControlDeviceId) {
      return;
    }
    const field: keyof VirtualDevicePatch = button === 'red' ? 'buttonRedPressed' : 'buttonBlackPressed';
    setModalVirtualField(field, pressed);
    if (adminVirtualAutosaveTimerRef.current !== null) {
      window.clearTimeout(adminVirtualAutosaveTimerRef.current);
      adminVirtualAutosaveTimerRef.current = null;
    }
    const patch = button === 'red'
      ? { buttonRedPressed: pressed }
      : { buttonBlackPressed: pressed };
    applyAdminVirtualPatchImmediate(virtualControlDeviceId, patch);
  }, [applyAdminVirtualPatchImmediate, setModalVirtualField, virtualControlDeviceId]);

  const saveAdminVirtualDevice = useCallback(async () => {
    if (!token || !virtualControlDeviceId || !virtualControlPatch) {
      return;
    }
    if (adminVirtualSaveInFlightRef.current) {
      return;
    }
    adminVirtualSaveInFlightRef.current = true;

    const busyId = `admin-virtual-control-${virtualControlDeviceId}`;
    setBusyKey(busyId);
    setErrorMessage(null);

    try {
      const updated = await api.adminVirtualDeviceControl(token, virtualControlDeviceId, virtualControlPatch);
      applyUpdatedVirtualDevice(updated);
      const nextPatch = patchFromVirtualDevice(updated);
      setVirtualControlPatch((previous) => (sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      adminVirtualSaveInFlightRef.current = false;
      setBusyKey(null);
    }
  }, [token, virtualControlDeviceId, virtualControlPatch, applyUpdatedVirtualDevice]);

  useEffect(() => {
    if (adminVirtualAutosaveTimerRef.current !== null) {
      window.clearTimeout(adminVirtualAutosaveTimerRef.current);
      adminVirtualAutosaveTimerRef.current = null;
    }
    if (!token || !virtualControlDeviceId || !virtualControlPatch) {
      return;
    }
    const baselineState = adminData?.virtualDevices.find((entry) => entry.deviceId === virtualControlDeviceId) ?? null;
    if (!baselineState) {
      return;
    }
    const baseline = patchFromVirtualDevice(baselineState);
    if (sameVirtualDevicePatch(virtualControlPatch, baseline)) {
      return;
    }
    if (hasOnlyButtonPatchDifferences(virtualControlPatch, baseline)) {
      return;
    }

    adminVirtualAutosaveTimerRef.current = window.setTimeout(() => {
      adminVirtualAutosaveTimerRef.current = null;
      void saveAdminVirtualDevice();
    }, VIRTUAL_DEVICE_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (adminVirtualAutosaveTimerRef.current !== null) {
        window.clearTimeout(adminVirtualAutosaveTimerRef.current);
        adminVirtualAutosaveTimerRef.current = null;
      }
    };
  }, [token, adminData?.virtualDevices, virtualControlDeviceId, virtualControlPatch, saveAdminVirtualDevice]);

  const closeCounterResetModal = useCallback(() => {
    setCounterResetTarget(null);
  }, []);

  const openCounterResetModal = useCallback((deviceId: string, isVirtual = false) => {
    setCounterResetTarget({ deviceId, isVirtual });
  }, []);

  const confirmCounterReset = async () => {
    if (!counterResetTarget) {
      return;
    }
    if (counterResetTarget.isVirtual) {
      if (!token) {
        return;
      }
      const busyId = `admin-virtual-counter-reset-${counterResetTarget.deviceId}`;
      setBusyKey(busyId);
      setErrorMessage(null);
      try {
        const updated = await api.adminVirtualDeviceControl(token, counterResetTarget.deviceId, {
          counterValue: 0
        });
        applyUpdatedVirtualDevice(updated);
        if (virtualControlDeviceId === updated.deviceId) {
          const nextPatch = patchFromVirtualDevice(updated);
          setVirtualControlPatch((previous) => (sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch));
        }
        closeCounterResetModal();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
      return;
    }

    const ok = await sendAdminDeviceCommand(counterResetTarget.deviceId, 'COUNTER_RESET');
    if (ok) {
      closeCounterResetModal();
    }
  };

  const closePinEditor = useCallback(() => {
    setPinEditorDeviceId(null);
    setPinEditorValue('');
    setPinEditorLoading(false);
  }, []);

  const openPinEditor = useCallback(async (deviceId: string) => {
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
  }, [token]);

  const savePinEditor = async () => {
    if (!token || !pinEditorDeviceId) {
      return;
    }
    const nextPin = pinEditorValue.trim();
    if (!nextPin) {
      setErrorMessage(t('pinBlankError'));
      return;
    }

    setBusyKey(`pin-save-${pinEditorDeviceId}`);
    setErrorMessage(null);

    try {
      const updated = await api.updateAdminDevicePin(token, pinEditorDeviceId, nextPin);
      setPinEditorValue(updated.pin);
      pushToast(t('pinSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const setMqttDraftField = useCallback(<K extends keyof MqttEventDraft>(key: K, value: MqttEventDraft[K]) => {
    setMqttEventDraft((previous) => {
      let nextValue = value;
      if (key === 'rawTopic' || key === 'customTopic') {
        nextValue = normalizeLegacyLedCommandTopic(String(value)) as MqttEventDraft[K];
      }
      if (previous[key] === nextValue) {
        return previous;
      }
      return {
        ...previous,
        [key]: nextValue
      };
    });
  }, []);

  const setMqttTargetType = useCallback((targetType: MqttComposerTargetType) => {
    setMqttEventDraft((previous) => {
      if (previous.targetType === targetType) {
        return previous;
      }
      const nextTemplate = normalizeMqttTemplateForTarget(targetType, previous.template);
      const nextDeviceId = resolveMqttDeviceId(
        targetType,
        previous.deviceId,
        adminPhysicalDeviceIds,
        adminVirtualDeviceIds
      );
      const customTopicSeed =
        nextTemplate === 'custom'
          ? previous.customTopic.trim().length > 0
            ? previous.customTopic
            : (/^(epld|eplvd)\d+$/i.test(nextDeviceId.trim()) ? `${nextDeviceId.trim().toLowerCase()}/` : '')
          : previous.customTopic;
      return {
        ...previous,
        targetType,
        template: nextTemplate,
        deviceId: nextDeviceId,
        customTopic: customTopicSeed
      };
    });
  }, [adminPhysicalDeviceIds, adminVirtualDeviceIds]);

  const setMqttTemplate = useCallback((template: MqttComposerTemplate) => {
    setMqttEventDraft((previous) => {
      const nextTemplate = normalizeMqttTemplateForTarget(previous.targetType, template);
      if (previous.template === nextTemplate) {
        return previous;
      }
      const customTopicSeed =
        nextTemplate === 'custom'
          ? previous.customTopic.trim().length > 0
            ? previous.customTopic
            : (/^(epld|eplvd)\d+$/i.test(previous.deviceId.trim())
              ? `${previous.deviceId.trim().toLowerCase()}/`
              : '')
          : previous.customTopic;
      return {
        ...previous,
        template: nextTemplate,
        customTopic: customTopicSeed
      };
    });
  }, []);

  const setMqttDeviceId = useCallback((deviceId: string) => {
    setMqttEventDraft((previous) => {
      if (previous.deviceId === deviceId) {
        return previous;
      }
      const customTopicSeed =
        previous.template === 'custom' && previous.customTopic.trim().length === 0 && /^(epld|eplvd)\d+$/i.test(deviceId.trim())
          ? `${deviceId.trim().toLowerCase()}/`
          : previous.customTopic;
      return {
        ...previous,
        deviceId,
        customTopic: customTopicSeed
      };
    });
  }, []);

  const setStudentMqttDraftField = useCallback(<K extends keyof MqttEventDraft>(key: K, value: MqttEventDraft[K]) => {
    setStudentMqttEventDraft((previous) => {
      let nextValue = value;
      if (key === 'rawTopic' || key === 'customTopic') {
        nextValue = normalizeLegacyLedCommandTopic(String(nextValue)) as MqttEventDraft[K];
      }
      if ((key === 'rawTopic' || key === 'customTopic') && studentSelectedTopicPrefixDeviceId) {
        nextValue = lockTopicToDevicePrefix(
          studentSelectedTopicPrefixDeviceId,
          String(nextValue)
        ) as MqttEventDraft[K];
      }
      if (previous[key] === nextValue) {
        return previous;
      }
      return {
        ...previous,
        [key]: nextValue
      };
    });
  }, [studentSelectedTopicPrefixDeviceId]);

  const setStudentMqttTargetType = useCallback((targetType: MqttComposerTargetType) => {
    if (!studentSendEventTargetTypeOptions.includes(targetType)) {
      return;
    }
    setStudentMqttEventDraft((previous) => {
      if (previous.targetType === targetType) {
        return previous;
      }
      const nextTemplate = normalizeMqttTemplateForTarget(targetType, previous.template);
      const nextDeviceId = resolveMqttDeviceId(
        targetType,
        previous.deviceId,
        studentAllowedPhysicalTargetIds,
        []
      );
      const normalizedDeviceId = normalizeTopicPrefixDeviceId(nextDeviceId);
      const lockedRawTopic = normalizedDeviceId
        ? lockTopicToDevicePrefix(normalizedDeviceId, previous.rawTopic)
        : previous.rawTopic;
      const lockedCustomTopic = normalizedDeviceId
        ? lockTopicToDevicePrefix(normalizedDeviceId, previous.customTopic)
        : previous.customTopic;
      return {
        ...previous,
        targetType,
        template: nextTemplate,
        deviceId: nextDeviceId,
        rawTopic: lockedRawTopic,
        customTopic: lockedCustomTopic
      };
    });
  }, [studentAllowedPhysicalTargetIds, studentSendEventTargetTypeOptions]);

  const setStudentMqttTemplate = useCallback((template: MqttComposerTemplate) => {
    setStudentMqttEventDraft((previous) => {
      const nextTemplate = normalizeMqttTemplateForTarget(previous.targetType, template);
      if (previous.template === nextTemplate) {
        return previous;
      }
      const normalizedDeviceId = normalizeTopicPrefixDeviceId(previous.deviceId);
      const customTopicSeed =
        nextTemplate === 'custom' && normalizedDeviceId
          ? lockTopicToDevicePrefix(normalizedDeviceId, previous.customTopic)
          : previous.customTopic;
      return {
        ...previous,
        template: nextTemplate,
        customTopic: customTopicSeed
      };
    });
  }, []);

  const setStudentMqttDeviceId = useCallback((deviceId: string) => {
    setStudentMqttEventDraft((previous) => {
      if (previous.deviceId === deviceId) {
        return previous;
      }
      const normalizedDeviceId = normalizeTopicPrefixDeviceId(deviceId);
      const lockedRawTopic = normalizedDeviceId
        ? lockTopicToDevicePrefix(normalizedDeviceId, previous.rawTopic)
        : previous.rawTopic;
      const lockedCustomTopic = normalizedDeviceId
        ? lockTopicToDevicePrefix(normalizedDeviceId, previous.customTopic)
        : previous.customTopic;
      return {
        ...previous,
        deviceId,
        rawTopic: lockedRawTopic,
        customTopic: lockedCustomTopic
      };
    });
  }, []);

  const openMqttEventModal = useCallback(() => {
    setMqttComposerMode('guided');
    setMqttEventDraft((previous) => {
      let nextTargetType = previous.targetType;
      if (nextTargetType === 'physical' && adminPhysicalDeviceIds.length === 0) {
        nextTargetType = adminVirtualDeviceIds.length > 0 ? 'virtual' : 'custom';
      }
      if (nextTargetType === 'virtual' && adminVirtualDeviceIds.length === 0) {
        nextTargetType = adminPhysicalDeviceIds.length > 0 ? 'physical' : 'custom';
      }

      const nextTemplate = normalizeMqttTemplateForTarget(nextTargetType, previous.template);
      const nextDeviceId = resolveMqttDeviceId(
        nextTargetType,
        previous.deviceId,
        adminPhysicalDeviceIds,
        adminVirtualDeviceIds
      );

      const nextDraft = {
        ...previous,
        targetType: nextTargetType,
        template: nextTemplate,
        deviceId: nextDeviceId
      };
      const guided = buildGuidedMqttMessage(nextDraft);
      return {
        ...nextDraft,
        rawTopic: normalizeLegacyLedCommandTopic(guided.topic),
        rawPayload: guided.payload
      };
    });
    setMqttModalOpen(true);
  }, [adminPhysicalDeviceIds, adminVirtualDeviceIds]);

  const closeMqttEventModal = useCallback(() => {
    setMqttModalOpen(false);
  }, []);

  const setMqttComposerModeWithSync = useCallback((mode: MqttComposerMode) => {
    setMqttComposerMode(mode);
    if (mode !== 'raw') {
      return;
    }
    setMqttEventDraft((previous) => ({
      ...previous,
      rawTopic: guidedMqttMessage.topic,
      rawPayload: guidedMqttMessage.payload
    }));
  }, [guidedMqttMessage.payload, guidedMqttMessage.topic]);

  const openStudentMqttEventModal = useCallback(() => {
    setStudentMqttComposerMode('guided');
    setStudentMqttEventDraft((previous) => {
      let nextTargetType = previous.targetType;
      if (!studentSendEventTargetTypeOptions.includes(nextTargetType)) {
        nextTargetType = studentSendEventTargetTypeOptions[0] ?? 'physical';
      }
      if (nextTargetType === 'physical' && studentAllowedPhysicalTargetIds.length === 0) {
        nextTargetType = studentSendEventTargetTypeOptions.includes('custom') ? 'custom' : 'physical';
      }

      const nextTemplate = normalizeMqttTemplateForTarget(nextTargetType, previous.template);
      const resolvedDeviceId = resolveMqttDeviceId(
        nextTargetType,
        previous.deviceId,
        studentAllowedPhysicalTargetIds,
        []
      );
      const nextDeviceId = isLikelyPhysicalDeviceId(resolvedDeviceId)
        ? resolvedDeviceId
        : (studentAllowedPhysicalTargetIds[0] ?? resolvedDeviceId);
      const normalizedDeviceId = normalizeTopicPrefixDeviceId(nextDeviceId);

      const nextDraft = {
        ...previous,
        targetType: nextTargetType,
        template: nextTemplate,
        deviceId: nextDeviceId
      };
      const guided = buildGuidedMqttMessage(nextDraft);
      const lockedGuidedTopic = normalizedDeviceId
        ? lockTopicToDevicePrefix(normalizedDeviceId, guided.topic)
        : guided.topic;
      return {
        ...nextDraft,
        rawTopic: normalizeLegacyLedCommandTopic(lockedGuidedTopic),
        rawPayload: guided.payload,
        customTopic: normalizedDeviceId
          ? normalizeLegacyLedCommandTopic(lockTopicToDevicePrefix(normalizedDeviceId, nextDraft.customTopic))
          : normalizeLegacyLedCommandTopic(nextDraft.customTopic)
      };
    });
    setStudentMqttModalOpen(true);
  }, [studentAllowedPhysicalTargetIds, studentSendEventTargetTypeOptions]);

  const closeStudentMqttEventModal = useCallback(() => {
    setStudentMqttModalOpen(false);
  }, []);

  const setStudentMqttComposerModeWithSync = useCallback((mode: MqttComposerMode) => {
    setStudentMqttComposerMode(mode);
    if (mode !== 'raw') {
      return;
    }
    setStudentMqttEventDraft((previous) => ({
      ...previous,
      rawTopic: studentSelectedTopicPrefixDeviceId
        ? lockTopicToDevicePrefix(studentSelectedTopicPrefixDeviceId, guidedStudentMqttMessage.topic)
        : guidedStudentMqttMessage.topic,
      rawPayload: guidedStudentMqttMessage.payload
    }));
  }, [guidedStudentMqttMessage.payload, guidedStudentMqttMessage.topic, studentSelectedTopicPrefixDeviceId]);

  const sendStudentMqttEvent = async () => {
    if (
      !token
      || !session
      || session.role !== 'STUDENT'
      || !studentData?.capabilities.studentSendEventEnabled
    ) {
      return;
    }
    if (!studentSelectedTopicPrefixDeviceId) {
      setErrorMessage(t('mqttDeviceRequired'));
      return;
    }
    const requestedTopic = (
      studentMqttComposerMode === 'raw' ? studentMqttEventDraft.rawTopic : guidedStudentMqttMessage.topic
    ).trim();
    const topic = normalizeLegacyLedCommandTopic(
      lockTopicToDevicePrefix(studentSelectedTopicPrefixDeviceId, requestedTopic)
    ).trim();
    const payload = (
      studentMqttComposerMode === 'raw' ? studentMqttEventDraft.rawPayload : guidedStudentMqttMessage.payload
    ).trim();
    if (!topic) {
      setErrorMessage(t('mqttTopicRequired'));
      return;
    }
    if (!payload) {
      setErrorMessage(t('mqttPayloadRequired'));
      return;
    }
    if (!isTopicAllowedForStudentScope(
      studentCommandTargetScope,
      topic,
      studentOwnDeviceId,
      studentAdminDeviceId
    )) {
      setErrorMessage(t('mqttTopicNotAllowedForTaskScope'));
      return;
    }
    const payloadLooksLikeJsonLiteral =
      payload.startsWith('{') ||
      payload.startsWith('[') ||
      payload.startsWith('"') ||
      payload === 'true' ||
      payload === 'false' ||
      payload === 'null' ||
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(payload);
    if (payloadLooksLikeJsonLiteral) {
      try {
        JSON.parse(payload);
      } catch {
        setErrorMessage(t('mqttPayloadInvalidJson'));
        return;
      }
    }

    setBusyKey('student-mqtt-publish');
    setErrorMessage(null);
    try {
      await api.studentPublishMqttEvent(
        token,
        topic,
        payload,
        studentMqttEventDraft.qos,
        studentMqttEventDraft.retained,
        studentSelectedTopicPrefixDeviceId
      );
      setStudentMqttModalOpen(false);
      pushToast(t('mqttEventSent'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendAdminMqttEvent = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }

    const topic = normalizeLegacyLedCommandTopic(
      mqttComposerMode === 'raw' ? mqttEventDraft.rawTopic : guidedMqttMessage.topic
    ).trim();
    const payload = (mqttComposerMode === 'raw' ? mqttEventDraft.rawPayload : guidedMqttMessage.payload).trim();

    if (!topic) {
      setErrorMessage(t('mqttTopicRequired'));
      return;
    }
    if (!payload) {
      setErrorMessage(t('mqttPayloadRequired'));
      return;
    }
    const payloadLooksLikeJsonLiteral =
      payload.startsWith('{') ||
      payload.startsWith('[') ||
      payload.startsWith('"') ||
      payload === 'true' ||
      payload === 'false' ||
      payload === 'null' ||
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(payload);
    if (payloadLooksLikeJsonLiteral) {
      try {
        JSON.parse(payload);
      } catch {
        setErrorMessage(t('mqttPayloadInvalidJson'));
        return;
      }
    }

    setBusyKey('admin-mqtt-publish');
    setErrorMessage(null);

    try {
      await api.adminPublishMqttEvent(token, topic, payload, mqttEventDraft.qos, mqttEventDraft.retained);
      setMqttModalOpen(false);
      pushToast(t('mqttEventSent'));
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
      const logModeStatusPromise = api.adminPipelineLogModeStatus(token).catch(() => null);
      const [tasks, devices, virtualDevices, groups, events, pipelineEvents, settings, streamSources, systemStatus, logModeStatus, scenarios] = await Promise.all([
        api.adminTasks(token),
        api.adminDevices(token),
        api.adminVirtualDevices(token),
        api.adminGroups(token),
        api.eventsFeed(token, { limit: MAX_FEED_SOURCE_EVENTS, includeInternal: true }),
        api.eventsFeed(token, { limit: MAX_FEED_SOURCE_EVENTS, includeInternal: true, stage: 'AFTER_PIPELINE' }),
        api.adminSettings(token),
        api.adminStreamSources(token),
        api.adminSystemStatus(token),
        logModeStatusPromise,
        api.adminScenarios(token)
      ]);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          tasks,
          devices,
          virtualDevices,
          groups,
          events: clampFeed(events),
          settings
        };
      });
      setAdminPipelineFeed(clampFeed(pipelineEvents));
      deferredAdminFeedRef.current = [];
      setAdminSettingsDraftMode(settings.defaultLanguageMode);
      setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
      setAdminSettingsDraftVirtualVisible(settings.studentVirtualDeviceVisible);
      setAdminSettingsDraftAdminDeviceId(settings.adminDeviceId);
      setAdminSettingsDraftVirtualDeviceTopicMode(settings.virtualDeviceTopicMode);
      setDefaultLanguageMode(settings.defaultLanguageMode);
      setTimeFormat24h(settings.timeFormat24h);
      const sortedStreamSources = sortExternalStreamSources(streamSources);
      setAdminStreamSources(sortedStreamSources);
      setAdminStreamSourceEndpointDrafts(endpointDraftsFromSources(sortedStreamSources, {}));
      setAdminSystemStatus((previous) => (sameAdminSystemStatus(previous, systemStatus) ? previous : systemStatus));
      setAdminPipelineLogModeStatus(logModeStatus);
      setFeedScenarioConfig(scenarios);
      setAdminPipelineReplayMaxRecords((previous) => {
        if (previous > 0) {
          return previous;
        }
        return logModeStatus?.replayDefaultMaxRecords ?? 200;
      });
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const resetStoredEvents = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }

    setBusyKey('admin-reset-events');
    setErrorMessage(null);

    try {
      const reset = await api.adminResetEvents(token);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          events: []
        };
      });
      setAdminPipelineFeed([]);
      deferredAdminFeedRef.current = [];
      clearRecentFeedHighlights();
      setResetEventsModalOpen(false);

      const latestStatus = await api.adminSystemStatus(token);
      setAdminSystemStatus((previous) => (sameAdminSystemStatus(previous, latestStatus) ? previous : latestStatus));
      pushToast(`${t('resetStoredEventsDone')}: ${reset.deletedEvents}`);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSystemDataExportPart = useCallback((part: SystemDataPart, checked: boolean) => {
    setSystemDataExportSelection((previous) => {
      if (previous[part] === checked) {
        return previous;
      }
      return {
        ...previous,
        [part]: checked
      };
    });
  }, []);

  const toggleSystemDataImportPart = useCallback((part: SystemDataPart, checked: boolean) => {
    setSystemDataImportSelection((previous) => {
      if (previous[part] === checked) {
        return previous;
      }
      return {
        ...previous,
        [part]: checked
      };
    });
  }, []);

  const handleSystemImportFileSelected = useCallback((file: File) => {
    setSystemDataImportFileName(file.name);
    setSystemDataImportFile(file);
    setSystemDataImportVerify(null);
    setSystemDataImportSelection(createSystemDataPartSelection(false));
    setErrorMessage(null);
  }, []);

  const exportSystemData = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    if (selectedSystemDataExportParts.length === 0) {
      setErrorMessage(t('systemDataSelectAtLeastOne'));
      return;
    }

    setBusyKey('admin-system-export');
    setErrorMessage(null);

    try {
      const blob = await api.adminExportSystemData(token, selectedSystemDataExportParts);
      const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `epl-export-${safeStamp}.zip`;
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      pushToast(t('systemDataExportDone'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const verifySystemImport = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    if (!systemDataImportFile) {
      setErrorMessage(t('systemDataImportNoFile'));
      return;
    }

    setBusyKey('admin-system-import-verify');
    setErrorMessage(null);

    try {
      const verified = await api.adminVerifySystemDataImport(token, systemDataImportFile);
      setSystemDataImportVerify(verified);

      const selected = createSystemDataPartSelection(false);
      for (const entry of verified.availableParts) {
        selected[entry.part] = true;
      }
      setSystemDataImportSelection(selected);

      if (verified.valid) {
        pushToast(t('systemDataImportValid'));
      } else {
        setErrorMessage(verified.errors.join(' | ') || t('systemDataImportInvalid'));
      }
    } catch (error) {
      setSystemDataImportVerify(null);
      setSystemDataImportSelection(createSystemDataPartSelection(false));
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const applySystemImport = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    if (!systemDataImportFile || !systemDataImportVerify || !systemDataImportVerify.valid) {
      setErrorMessage(t('systemDataImportInvalid'));
      return;
    }
    if (selectedSystemDataImportParts.length === 0) {
      setErrorMessage(t('systemDataSelectAtLeastOne'));
      return;
    }
    if (!window.confirm(t('systemDataImportConfirm'))) {
      return;
    }

    setBusyKey('admin-system-import-apply');
    setErrorMessage(null);

    try {
      const imported = await api.adminApplySystemDataImport(
        token,
        systemDataImportFile,
        selectedSystemDataImportParts
      );
      const summary = imported.importedParts
        .map((entry) => `${systemDataPartLabel(entry.part, t)} (${entry.rowCount})`)
        .join(', ');
      pushToast(`${t('systemDataImportDone')}: ${summary}`);
      await refreshAdminData();
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const disturbanceNowEpochMs = useMemo(
    () => Math.max(feedDisturbanceClockMs, Date.now()),
    [feedDisturbanceClockMs]
  );

  const studentBeforePipelineDisturbedFeedSource = useMemo(() => {
    if (!studentData) {
      return [];
    }
    return applyFeedScenarioDisturbances(
      studentData.feed,
      feedScenarioConfig?.scenarioOverlays,
      disturbanceNowEpochMs
    );
  }, [disturbanceNowEpochMs, feedScenarioConfig?.scenarioOverlays, studentData]);

  const studentSelectedDeviceState = useMemo(() => {
    if (!studentOwnDeviceId) {
      return null;
    }

    const baseline = studentSelectedDeviceStateBase;
    if (!studentDeviceViewDisturbed) {
      return baseline;
    }

    const snapshot = buildDeviceTelemetrySnapshots(studentBeforePipelineDisturbedFeedSource)[studentOwnDeviceId];
    const baseState: StudentDeviceState = baseline ?? {
      deviceId: studentOwnDeviceId,
      online: false,
      lastSeen: null,
      rssi: null,
      temperatureC: null,
      humidityPct: null,
      brightness: null,
      counterValue: null,
      buttonRedPressed: null,
      buttonBlackPressed: null,
      ledGreenOn: null,
      ledOrangeOn: null,
      uptimeMs: null,
      uptimeIngestTs: null,
      updatedAt: null
    };

    return {
      ...baseState,
      temperatureC: snapshot?.temperatureC ?? null,
      humidityPct: snapshot?.humidityPct ?? null,
      brightness: snapshot?.brightness ?? null,
      counterValue: snapshot?.counterValue ?? null,
      buttonRedPressed: snapshot?.buttonRedPressed ?? null,
      buttonBlackPressed: snapshot?.buttonBlackPressed ?? null,
      ledGreenOn: snapshot?.ledGreenOn ?? null,
      ledOrangeOn: snapshot?.ledOrangeOn ?? null,
      uptimeMs: snapshot?.uptimeMs ?? null,
      uptimeIngestTs: snapshot?.uptimeIngestTs ?? null
    };
  }, [
    studentBeforePipelineDisturbedFeedSource,
    studentDeviceViewDisturbed,
    studentOwnDeviceId,
    studentSelectedDeviceStateBase
  ]);

  const studentAfterPipelineDisturbedFeedSource = useMemo(() => {
    return applyFeedScenarioDisturbances(
      studentPipelineFeed,
      feedScenarioConfig?.scenarioOverlays,
      disturbanceNowEpochMs
    );
  }, [disturbanceNowEpochMs, feedScenarioConfig?.scenarioOverlays, studentPipelineFeed]);

  const studentFeedSourceEvents = useMemo(() => {
    return studentFeedSource === 'AFTER_PIPELINE'
      ? studentAfterPipelineDisturbedFeedSource
      : studentBeforePipelineDisturbedFeedSource;
  }, [
    studentAfterPipelineDisturbedFeedSource,
    studentBeforePipelineDisturbedFeedSource,
    studentFeedSource
  ]);

  const studentNextDisturbanceReleaseAt = useMemo(() => {
    if (!studentData && studentFeedSource !== 'AFTER_PIPELINE') {
      return null;
    }
    const source = studentFeedSource === 'AFTER_PIPELINE' ? studentPipelineFeed : studentData?.feed ?? [];
    return nextFeedScenarioReleaseAt(
      source,
      feedScenarioConfig?.scenarioOverlays,
      disturbanceNowEpochMs
    );
  }, [
    disturbanceNowEpochMs,
    feedScenarioConfig?.scenarioOverlays,
    studentData,
    studentFeedSource,
    studentPipelineFeed
  ]);

  const studentVisibleFeed = useMemo(() => {
    return studentFeedSourceEvents
      .filter((event) => {
        if (!studentShowInternal && (event.isInternal || isTelemetryEvent(event))) {
          return false;
        }
        return feedMatchesTopic(event, studentTopicFilter);
      })
      .slice(0, MAX_FEED_EVENTS);
  }, [studentFeedSourceEvents, studentShowInternal, studentTopicFilter]);

  useEffect(() => {
    if (session?.role !== 'STUDENT') {
      studentVisibleFeedInitializedRef.current = false;
      studentVisibleFeedIdsRef.current = new Set();
      return;
    }
    const nextIds = new Set(studentVisibleFeed.map((event) => eventFeedKey(event)));
    if (!studentVisibleFeedInitializedRef.current) {
      studentVisibleFeedInitializedRef.current = true;
      studentVisibleFeedIdsRef.current = nextIds;
      return;
    }
    const previousIds = studentVisibleFeedIdsRef.current;
    const newlyVisible = studentVisibleFeed.filter((event) => !previousIds.has(eventFeedKey(event)));
    studentVisibleFeedIdsRef.current = nextIds;
    if (newlyVisible.length > 0) {
      markFeedEventsRecent(newlyVisible);
    }
  }, [markFeedEventsRecent, session?.role, studentVisibleFeed]);

  const adminBeforeDisturbancesFeedSource = useMemo(() => {
    if (!adminData || session?.role !== 'ADMIN') {
      return [];
    }
    return adminData.events;
  }, [adminData, session?.role]);

  const adminAfterDisturbancesFeedSource = useMemo(() => {
    if (!adminData || session?.role !== 'ADMIN') {
      return [];
    }
    return applyFeedScenarioDisturbances(
      adminData.events,
      feedScenarioConfig?.scenarioOverlays,
      disturbanceNowEpochMs
    );
  }, [adminData, disturbanceNowEpochMs, feedScenarioConfig?.scenarioOverlays, session?.role]);

  const adminAfterPipelineDisturbedFeedSource = useMemo(() => {
    if (session?.role !== 'ADMIN') {
      return [];
    }
    return applyFeedScenarioDisturbances(
      adminPipelineFeed,
      feedScenarioConfig?.scenarioOverlays,
      disturbanceNowEpochMs
    );
  }, [adminPipelineFeed, disturbanceNowEpochMs, feedScenarioConfig?.scenarioOverlays, session?.role]);

  const adminFeedSourceEvents = useMemo(() => {
    if (adminFeedSource === 'BEFORE_DISTURBANCES') {
      return adminBeforeDisturbancesFeedSource;
    }
    if (adminFeedSource === 'AFTER_PIPELINE') {
      return adminAfterPipelineDisturbedFeedSource;
    }
    return adminAfterDisturbancesFeedSource;
  }, [
    adminAfterDisturbancesFeedSource,
    adminAfterPipelineDisturbedFeedSource,
    adminBeforeDisturbancesFeedSource,
    adminFeedSource
  ]);

  const adminNextDisturbanceReleaseAt = useMemo(() => {
    if (!adminData || session?.role !== 'ADMIN' || (adminPage !== 'feed' && adminPage !== 'pipeline')) {
      return null;
    }
    if (adminPage === 'pipeline') {
      return nextFeedScenarioReleaseAt(
        adminPipelineFeed,
        feedScenarioConfig?.scenarioOverlays,
        disturbanceNowEpochMs
      );
    }
    if (adminFeedSource === 'BEFORE_DISTURBANCES') {
      return null;
    }
    const source = adminFeedSource === 'AFTER_PIPELINE' ? adminPipelineFeed : adminData.events;
    return nextFeedScenarioReleaseAt(
      source,
      feedScenarioConfig?.scenarioOverlays,
      disturbanceNowEpochMs
    );
  }, [
    adminData,
    adminPage,
    adminFeedSource,
    adminPipelineFeed,
    disturbanceNowEpochMs,
    feedScenarioConfig?.scenarioOverlays,
    session?.role
  ]);

  const nextDisturbanceReleaseAt = useMemo(() => {
    const candidates = [studentNextDisturbanceReleaseAt, adminNextDisturbanceReleaseAt].filter(
      (value): value is number => value !== null
    );
    if (candidates.length === 0) {
      return null;
    }
    return Math.min(...candidates);
  }, [adminNextDisturbanceReleaseAt, studentNextDisturbanceReleaseAt]);

  useEffect(() => {
    if (nextDisturbanceReleaseAt === null) {
      return;
    }
    const now = Date.now();
    const waitMs = Math.max(25, nextDisturbanceReleaseAt - now);
    const timerId = window.setTimeout(() => {
      setFeedDisturbanceClockMs(Date.now());
    }, waitMs);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [nextDisturbanceReleaseAt]);

  const adminVisibleFeed = useMemo(() => {
    return adminFeedSourceEvents
      .filter((event) => {
        if (!adminIncludeInternal && (event.isInternal || isTelemetryEvent(event))) {
          return false;
        }
        return feedMatchesTopic(event, adminTopicFilter);
      })
      .slice(0, MAX_FEED_EVENTS);
  }, [adminFeedSourceEvents, adminIncludeInternal, adminTopicFilter]);

  const adminPipelineVisibleFeed = useMemo(() => {
    return adminAfterPipelineDisturbedFeedSource
      .filter((event) => {
        if (
          adminPipelineGroupKey.trim() &&
          event.groupKey?.trim().toLowerCase() !== adminPipelineGroupKey.trim().toLowerCase()
        ) {
          return false;
        }
        if (!adminIncludeInternal && (event.isInternal || isTelemetryEvent(event))) {
          return false;
        }
        return feedMatchesTopic(event, adminTopicFilter);
      })
      .slice(0, MAX_FEED_EVENTS);
  }, [
    adminAfterPipelineDisturbedFeedSource,
    adminIncludeInternal,
    adminPipelineGroupKey,
    adminTopicFilter
  ]);

  const studentFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of studentVisibleFeed) {
      values.set(eventFeedKey(event), eventValueSummary(event));
    }
    return values;
  }, [studentVisibleFeed]);

  const studentFeedViewMode: FeedViewMode = studentPipelineSimplifiedView ? 'rendered' : feedViewMode;
  const adminFeedViewMode: FeedViewMode = adminPipelineSimplifiedView ? 'rendered' : feedViewMode;

  const adminFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of adminVisibleFeed) {
      values.set(eventFeedKey(event), eventValueSummary(event));
    }
    return values;
  }, [adminVisibleFeed]);

  const adminPipelineFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of adminPipelineVisibleFeed) {
      values.set(eventFeedKey(event), eventValueSummary(event));
    }
    return values;
  }, [adminPipelineVisibleFeed]);

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

  const deploymentGitHash = useMemo(() => {
    const raw = session?.deploymentGitHash ?? '';
    const normalized = raw.trim();
    return normalized.length > 0 ? normalized : 'unknown';
  }, [session?.deploymentGitHash]);
  const deploymentCommitUrl = useMemo(() => {
    const raw = session?.deploymentCommitUrl ?? '';
    return raw.trim();
  }, [session?.deploymentCommitUrl]);
  const deploymentDirty = useMemo(() => {
    return Boolean(session?.deploymentDirty);
  }, [session?.deploymentDirty]);

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

  const adminPipelineContextNotice = useMemo(() => {
    if (!adminPipelineGroupContextKey) {
      if (session?.role === 'ADMIN' && adminConfiguredPipelineDevice.length === 0) {
        return t('pipelineNoLecturerDeviceConfigured');
      }
      return null;
    }
    return `${t('pipelineViewingGroupNotice')}: ${adminPipelineGroupContextKey}`;
  }, [adminConfiguredPipelineDevice.length, adminPipelineGroupContextKey, session?.role, t]);

  const adminLatestEvent = useMemo(() => {
    if (!adminData || adminData.events.length === 0) {
      return null;
    }
    return adminData.events[0];
  }, [adminData]);

  const systemStatusSeries = useMemo(() => {
    return adminSystemStatus?.eventsLast10Minutes ?? [];
  }, [adminSystemStatus]);

  const systemStatusMaxEventCount = useMemo(() => {
    if (systemStatusSeries.length === 0) {
      return 1;
    }
    const max = systemStatusSeries.reduce((current, point) => Math.max(current, point.eventCount), 0);
    return Math.max(1, max);
  }, [systemStatusSeries]);

  const systemStatusRamUsagePct = useMemo(() => {
    if (!adminSystemStatus) {
      return null;
    }
    const used = adminSystemStatus.ramUsedBytes;
    const total = adminSystemStatus.ramTotalBytes;
    if (used === null || total === null || total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, (used / total) * 100));
  }, [adminSystemStatus]);

  const selectedSystemDataExportParts = useMemo(() => {
    return selectedSystemDataParts(systemDataExportSelection);
  }, [systemDataExportSelection]);

  const availableSystemDataImportParts = useMemo(() => {
    if (!systemDataImportVerify) {
      return [];
    }
    return systemDataImportVerify.availableParts.map((entry) => entry.part);
  }, [systemDataImportVerify]);

  const selectedSystemDataImportParts = useMemo(() => {
    const available = new Set(availableSystemDataImportParts);
    return selectedSystemDataParts(systemDataImportSelection).filter((part) => available.has(part));
  }, [availableSystemDataImportParts, systemDataImportSelection]);

  const counterResetBusy = counterResetTarget
    ? counterResetTarget.isVirtual
      ? busyKey === `admin-virtual-counter-reset-${counterResetTarget.deviceId}`
      : busyKey === `admin-command-${counterResetTarget.deviceId}-COUNTER_RESET-undefined`
    : false;
  const selectedAdminVirtualDevice = useMemo(() => {
    if (!adminData || !virtualControlDeviceId) {
      return null;
    }
    return adminData.virtualDevices.find((entry) => entry.deviceId === virtualControlDeviceId) ?? null;
  }, [adminData, virtualControlDeviceId]);

  const navigateAdminPage = useCallback((nextPage: AdminPage) => {
    if (nextPage === 'pipeline') {
      openAdminDefaultPipelineBuilder();
      return;
    }
    setAdminPage(nextPage);
  }, [openAdminDefaultPipelineBuilder]);

  const openSettingsSection = useCallback(() => {
    if (session?.role === 'ADMIN') {
      setAdminPage('settings');
      setUserMenuOpen(false);
      return;
    }
    setStudentSettingsOpen(true);
    setUserMenuOpen(false);
  }, [session]);

  const closeAdminPasswordModal = useCallback(() => {
    setAdminPasswordModalOpen(false);
    setAdminPasswordCurrent('');
    setAdminPasswordNext('');
    setAdminPasswordConfirm('');
    setAdminPasswordError(null);
  }, []);

  const openAdminPasswordModal = useCallback(() => {
    if (session?.role !== 'ADMIN') {
      return;
    }
    setAdminPasswordModalOpen(true);
    setAdminPasswordCurrent('');
    setAdminPasswordNext('');
    setAdminPasswordConfirm('');
    setAdminPasswordError(null);
    setUserMenuOpen(false);
  }, [session?.role]);

  const saveAdminPassword = useCallback(async () => {
    if (!token || session?.role !== 'ADMIN') {
      return;
    }

    const currentPassword = adminPasswordCurrent.trim();
    const newPassword = adminPasswordNext.trim();
    const confirmPassword = adminPasswordConfirm.trim();

    if (!currentPassword) {
      setAdminPasswordError(t('adminPasswordCurrentRequired'));
      return;
    }
    if (!newPassword) {
      setAdminPasswordError(t('adminPasswordNewRequired'));
      return;
    }
    if (newPassword === currentPassword) {
      setAdminPasswordError(t('adminPasswordDifferentRequired'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setAdminPasswordError(t('adminPasswordConfirmMismatch'));
      return;
    }

    setBusyKey('admin-password-change');
    setAdminPasswordError(null);
    try {
      await api.updateAdminPassword(token, currentPassword, newPassword);
      pushToast(t('adminPasswordChanged'));
      closeAdminPasswordModal();
    } catch (error) {
      setAdminPasswordError(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }, [
    adminPasswordConfirm,
    adminPasswordCurrent,
    adminPasswordNext,
    closeAdminPasswordModal,
    pushToast,
    session?.role,
    t,
    token
  ]);

  const openAboutModal = useCallback(() => {
    setAboutModalOpen(true);
    setUserMenuOpen(false);
  }, []);

  const formatTs = useCallback(
    (value: TimestampValue): string => {
      return formatTimestamp(value, language, timeFormat24h);
    },
    [language, timeFormat24h]
  );
  const deploymentBuildTimeLabel = useMemo(() => {
    return formatTs(session?.deploymentBuildTs ?? null);
  }, [formatTs, session?.deploymentBuildTs]);

  const eventSourceLabel = useCallback((event: CanonicalEvent): string => {
    const source = event.source?.trim();
    if (source) {
      return source;
    }
    return event.deviceId;
  }, []);

  const selectedEventFields = useMemo<Array<[string, string]>>(() => {
    if (!selectedEvent) {
      return [];
    }

    return [
      [t('eventFieldId'), selectedEvent.id],
      [t('eventFieldSource'), eventSourceLabel(selectedEvent)],
      [t('eventFieldDeviceId'), selectedEvent.deviceId],
      [t('eventFieldTopic'), selectedEvent.topic],
      [t('eventFieldEventType'), selectedEvent.eventType],
      [t('eventFieldCategory'), selectedEvent.category],
      [t('eventFieldIngestTs'), formatTs(selectedEvent.ingestTs)],
      [t('eventFieldDeviceTs'), formatTs(selectedEvent.deviceTs)],
      [t('eventFieldValue'), eventValueSummary(selectedEvent) || '-'],
      [t('eventFieldValid'), String(selectedEvent.valid)],
      [t('eventFieldValidationErrors'), selectedEvent.validationErrors ?? '-'],
      [t('eventFieldInternal'), String(selectedEvent.isInternal)],
      [t('eventFieldGroupKey'), selectedEvent.groupKey ?? '-'],
      [t('eventFieldSequenceNo'), selectedEvent.sequenceNo == null ? '-' : String(selectedEvent.sequenceNo)],
      [t('eventFieldScenarioFlags'), selectedEvent.scenarioFlags]
    ];
  }, [eventSourceLabel, formatTs, selectedEvent, t]);

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

  const selectedEventPayloadPretty = useMemo(() => {
    if (!selectedEvent) {
      return '';
    }
    const parsedPayload = tryParsePayload(selectedEvent.payloadJson);
    return JSON.stringify(parsedPayload ?? selectedEvent.payloadJson, null, 2);
  }, [selectedEvent]);

  const studentFeedRows = useMemo(() => {
    if (studentVisibleFeed.length === 0) {
      return null;
    }
    return studentVisibleFeed.map((eventItem) => {
      const key = eventFeedKey(eventItem);
      return (
        <tr
          key={key}
          className={`feed-row-clickable ${recentFeedEventIds[key] ? 'feed-row-new' : ''}`}
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
          <td>{eventSourceLabel(eventItem)}</td>
          <td className="mono">{eventItem.topic}</td>
          <td className="mono raw-cell">
            {studentFeedViewMode === 'rendered'
              ? (studentFeedValues.get(key) ?? '')
              : eventItem.payloadJson}
          </td>
        </tr>
      );
    });
  }, [eventSourceLabel, formatTs, recentFeedEventIds, studentFeedValues, studentFeedViewMode, studentVisibleFeed]);

  const adminDeviceCards = useMemo(() => {
    const adminDevices = adminData?.devices;
    if (!adminDevices) {
      return null;
    }
    const configuredAdminDeviceId = adminData?.settings.adminDeviceId ?? null;
    return adminDevices.map((device) => {
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
      const isConfiguredAdminDevice = configuredAdminDeviceId === device.deviceId;

      return (
        <article className="device-card" key={device.deviceId}>
          <header>
            <strong>{device.deviceId}</strong>
            <div className="device-header-actions">
              {!isConfiguredAdminDevice ? (
                <button
                  className="icon-button"
                  type="button"
                  title={t('pinSettings')}
                  aria-label={`${t('pinSettings')} ${device.deviceId}`}
                  onClick={() => openPinEditor(device.deviceId)}
                >
                  <SettingsIcon />
                </button>
              ) : null}
              <span className={`chip ${device.online ? 'ok' : 'warn'}`}>
                {statusLabel(device.online, language)}
              </span>
              {isConfiguredAdminDevice ? (
                <span className="chip">
                  <span className="inline-icon" aria-hidden="true">
                    <AdminIcon />
                  </span>
                  {t('adminDeviceSetting')}
                </span>
              ) : null}
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
                <span className="metric-label">{t('colorRed')}:</span>
                <span className={`state-label ${redButtonClass}`}>{redButton}</span>
              </span>
            </div>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorBlack')}:</span>
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
    });
  }, [
    adminData?.devices,
    adminData?.settings.adminDeviceId,
    adminDeviceIpById,
    adminDeviceSnapshots,
    busyKey,
    formatTs,
    language,
    nowEpochMs,
    openCounterResetModal,
    openPinEditor,
    sendAdminDeviceCommand,
    t
  ]);

  const adminVirtualDeviceCards = useMemo(() => {
    const adminVirtualDevices = adminData?.virtualDevices;
    if (!adminVirtualDevices) {
      return null;
    }
    return adminVirtualDevices.map((device) => {
      const redButtonClass = device.buttonRedPressed ? 'state-pressed' : 'state-released';
      const blackButtonClass = device.buttonBlackPressed ? 'state-pressed' : 'state-released';
      const counterBusy = busyKey === `admin-virtual-counter-reset-${device.deviceId}`;

      return (
        <article className="device-card" key={device.deviceId}>
          <header>
            <strong>{device.deviceId}</strong>
            <div className="device-header-actions">
              <button
                className="button tiny secondary"
                type="button"
                onClick={() => openVirtualControlModal(device.deviceId)}
              >
                {t('openControls')}
              </button>
            </div>
          </header>

          <p>{t('groupConfig')}: {device.groupKey}</p>
          <p title={formatTs(device.updatedAt)}>
            {t('lastEvent')}: {formatRelativeFromNow(device.updatedAt, nowEpochMs, language)}
          </p>

          <div className="device-metrics-grid">
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="temperature" />
              </span>
              <span className="metric-text">{device.temperatureC.toFixed(1)} °C</span>
            </div>
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="humidity" />
              </span>
              <span className="metric-text">{Math.round(device.humidityPct)} %</span>
            </div>
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="brightness" />
              </span>
              <span className="metric-text">{formatBrightnessMeasurement(device.brightness)}</span>
            </div>
            <button
              className="device-metric counter-metric-trigger"
              type="button"
              onClick={() => openCounterResetModal(device.deviceId, true)}
              title={t('commandCounterReset')}
              disabled={counterBusy}
            >
              <span className="metric-icon">
                <MetricIcon kind="counter" />
              </span>
              <span className="metric-text">{device.counterValue}</span>
            </button>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorRed')}:</span>
                <span className={`state-label ${redButtonClass}`}>
                  {device.buttonRedPressed ? t('statePressed') : t('stateReleased')}
                </span>
              </span>
            </div>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorBlack')}:</span>
                <span className={`state-label ${blackButtonClass}`}>
                  {device.buttonBlackPressed ? t('statePressed') : t('stateReleased')}
                </span>
              </span>
            </div>
          </div>
        </article>
      );
    });
  }, [
    adminData?.virtualDevices,
    busyKey,
    formatTs,
    language,
    nowEpochMs,
    openCounterResetModal,
    openVirtualControlModal,
    t
  ]);

  const adminFeedRows = useMemo(() => {
    if (adminVisibleFeed.length === 0) {
      return null;
    }
    return adminVisibleFeed.map((eventItem) => {
      const key = eventFeedKey(eventItem);
      return (
        <tr
          key={key}
          className={`feed-row-clickable ${recentFeedEventIds[key] ? 'feed-row-new' : ''}`}
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
          <td>{eventSourceLabel(eventItem)}</td>
          <td className="mono">{eventItem.topic}</td>
          <td className="mono raw-cell">
            {adminFeedViewMode === 'rendered'
              ? (adminFeedValues.get(key) ?? '')
              : eventItem.payloadJson}
          </td>
        </tr>
      );
    });
  }, [adminFeedValues, adminFeedViewMode, adminVisibleFeed, eventSourceLabel, formatTs, recentFeedEventIds]);

  const adminPipelineFeedRows = useMemo(() => {
    if (adminPipelineVisibleFeed.length === 0) {
      return null;
    }
    return adminPipelineVisibleFeed.map((eventItem) => {
      const key = eventFeedKey(eventItem);
      return (
        <tr
          key={key}
          className={`feed-row-clickable ${recentFeedEventIds[key] ? 'feed-row-new' : ''}`}
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
          <td>{eventSourceLabel(eventItem)}</td>
          <td className="mono">{eventItem.topic}</td>
          <td className="mono raw-cell">
            {adminFeedViewMode === 'rendered'
              ? (adminPipelineFeedValues.get(key) ?? '')
              : eventItem.payloadJson}
          </td>
        </tr>
      );
    });
  }, [
    adminPipelineFeedValues,
    adminFeedViewMode,
    adminPipelineVisibleFeed,
    eventSourceLabel,
    formatTs,
    recentFeedEventIds
  ]);

  return (
    <div className="app-shell">
      <AppTopBar
        t={t}
        hasSession={!!session}
        userMenuRef={userMenuRef}
        userMenuOpen={userMenuOpen}
        userMenuLabel={userMenuLabel}
        wsConnection={wsConnection}
        wsLabel={wsLabel}
        roleLabel={roleLabel}
        language={language}
        showPipelineViewModeToggle={session?.role === 'ADMIN'}
        pipelineSimplifiedView={adminPipelineSimplifiedView}
        logoutBusy={busyKey === 'logout'}
        onToggleUserMenu={() => setUserMenuOpen((open) => !open)}
        onSetLanguage={setManualLanguage}
        onPipelineSimplifiedViewChange={setAdminPipelineSimplifiedView}
        showAdminPasswordAction={session?.role === 'ADMIN'}
        onOpenAdminPassword={openAdminPasswordModal}
        onOpenSettings={openSettingsSection}
        onOpenAbout={openAboutModal}
        onLogout={handleLogout}
      />

      <main className="content">
        <ToastStack t={t} toasts={toasts} onDismiss={dismissToast} />

        <MainStateBanners
          t={t}
          errorMessage={errorMessage}
          booting={booting}
        />

        {!booting && !session ? (
          <LoginSection
            t={t}
            username={loginUsername}
            pin={loginPin}
            busy={busyKey === 'login'}
            onUsernameChange={setLoginUsername}
            onPinChange={setLoginPin}
            onSubmit={() => {
              void handleLogin();
            }}
          />
        ) : null}

        {!booting && session?.role === 'STUDENT' && studentData && !studentOnboardingDone ? (
          <StudentOnboardingSection
            t={t}
            language={language}
            displayNameDraft={displayNameDraft}
            busy={busyKey === 'student-onboarding'}
            onDisplayNameChange={setDisplayNameDraft}
            onSetLanguage={setManualLanguage}
            onSubmit={() => {
              continueStudentOnboarding().catch((error) => setErrorMessage(toErrorMessage(error)));
            }}
          />
        ) : null}

        {!booting && session?.role === 'STUDENT' && studentData && studentOnboardingDone ? (
          <div className="dashboard-grid">
            <StudentOverviewSection
              t={t}
              taskTitle={taskTitle(studentData.activeTask, language)}
              taskDescription={taskActiveDescription(studentData.activeTask, language)}
            />

            {studentData.capabilities.canSendDeviceCommands ? (
              <StudentCommandsSection
                t={t}
                studentCommandWhitelist={studentData.capabilities.studentCommandWhitelist}
                deviceId={studentOwnDeviceId}
                deviceState={studentSelectedDeviceState}
                isCommandBusy={(command, on) => {
                  return busyKey === `student-command-${command}-${String(on)}-${studentOwnDeviceId.toLowerCase()}`;
                }}
                onSendCommand={sendStudentCommand}
              />
            ) : null}

            {studentData.settings.studentVirtualDeviceVisible && studentData.virtualDevice && studentVirtualPatch ? (
              <StudentVirtualDeviceSection
                t={t}
                deviceId={studentData.virtualDevice.deviceId}
                patch={studentVirtualPatch}
                mirrorModeActive={studentData.settings.virtualDeviceTopicMode === 'PHYSICAL_TOPIC'}
                onSetField={setStudentVirtualField}
                onSetButtonState={setStudentVirtualButtonState}
              />
            ) : null}

            {studentPipelineEditorView && studentPipelineEditorView.permissions.visible !== false ? (
              <PipelineBuilderSection
                t={t}
                title={t('pipelineBuilder')}
                view={studentPipelineEditorView}
                draftProcessing={studentPipelineDraft}
                onChangeSlotBlock={changeStudentPipelineSlot}
                onSwapSlots={swapStudentPipelineSlots}
                onChangeSlotConfig={changeStudentPipelineSlotConfig}
                onAddSink={addStudentPipelineSink}
                onRemoveSink={removeStudentPipelineSink}
                onConfigureSendEventSink={configureStudentPipelineSendSink}
                sendEventTargetTypeOptions={studentSendEventTargetTypeOptions}
                lecturerDeviceAvailable={Boolean(studentData.settings.adminDeviceId?.trim())}
                physicalDeviceIds={studentAllowedPhysicalTargetIds}
                virtualDeviceIds={[]}
                onResetState={resetStudentPipelineState}
                onResetSinkCounter={resetStudentPipelineSinkCounter}
                stateControlBusy={busyKey === 'student-pipeline-state'}
                sinkRuntimeBusy={busyKey === 'student-pipeline-sink'}
                simplifiedView={studentPipelineSimplifiedView}
                formatTs={formatTs}
              />
            ) : null}

            <StudentFeedSection
              t={t}
              studentFeedPaused={studentFeedPaused}
              feedViewMode={studentFeedViewMode}
              showRawViewToggle={!studentPipelineSimplifiedView}
              onTogglePause={() => setStudentFeedPaused((value) => !value)}
              onToggleFeedViewMode={() =>
                setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
              }
              onClearFeed={() => {
                if (studentFeedSource === 'AFTER_PIPELINE') {
                  setStudentPipelineFeed([]);
                  return;
                }
                setStudentData((previous) => {
                  if (!previous) {
                    return previous;
                  }
                  return { ...previous, feed: [] };
                });
              }}
              showSendEventButton={Boolean(studentData.capabilities.studentSendEventEnabled)}
              onOpenSendEventModal={openStudentMqttEventModal}
              studentTopicFilter={studentTopicFilter}
              onStudentTopicFilterChange={setStudentTopicFilter}
              canFilterByTopic={studentData.capabilities.canFilterByTopic}
              showInternalEventsToggle={
                studentData.capabilities.showInternalEventsToggle && !studentPipelineSimplifiedView
              }
              studentShowInternal={studentShowInternal}
              onStudentShowInternalChange={setStudentShowInternal}
              showFeedSourceSelector={studentPipelineEnabled && !studentPipelineSimplifiedView}
              studentFeedSource={studentFeedSource}
              onStudentFeedSourceChange={setStudentFeedSourceFromUi}
              studentVisibleFeedCount={studentVisibleFeed.length}
              studentFeedRows={studentFeedRows}
            />
          </div>
        ) : null}

        {!booting && session?.role === 'ADMIN' && adminData ? (
          <div className="admin-page-shell">
            <AdminPageNav t={t} adminPage={adminPage} onChangePage={navigateAdminPage} />

            <div className="dashboard-grid">
              {adminPage === 'dashboard' ? (
                <AdminDashboardSection
                  t={t}
                  wsConnection={wsConnection}
                  wsLabel={wsLabel}
                  deviceCount={adminData.devices.length}
                  onlineDeviceCount={adminOnlineDeviceCount}
                  groupCount={adminData.groups.length}
                  onlineUserCount={adminOnlineUserCount}
                  eventCount={adminData.events.length}
                  currentTaskLabel={adminActiveTask ? taskTitle(adminActiveTask, language) : '-'}
                  lastEventLabel={
                    adminLatestEvent
                      ? formatRelativeFromNow(adminLatestEvent.ingestTs, nowEpochMs, language)
                      : '-'
                  }
                  cloudflareTunnel={adminSystemStatus?.cloudflareTunnel ?? null}
                  formatTs={formatTs}
                  onNavigate={navigateAdminPage}
                />
              ) : null}

              {adminPage === 'settings' ? (
                <AdminSettingsSection
                  t={t}
                  mode={adminSettingsDraftMode}
                  timeFormat24h={adminSettingsDraftTimeFormat24h}
                  studentVirtualDeviceVisible={adminSettingsDraftVirtualVisible}
                  adminDeviceId={adminSettingsDraftAdminDeviceId}
                  virtualDeviceTopicMode={adminSettingsDraftVirtualDeviceTopicMode}
                  physicalDeviceOptions={adminData.devices.map((device) => device.deviceId)}
                  busy={busyKey === 'admin-settings'}
                  onModeChange={setAdminSettingsDraftMode}
                  onTimeFormat24hChange={setAdminSettingsDraftTimeFormat24h}
                  onStudentVirtualDeviceVisibleChange={setAdminSettingsDraftVirtualVisible}
                  onAdminDeviceIdChange={setAdminSettingsDraftAdminDeviceId}
                  onVirtualDeviceTopicModeChange={setAdminSettingsDraftVirtualDeviceTopicMode}
                  onSave={saveAdminSettings}
                />
              ) : null}

              {adminPage === 'systemStatus' ? (
                <SystemStatusSection
                  t={t}
                  language={language}
                  timeFormat24h={timeFormat24h}
                  busyKey={busyKey}
                  adminSystemStatus={adminSystemStatus}
                  systemStatusSeries={systemStatusSeries}
                  systemStatusMaxEventCount={systemStatusMaxEventCount}
                  systemStatusRamUsagePct={systemStatusRamUsagePct}
                  formatTs={formatTs}
                  refreshAdminData={refreshAdminData}
                  onOpenResetEventsModal={() => setResetEventsModalOpen(true)}
                  systemDataExportSelection={systemDataExportSelection}
                  onToggleSystemDataExportPart={toggleSystemDataExportPart}
                  onExportSystemData={exportSystemData}
                  selectedSystemDataExportPartsCount={selectedSystemDataExportParts.length}
                  systemDataImportFileName={systemDataImportFileName}
                  onSystemImportFileSelected={handleSystemImportFileSelected}
                  onVerifySystemImport={verifySystemImport}
                  onApplySystemImport={applySystemImport}
                  systemDataImportFilePresent={!!systemDataImportFile}
                  systemDataImportVerify={systemDataImportVerify}
                  systemDataImportSelection={systemDataImportSelection}
                  onToggleSystemDataImportPart={toggleSystemDataImportPart}
                  selectedSystemDataImportPartsCount={selectedSystemDataImportParts.length}
                />
              ) : null}

              {adminPage === 'tasks' ? (
                <AdminTasksSection
                  t={t}
                  tasks={adminData.tasks}
                  selectedTaskId={adminPipelineTaskId}
                  taskLabel={(task) => taskTitle(task, language)}
                  taskDescriptionLabel={(task) => taskDescription(task, language)}
                  taskConfig={adminTaskPipelineConfigDraft ?? adminTaskPipelineConfig}
                  taskConfigBusy={
                    busyKey === 'admin-task-pipeline-config' ||
                    busyKey === 'admin-task-pipeline-config-load'
                  }
                  taskMutationBusy={busyKey === 'admin-task-update' || busyKey === 'admin-task-create'}
                  taskReorderBusy={busyKey === 'admin-task-reorder'}
                  onActivateTask={activateTask}
                  isTaskActivationBusy={(taskId) => busyKey === `activate-${taskId}`}
                  isTaskDeleteBusy={(taskId) => busyKey === `admin-task-delete-${taskId}`}
                  onSelectTask={selectAdminPipelineTask}
                  onToggleVisibleToStudents={changeTaskPipelineVisibleToStudents}
                  onStudentEventVisibilityScopeChange={changeTaskPipelineStudentEventVisibilityScope}
                  onStudentCommandTargetScopeChange={changeTaskPipelineStudentCommandTargetScope}
                  onStudentSendEventEnabledChange={changeTaskPipelineStudentSendEventEnabled}
                  onStudentDeviceViewDisturbedChange={changeTaskPipelineStudentDeviceViewDisturbed}
                  onToggleAllowedBlock={toggleTaskPipelineAllowedBlock}
                  onScenarioOverlaysChange={changeTaskPipelineScenarioOverlays}
                  onSaveTaskConfig={saveAdminTaskPipelineConfig}
                  onSaveTaskDetails={saveAdminTaskDetails}
                  onCreateTask={createAdminTask}
                  onReorderTasks={reorderAdminTasks}
                  onDeleteTask={deleteAdminTask}
                />
              ) : null}

              {adminPage === 'groups' ? (
                <AdminGroupsSection
                  t={t}
                  groups={adminData.groups}
                  onShowPipelineBuilder={openAdminPipelineBuilderForGroup}
                  onResetGroupProgress={(groupKey) => {
                    void resetAdminGroupProgress(groupKey);
                  }}
                  isResetBusy={(groupKey) => busyKey === `group-reset-${groupKey}`}
                />
              ) : null}

              {adminPage === 'scenarios' ? (
                <PipelineScenariosSection
                  t={t}
                  overlays={feedScenarioDraft}
                  studentDeviceViewDisturbed={feedScenarioStudentDeviceViewDisturbedDraft}
                  busy={busyKey === 'admin-scenarios'}
                  onOverlaysChange={changeFeedScenarioOverlays}
                  onStudentDeviceViewDisturbedChange={changeFeedScenarioStudentDeviceViewDisturbed}
                  onSave={saveAdminFeedScenarios}
                />
              ) : null}

              {adminPage === 'streamSources' ? (
                <AdminStreamSourcesSection
                  t={t}
                  sources={adminStreamSources}
                  endpointDrafts={adminStreamSourceEndpointDrafts}
                  busyKey={busyKey}
                  formatTs={formatTs}
                  onEndpointDraftChange={changeAdminStreamSourceEndpointDraft}
                  onToggleEnabled={toggleAdminStreamSourceEnabled}
                  onSaveConfig={saveAdminStreamSourceConfig}
                  onResetCounter={resetAdminStreamSourceCounter}
                />
              ) : null}

              {adminPage === 'pipeline' && adminPipelineEditorView ? (
                <PipelineBuilderSection
                  t={t}
                  title={t('pipelineBuilder')}
                  view={adminPipelineEditorView}
                  contextNotice={adminPipelineContextNotice}
                  contextActionLabel={adminPipelineGroupContextKey ? t('pipelineBackToLecturer') : undefined}
                  onContextAction={adminPipelineGroupContextKey ? openAdminDefaultPipelineBuilder : undefined}
                  draftProcessing={adminPipelineEditorView.processing}
                  onChangeSlotBlock={changeAdminPipelineSlot}
                  onSwapSlots={swapAdminPipelineSlots}
                  onChangeSlotConfig={changeAdminPipelineSlotConfig}
                  onInputModeChange={changeAdminPipelineInputMode}
                  onAddSink={addAdminPipelineSink}
                  onRemoveSink={removeAdminPipelineSink}
                  onConfigureSendEventSink={configureAdminPipelineSendSink}
                  allowBroadcastSinkDeviceOption
                  onResetSinkCounter={resetAdminPipelineSinkCounter}
                  sinkRuntimeBusy={busyKey === 'admin-pipeline-sink'}
                  physicalDeviceIds={adminPhysicalDeviceIds}
                  virtualDeviceIds={adminVirtualDeviceIds}
                  lecturerDeviceAvailable={Boolean(adminConfiguredPipelineDevice)}
                  logModeStatus={adminPipelineLogModeStatus}
                  logModeStatusBusy={busyKey === 'admin-pipeline-log-status'}
                  onRefreshLogModeStatus={refreshAdminPipelineLogModeStatus}
                  logReplayFromOffset={adminPipelineReplayFromOffset}
                  onLogReplayFromOffsetChange={setAdminPipelineReplayFromOffset}
                  logReplayMaxRecords={adminPipelineReplayMaxRecords}
                  onLogReplayMaxRecordsChange={setAdminPipelineReplayMaxRecords}
                  onLogReplay={replayAdminPipelineLog}
                  logReplayBusy={busyKey === 'admin-pipeline-log-replay'}
                  logReplayResult={adminPipelineReplayResult}
                  onResetState={() => {
                    void controlAdminPipelineState('RESET_STATE');
                  }}
                  onRestartStateLost={() => {
                    void controlAdminPipelineState('RESTART_STATE_LOST');
                  }}
                  onRestartStateRetained={() => {
                    void controlAdminPipelineState('RESTART_STATE_RETAINED');
                  }}
                  stateControlBusy={busyKey === 'admin-pipeline-state'}
                  hideRestartControlsInSimpleMode
                  simplifiedView={adminPipelineSimplifiedView}
                  forceSinkEditable
                  formatTs={formatTs}
                />
              ) : null}

              {adminPage === 'pipeline' && adminPipelineEditorView ? (
                <AdminFeedSection
                  t={t}
                  title={`${t('liveFeed')} (${t('feedSourceAfterPipeline')})`}
                  adminFeedPaused={adminFeedPaused}
                  feedViewMode={adminFeedViewMode}
                  showRawViewToggle={!adminPipelineSimplifiedView}
                  onTogglePause={() => setAdminFeedPaused((value) => !value)}
                  onToggleFeedViewMode={() =>
                    setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
                  }
                  onClearFeed={() => setAdminPipelineFeed([])}
                  showPublishEventButton={false}
                  adminTopicFilter={adminTopicFilter}
                  onAdminTopicFilterChange={setAdminTopicFilter}
                  showInternalEventsToggle={!adminPipelineSimplifiedView}
                  adminIncludeInternal={adminIncludeInternal}
                  onAdminIncludeInternalChange={setAdminIncludeInternal}
                  showFeedSourceSelector={false}
                  adminVisibleFeedCount={adminPipelineVisibleFeed.length}
                  adminFeedRows={adminPipelineFeedRows}
                />
              ) : null}

              {adminPage === 'pipeline' && !adminPipelineEditorView ? (
                <section className="panel panel-animate full-width">
                  <header className="panel-header">
                    <h3>{t('pipelineBuilder')}</h3>
                  </header>
                  {adminPipelineContextNotice ? (
                    <div className="pipeline-context-banner">
                      <span>{adminPipelineContextNotice}</span>
                      {adminPipelineGroupContextKey ? (
                        <button
                          className="button tiny secondary"
                          type="button"
                          onClick={openAdminDefaultPipelineBuilder}
                        >
                          {t('pipelineBackToLecturer')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="muted">{t('loading')}</p>
                </section>
              ) : null}

              {adminPage === 'devices' ? (
                <AdminDevicesSection
                  title={t('devices')}
                  refreshLabel={t('refresh')}
                  busy={busyKey === 'admin-refresh'}
                  onRefresh={refreshAdminData}
                  cards={adminDeviceCards}
                />
              ) : null}

              {adminPage === 'virtualDevices' ? (
                <AdminDevicesSection
                  title={t('virtualDevices')}
                  refreshLabel={t('refresh')}
                  busy={busyKey === 'admin-refresh'}
                  onRefresh={refreshAdminData}
                  cards={adminVirtualDeviceCards}
                />
              ) : null}

              {adminPage === 'feed' ? (
                <AdminFeedSection
                  t={t}
                  adminFeedPaused={adminFeedPaused}
                  feedViewMode={adminFeedViewMode}
                  showRawViewToggle={!adminPipelineSimplifiedView}
                  onTogglePause={() => setAdminFeedPaused((value) => !value)}
                  onToggleFeedViewMode={() =>
                    setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
                  }
                  onClearFeed={() => {
                    if (adminFeedSource === 'AFTER_PIPELINE') {
                      setAdminPipelineFeed([]);
                      return;
                    }
                    setAdminData((previous) => {
                      if (!previous) {
                        return previous;
                      }
                      return { ...previous, events: [] };
                    });
                  }}
                  onOpenSendEventModal={openMqttEventModal}
                  adminTopicFilter={adminTopicFilter}
                  onAdminTopicFilterChange={setAdminTopicFilter}
                  showInternalEventsToggle={!adminPipelineSimplifiedView}
                  adminIncludeInternal={adminIncludeInternal}
                  onAdminIncludeInternalChange={setAdminIncludeInternal}
                  adminFeedSource={adminFeedSource}
                  onAdminFeedSourceChange={(nextSource) =>
                    setAdminFeedSource(
                      nextSource === 'AFTER_PIPELINE' ? 'AFTER_DISTURBANCES' : nextSource
                    )
                  }
                  adminVisibleFeedCount={adminVisibleFeed.length}
                  adminFeedRows={adminFeedRows}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </main>

      <AboutEplModal
        t={t}
        open={aboutModalOpen}
        deploymentGitHash={deploymentGitHash}
        deploymentCommitUrl={deploymentCommitUrl}
        buildTimeLabel={deploymentBuildTimeLabel}
        deploymentDirty={deploymentDirty}
        onClose={() => setAboutModalOpen(false)}
      />

      <StudentSettingsModal
        t={t}
        open={Boolean(session?.role === 'STUDENT' && studentOnboardingDone && studentSettingsOpen)}
        displayNameDraft={displayNameDraft}
        saveBusy={busyKey === 'display-name'}
        simplifiedView={studentPipelineSimplifiedView}
        onDisplayNameChange={setDisplayNameDraft}
        onSaveDisplayName={saveDisplayName}
        onSimplifiedViewChange={setStudentPipelineSimplifiedView}
        onClose={() => setStudentSettingsOpen(false)}
      />

      {mqttModalOpen ? (
        <AdminMqttEventModal
          t={t}
          open={mqttModalOpen}
          busy={busyKey === 'admin-mqtt-publish'}
          mode={mqttComposerMode}
          draft={mqttEventDraft}
          physicalDeviceIds={adminPhysicalDeviceIds}
          virtualDeviceIds={adminVirtualDeviceIds}
          guidedTopic={guidedMqttMessage.topic}
          guidedPayload={guidedMqttMessage.payload}
          titleKey="publishEvent"
          enableLedTab={false}
          hideRawTab
          hideModeTabs
          onClose={closeMqttEventModal}
          onSubmit={sendAdminMqttEvent}
          onModeChange={setMqttComposerModeWithSync}
          onTargetTypeChange={setMqttTargetType}
          onTemplateChange={setMqttTemplate}
          onDeviceIdChange={setMqttDeviceId}
          onDraftChange={setMqttDraftField}
          simpleMode={adminPipelineSimplifiedView}
        />
      ) : null}

      {studentMqttModalOpen ? (
        <AdminMqttEventModal
          t={t}
          open={studentMqttModalOpen}
          busy={busyKey === 'student-mqtt-publish'}
          mode={studentMqttComposerMode}
          draft={studentMqttEventDraft}
          physicalDeviceIds={studentAllowedPhysicalTargetIds}
          virtualDeviceIds={[]}
          guidedTopic={guidedStudentMqttMessage.topic}
          guidedPayload={guidedStudentMqttMessage.payload}
          titleKey="publishEvent"
          submitLabelKey="publishEvent"
          enableLedTab={false}
          hideRawTab
          hideModeTabs
          onClose={closeStudentMqttEventModal}
          onSubmit={sendStudentMqttEvent}
          onModeChange={setStudentMqttComposerModeWithSync}
          onTargetTypeChange={setStudentMqttTargetType}
          onTemplateChange={setStudentMqttTemplate}
          onDeviceIdChange={setStudentMqttDeviceId}
          onDraftChange={setStudentMqttDraftField}
          targetTypeOptions={studentSendEventTargetTypeOptions}
          simpleMode={studentPipelineSimplifiedView}
          topicPrefixLock={studentSelectedTopicPrefixDeviceId}
        />
      ) : null}

      <AppModals
        t={t}
        selectedEvent={selectedEvent}
        selectedEventFields={selectedEventFields}
        selectedEventRawJson={selectedEventRawJson}
        selectedEventPayloadPretty={selectedEventPayloadPretty}
        eventDetailsViewMode={eventDetailsViewMode}
        onToggleEventDetailsViewMode={() =>
          setEventDetailsViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
        }
        onCloseSelectedEvent={() => setSelectedEvent(null)}
        virtualControlDeviceId={virtualControlDeviceId}
        selectedAdminVirtualDevice={selectedAdminVirtualDevice}
        virtualControlPatch={virtualControlPatch}
        virtualMirrorModeActive={adminData?.settings.virtualDeviceTopicMode === 'PHYSICAL_TOPIC'}
        onCloseVirtualControlModal={closeVirtualControlModal}
        onSetModalVirtualField={setModalVirtualField}
        onSetModalVirtualButtonState={setModalVirtualButtonState}
        resetEventsModalOpen={resetEventsModalOpen}
        onCloseResetEventsModal={() => setResetEventsModalOpen(false)}
        onResetStoredEvents={resetStoredEvents}
        resetEventsBusy={busyKey === 'admin-reset-events'}
        counterResetTarget={counterResetTarget}
        onCloseCounterResetModal={closeCounterResetModal}
        onConfirmCounterReset={confirmCounterReset}
        counterResetBusy={counterResetBusy}
        pinEditorDeviceId={pinEditorDeviceId}
        pinEditorValue={pinEditorValue}
        onPinEditorValueChange={setPinEditorValue}
        pinEditorLoading={pinEditorLoading}
        pinEditorSaveBusy={pinEditorDeviceId ? busyKey === `pin-save-${pinEditorDeviceId}` : false}
        onSavePinEditor={savePinEditor}
        onClosePinEditor={closePinEditor}
        adminPasswordModalOpen={adminPasswordModalOpen}
        adminPasswordCurrent={adminPasswordCurrent}
        adminPasswordNext={adminPasswordNext}
        adminPasswordConfirm={adminPasswordConfirm}
        adminPasswordError={adminPasswordError}
        adminPasswordSaveBusy={busyKey === 'admin-password-change'}
        onAdminPasswordCurrentChange={setAdminPasswordCurrent}
        onAdminPasswordNextChange={setAdminPasswordNext}
        onAdminPasswordConfirmChange={setAdminPasswordConfirm}
        onSaveAdminPassword={() => {
          void saveAdminPassword();
        }}
        onCloseAdminPasswordModal={closeAdminPasswordModal}
      />
    </div>
  );
}
