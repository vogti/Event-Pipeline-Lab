import { Fragment, useMemo, useState, type DragEvent } from 'react';
import type { I18nKey } from '../../i18n';
import {
  buildGuidedMqttMessage,
  createMqttEventDraft,
  normalizeMqttTemplateForTarget,
  resolveMqttDeviceId
} from '../../app/mqtt-composer';
import type {
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft
} from '../../app/shared-types';
import { CloseIcon } from '../../app/shared-icons';
import { AdminMqttEventModal } from '../admin/AdminMqttEventModal';
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

interface PipelineBuilderSectionProps {
  t: (key: I18nKey) => string;
  title: string;
  view: PipelineView | null;
  contextNotice?: string | null;
  contextActionLabel?: string;
  onContextAction?: () => void;
  draftProcessing: PipelineProcessingSection | null;
  onChangeSlotBlock: (slotIndex: number, blockType: string) => void;
  onChangeSlotConfig?: (slotIndex: number, key: string, value: unknown) => void;
  onInputModeChange?: (nextMode: string) => void;
  onDeviceScopeChange?: (nextScope: string) => void;
  onIngestFiltersChange?: (nextValue: string) => void;
  onAddSink?: (sinkType: 'SEND_EVENT' | 'VIRTUAL_SIGNAL') => void;
  onRemoveSink?: (sinkId: string) => void;
  onConfigureSendEventSink?: (sinkId: string, config: Record<string, unknown>) => void;
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
  onSave: () => void;
  saveBusy: boolean;
  formatTs: (value: TimestampValue) => string;
}

function listToMultiline(value: string[]): string {
  return value.join('\n');
}

function inputModeLabel(t: (key: I18nKey) => string, mode: string): string {
  if (mode === 'LOG_MODE') {
    return t('pipelineInputModeLog');
  }
  return t('pipelineInputModeLive');
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
  return normalized.includes('DEVICE') || normalized === 'ENRICH_METADATA';
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
  if (normalized === 'LECTURER_DEVICE' || normalized === 'OWN_DEVICE') {
    return normalized;
  }
  return 'OWN_DEVICE';
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

type PipelineSinkType = 'EVENT_FEED' | 'SEND_EVENT' | 'VIRTUAL_SIGNAL';

function normalizeSinkType(raw: string): PipelineSinkType {
  const normalized = raw.trim().toUpperCase();
  if (normalized === 'SEND_EVENT' || normalized === 'DEVICE_CONTROL') {
    return 'SEND_EVENT';
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
  const usedIds = new Set<string>(['event-feed', 'virtual-signal']);
  let sendIndex = 1;
  for (const node of nodes ?? []) {
    if (!node || typeof node.type !== 'string') {
      continue;
    }
    const type = normalizeSinkType(node.type);
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

function sinkDisplayNameKey(type: PipelineSinkType): I18nKey {
  if (type === 'SEND_EVENT') {
    return 'pipelineSinkSendEvent';
  }
  if (type === 'VIRTUAL_SIGNAL') {
    return 'pipelineSinkVirtualSignal';
  }
  return 'pipelineSinkEventFeed';
}

type SampleViewMode = 'rendered' | 'raw';

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
  block: PipelineBlockObservability
): PipelineSampleEvent | null {
  if (block.samples.length === 0) {
    return null;
  }
  const selectedTrace = selectedBySlot[block.slotIndex];
  if (selectedTrace) {
    const matched = block.samples.find((sample) => sample.traceId === selectedTrace);
    if (matched) {
      return matched;
    }
  }
  return block.samples[block.samples.length - 1] ?? null;
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
  | 'EVENT_SENSOR_DHT22'
  | 'STATUS_ALL'
  | 'STATUS_HEARTBEAT'
  | 'STATUS_WIFI'
  | 'ACK_ALL'
  | 'VIRTUAL_RPC';

const FILTER_TOPIC_TEMPLATE_TO_FILTER: Record<FilterTopicTemplate, string> = {
  ANY: '#',
  EVENT_ALL: '+/event/#',
  EVENT_BUTTON: '+/event/button/#',
  EVENT_BUTTON_RED: '+/event/button/red',
  EVENT_BUTTON_BLACK: '+/event/button/black',
  EVENT_COUNTER: '+/event/counter',
  EVENT_SENSOR: '+/event/sensor/#',
  EVENT_SENSOR_LDR: '+/event/sensor/ldr',
  EVENT_SENSOR_DHT22: '+/event/sensor/dht22',
  STATUS_ALL: '+/status/#',
  STATUS_HEARTBEAT: '+/status/heartbeat',
  STATUS_WIFI: '+/status/wifi',
  ACK_ALL: '+/ack/#',
  VIRTUAL_RPC: '+/events/rpc'
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
  { id: 'EVENT_SENSOR_DHT22', labelKey: 'pipelineFilterTopicTemplateEventSensorDht22' },
  { id: 'STATUS_ALL', labelKey: 'pipelineFilterTopicTemplateStatusAll' },
  { id: 'STATUS_HEARTBEAT', labelKey: 'pipelineFilterTopicTemplateStatusHeartbeat' },
  { id: 'STATUS_WIFI', labelKey: 'pipelineFilterTopicTemplateStatusWifi' },
  { id: 'ACK_ALL', labelKey: 'pipelineFilterTopicTemplateAckAll' },
  { id: 'VIRTUAL_RPC', labelKey: 'pipelineFilterTopicTemplateVirtualRpc' }
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
  const matched = Object.entries(FILTER_TOPIC_TEMPLATE_TO_FILTER).find(([, value]) => value === normalized);
  return (matched?.[0] as FilterTopicTemplate | undefined) ?? null;
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

export function PipelineBuilderSection({
  t,
  title,
  view,
  contextNotice,
  contextActionLabel,
  onContextAction,
  draftProcessing,
  onChangeSlotBlock,
  onChangeSlotConfig,
  onInputModeChange,
  onDeviceScopeChange,
  onIngestFiltersChange,
  onAddSink,
  onRemoveSink,
  onConfigureSendEventSink,
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
  onSave,
  saveBusy,
  formatTs
}: PipelineBuilderSectionProps) {
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);
  const [expandedObservabilitySlot, setExpandedObservabilitySlot] = useState<number | null>(null);
  const [sampleViewMode, setSampleViewMode] = useState<SampleViewMode>('rendered');
  const [selectedTraceBySlot, setSelectedTraceBySlot] = useState<Record<number, string>>({});
  const [topicFilterModalSlotIndex, setTopicFilterModalSlotIndex] = useState<number | null>(null);
  const [topicFilterModalMode, setTopicFilterModalMode] = useState<FilterTopicWizardMode>('guided');
  const [topicFilterModalTemplate, setTopicFilterModalTemplate] = useState<FilterTopicTemplate>('EVENT_ALL');
  const [topicFilterModalRawValue, setTopicFilterModalRawValue] = useState('');
  const [transformPayloadModalSlotIndex, setTransformPayloadModalSlotIndex] = useState<number | null>(null);
  const [transformPayloadMappingsDraft, setTransformPayloadMappingsDraft] = useState<TransformPayloadMapping[]>([
    { from: '', to: '' }
  ]);
  const [sinkEditorSinkId, setSinkEditorSinkId] = useState<string | null>(null);
  const [sinkComposerMode, setSinkComposerMode] = useState<MqttComposerMode>('guided');
  const [sinkDraft, setSinkDraft] = useState<MqttEventDraft>(() => createMqttEventDraft());

  const guidedSinkMqttMessage = useMemo(() => buildGuidedMqttMessage(sinkDraft), [sinkDraft]);

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
  const hasEditableSection =
    view.permissions.processingEditable || view.permissions.inputEditable || view.permissions.sinkEditable;
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
  const processingSlots = buildDisplaySlots(processing);
  const libraryBlockOptions = blockOptions.filter((entry) => entry !== 'NONE');
  const observabilityBySlot = new Map<number, PipelineBlockObservability>();
  for (const block of view.observability?.blocks ?? []) {
    observabilityBySlot.set(block.slotIndex, block);
  }

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

  const onSlotDragOver = (event: DragEvent<HTMLDivElement>, slotIndex: number) => {
    if (!view.permissions.processingEditable) {
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

  const onSlotDrop = (event: DragEvent<HTMLDivElement>, slotIndex: number) => {
    if (!view.permissions.processingEditable) {
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

    const sourceBlockType = processingSlots[sourceSlotIndex]?.blockType ?? 'NONE';
    const targetBlockType = processingSlots[slotIndex]?.blockType ?? 'NONE';
    setSlotBlockType(slotIndex, sourceBlockType);
    setSlotBlockType(sourceSlotIndex, targetBlockType);
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
  const availableSinkTypes: Array<'SEND_EVENT'> = ['SEND_EVENT'];

  const setSinkDraftField = <K extends keyof MqttEventDraft>(key: K, value: MqttEventDraft[K]) => {
    setSinkDraft((previous) => ({
      ...previous,
      [key]: value
    }));
  };

  const setSinkTargetType = (targetType: MqttComposerTargetType) => {
    setSinkDraft((previous) => {
      const normalizedTemplate = normalizeMqttTemplateForTarget(targetType, previous.template);
      const resolvedDeviceId = resolveMqttDeviceId(
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
      template: normalizeMqttTemplateForTarget(previous.targetType, template)
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
    const qos = readSinkQos(config);
    const retained = readSinkRetained(config);
    const base = createMqttEventDraft();
    const initialDeviceId = resolveMqttDeviceId('physical', base.deviceId, physicalDeviceIds, virtualDeviceIds);
    setSinkComposerMode('raw');
    setSinkDraft({
      ...base,
      targetType: 'custom',
      template: 'custom',
      deviceId: initialDeviceId,
      customTopic: topic,
      customPayload: '',
      rawTopic: topic,
      rawPayload: '',
      qos,
      retained
    });
    setSinkEditorSinkId(node.id);
  };

  const saveSendEventSinkEditor = () => {
    if (!sinkEditorSinkId || !onConfigureSendEventSink) {
      return;
    }
    const topic = (sinkComposerMode === 'raw' ? sinkDraft.rawTopic : guidedSinkMqttMessage.topic).trim();
    onConfigureSendEventSink(sinkEditorSinkId, {
      topic,
      payload: '',
      qos: sinkDraft.qos,
      retained: sinkDraft.retained
    });
    setSinkEditorSinkId(null);
  };

  const setSinkComposerModeWithSync = (mode: MqttComposerMode) => {
    setSinkComposerMode(mode);
    setSinkDraft((previous) => ({
      ...previous,
      rawTopic: guidedSinkMqttMessage.topic,
      rawPayload: guidedSinkMqttMessage.payload
    }));
  };

  return (
    <section className="panel pipeline-builder full-width">
      <header className="panel-header">
        <h3>{title}</h3>
        <div className="pipeline-builder-actions">
          <button className="button small" type="button" onClick={onSave} disabled={saveBusy || !hasEditableSection}>
            {saveBusy ? t('loading') : t('pipelineSave')}
          </button>
        </div>
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
          <p className="muted">
            {t('pipelineInputMode')}: {inputModeLabel(t, view.input.mode)}
          </p>
        </div>
        {canControlLogMode ? (
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
        <label className="stack pipeline-field">
          <span>{t('pipelineDeviceScope')}</span>
          <select
            className="input"
            value={view.input.deviceScope}
            onChange={(event) => onDeviceScopeChange?.(event.target.value)}
            disabled={!view.permissions.inputEditable}
          >
            <option value="SINGLE_DEVICE" disabled={!lecturerDeviceAvailable}>
              {t('pipelineDeviceScopeLecturer')}
            </option>
            <option value="GROUP_DEVICES">{t('pipelineDeviceScopeOwn')}</option>
            <option value="ALL_DEVICES">{t('pipelineDeviceScopeAll')}</option>
          </select>
        </label>
        <label className="stack pipeline-field">
          <span>{t('pipelineIngestFilters')}</span>
          <textarea
            className="input"
            value={listToMultiline(view.input.ingestFilters)}
            onChange={(event) => onIngestFiltersChange?.(event.target.value)}
            disabled={!view.permissions.inputEditable}
            rows={3}
          />
        </label>
        {!view.permissions.inputEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
      </article>

      <article className="panel panel-animate full-width pipeline-panel pipeline-processing-panel">
        <h4>{t('pipelineProcessing')}</h4>
        <div className="pipeline-builder-workbench">
          <section className="pipeline-flow-column">
            <section className="pipeline-flow-board" onDragLeave={() => setDragOverSlotIndex(null)}>
              <div className="pipeline-flow-edge-label mono">{`${t('pipelineInput')} ->`}</div>
              {processingSlots.map((slot) => {
                const isEmpty = slot.blockType === 'NONE';
                const isDropTarget = dragOverSlotIndex === slot.index;
                const showSlotDeviceScope = !isEmpty && blockSupportsDeviceScope(slot.blockType);
                const isFilterTopic = !isEmpty && slot.blockType.trim().toUpperCase() === 'FILTER_TOPIC';
                const isTransformPayload = !isEmpty && slot.blockType.trim().toUpperCase() === 'TRANSFORM_PAYLOAD';
                const configuredTopicFilter = isFilterTopic
                  ? extractTopicFilterFromSlotConfig(slot.config ?? {})
                  : '';
                const configuredTransformPayloadMappings = isTransformPayload
                  ? parseTransformPayloadMappings(slot.config ?? {})
                  : [];
                const slotDeviceScope = normalizeSlotDeviceScope(slot.config.deviceScope);
                const slotObservability = !isEmpty ? (observabilityBySlot.get(slot.index) ?? null) : null;
                const inspectorExpanded = expandedObservabilitySlot === slot.index;
                const selectedSample = slotObservability
                  ? selectBlockSample(selectedTraceBySlot, slotObservability)
                  : null;
                const parsedInput = selectedSample ? parseJson(selectedSample.inputPayloadJson) : null;
                const parsedOutput = selectedSample ? parseJson(selectedSample.outputPayloadJson) : null;
                const diff = selectedSample ? diffTopLevelKeys(parsedInput, parsedOutput) : null;
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
                      }`}
                      draggable={view.permissions.processingEditable && !isEmpty}
                      onDragStart={(event) => {
                        if (isEmpty) {
                          event.preventDefault();
                          return;
                        }
                        setDragPayload(event, slot.blockType, slot.index);
                      }}
                      onDragEnd={() => setDragOverSlotIndex(null)}
                      onDragOver={(event) => onSlotDragOver(event, slot.index)}
                      onDrop={(event) => onSlotDrop(event, slot.index)}
                    >
                      <div className="pipeline-flow-node-header">
                        <span className="pipeline-flow-node-title" />
                        {view.permissions.processingEditable && !isEmpty ? (
                          <button
                            type="button"
                            className="button tiny ghost"
                            onClick={() => setSlotBlockType(slot.index, 'NONE')}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                      <strong className="mono">
                        {isEmpty ? t('pipelineDropBlockHint') : slot.blockType}
                      </strong>
                      {showSlotDeviceScope ? (
                        <label className="stack pipeline-slot-config">
                          <span>{t('pipelineDeviceScope')}</span>
                          <select
                            className="input pipeline-slot-select"
                            value={slotDeviceScope}
                            onChange={(event) =>
                              onChangeSlotConfig?.(slot.index, 'deviceScope', event.target.value)}
                            disabled={!view.permissions.processingEditable}
                          >
                            <option value="LECTURER_DEVICE" disabled={!lecturerDeviceAvailable}>
                              {t('pipelineDeviceScopeLecturer')}
                            </option>
                            <option value="OWN_DEVICE">{t('pipelineDeviceScopeOwn')}</option>
                            <option value="ALL_DEVICES">{t('pipelineDeviceScopeAll')}</option>
                          </select>
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
                            disabled={!view.permissions.processingEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineFilterTopicConfigure')}
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
                            disabled={!view.permissions.processingEditable || !onChangeSlotConfig}
                          >
                            {t('pipelineTransformPayloadConfigure')}
                          </button>
                        </div>
                      ) : null}
                      {slotObservability ? (
                        <>
                          <div className="pipeline-slot-observability-summary">
                            <span className="chip">{t('pipelineMetricIn')}: {slotObservability.inCount}</span>
                            <span className="chip">{t('pipelineMetricOut')}: {slotObservability.outCount}</span>
                            <span className="chip warn">{t('pipelineMetricDrop')}: {slotObservability.dropCount}</span>
                            <span className="chip">{t('pipelineMetricErrors')}: {slotObservability.errorCount}</span>
                            <span className="chip">{t('pipelineMetricLatencyP95')}: {slotObservability.latencyP95Ms.toFixed(2)} ms</span>
                            <span className="chip">{t('pipelineMetricBacklog')}: {slotObservability.backlogDepth}</span>
                            <span className="chip">{t('pipelineStateType')}: {slotObservability.stateType}</span>
                          </div>
                          <button
                            type="button"
                            className="button tiny secondary"
                            onClick={() =>
                              setExpandedObservabilitySlot(inspectorExpanded ? null : slot.index)}
                          >
                            {inspectorExpanded ? t('hide') : `${t('pipelineInspect')} (${slotObservability.samples.length})`}
                          </button>
                          {inspectorExpanded ? (
                            <div className="pipeline-slot-sample-panel">
                              <div className="pipeline-sample-header">
                                <h5>{t('pipelineInspect')}</h5>
                                <div className="pipeline-sample-actions">
                                  <select
                                    className="input"
                                    value={selectedSample?.traceId ?? ''}
                                    onChange={(event) =>
                                      setSelectedTraceBySlot((previous) => ({
                                        ...previous,
                                        [slot.index]: event.target.value
                                      }))
                                    }
                                  >
                                    {slotObservability.samples.length === 0 ? (
                                      <option value="">{t('pipelineNoSamples')}</option>
                                    ) : null}
                                    {slotObservability.samples.map((sample) => (
                                      <option key={sample.traceId} value={sample.traceId}>
                                        {sample.traceId.slice(0, 8)} - {formatTs(sample.ingestTs)}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    className="button tiny secondary"
                                    onClick={() =>
                                      setSampleViewMode((previous) => (previous === 'rendered' ? 'raw' : 'rendered'))}
                                  >
                                    {sampleViewMode === 'rendered' ? t('switchToRawEvent') : t('switchToRenderedEvent')}
                                  </button>
                                </div>
                              </div>
                              {selectedSample ? (
                                <>
                                  <p className="muted">
                                    Trace: <span className="mono">{selectedSample.traceId}</span> | {t('eventFieldIngestTs')}:{' '}
                                    {formatTs(selectedSample.ingestTs)} | {t('device')}: {selectedSample.deviceId} |{' '}
                                    {t('feedHeaderTopic')}: <span className="mono">{selectedSample.topic}</span>
                                    {selectedSample.dropped
                                      ? ` | ${t('pipelineDropped')}: ${selectedSample.dropReason ?? '-'}`
                                      : ''}
                                  </p>
                                  {sampleViewMode === 'raw' ? (
                                    <div className="pipeline-sample-grid">
                                      <div>
                                        <h6>{t('pipelineInput')}</h6>
                                        <pre className="json-box">{selectedSample.inputPayloadJson}</pre>
                                      </div>
                                      <div>
                                        <h6>{t('pipelineOutput')}</h6>
                                        <pre className="json-box">{selectedSample.outputPayloadJson ?? ''}</pre>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="pipeline-sample-grid">
                                        <div>
                                          <h6>{t('pipelineInput')}</h6>
                                          <pre className="json-box">{prettyJson(parsedInput)}</pre>
                                        </div>
                                        <div>
                                          <h6>{t('pipelineOutput')}</h6>
                                          <pre className="json-box">{prettyJson(parsedOutput)}</pre>
                                        </div>
                                      </div>
                                      {diff ? (
                                        <div className="pipeline-diff-grid">
                                          <span className="chip ok">{t('pipelineDiffAdded')}: {diff.added.join(', ') || '-'}</span>
                                          <span className="chip warn">{t('pipelineDiffChanged')}: {diff.changed.join(', ') || '-'}</span>
                                          <span className="chip">{t('pipelineDiffRemoved')}: {diff.removed.join(', ') || '-'}</span>
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                </>
                              ) : (
                                <p className="muted">{t('pipelineNoSamples')}</p>
                              )}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </Fragment>
                );
              })}
              <div className="pipeline-flow-edge-label mono">{`-> ${t('pipelineOutput')}`}</div>
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
                    className="pipeline-library-chip"
                    disabled={!view.permissions.processingEditable}
                    draggable={view.permissions.processingEditable}
                    onDragStart={(event) => setDragPayload(event, blockType, null)}
                    onDragEnd={() => setDragOverSlotIndex(null)}
                    onClick={() => placeInFirstAvailableSlot(blockType)}
                  >
                    <span className="mono">{blockType}</span>
                  </button>
                ))}
              </div>
            </section>

            <p className="muted">
              {t('pipelineObservedEvents')}: {view.observability?.observedEvents ?? 0} | {t('pipelineSampling')} 1/
              {view.observability?.sampleEvery ?? 1} | {t('pipelineStateMode')}: {view.observability?.statePersistenceMode ?? '-'}
              {' | '}
              {t('pipelineRestartCount')}: {view.observability?.restartCount ?? 0}
              {view.observability?.lastRestartAt ? ` | ${formatTs(view.observability.lastRestartAt)}` : ''}
              {view.observability?.lastRestartMode ? ` (${view.observability.lastRestartMode})` : ''}
            </p>
            {view.permissions.stateResetAllowed || view.permissions.stateRestartAllowed ? (
              <div className="pipeline-state-controls">
                {view.permissions.stateResetAllowed ? (
                  <button
                    type="button"
                    className="button tiny secondary"
                    onClick={onResetState}
                    disabled={Boolean(stateControlBusy)}
                  >
                    {t('pipelineStateReset')}
                  </button>
                ) : null}
                {view.permissions.stateRestartAllowed ? (
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

      <article className="panel panel-animate full-width pipeline-panel pipeline-panel-sink">
        <h4>{t('pipelineSink')}</h4>
        <div className="pipeline-sink-board">
          {sinkNodes.map((sinkNode) => {
            const sinkType = normalizeSinkType(String(sinkNode.type));
            const runtimeNode = sinkRuntimeById.get(sinkNode.id);
            const receivedCount = runtimeNode?.receivedCount ?? 0;
            const lastReceivedAt = runtimeNode?.lastReceivedAt ?? null;
            const sendTopic = readSinkString(sinkNode.config ?? {}, 'topic');
            const sinkLabel = t(sinkDisplayNameKey(sinkType));
            return (
              <article className="pipeline-sink-node" key={sinkNode.id}>
                <header className="pipeline-sink-node-header">
                  <strong>{sinkLabel}</strong>
                  {view.permissions.sinkEditable && sinkType !== 'EVENT_FEED' && sinkType !== 'VIRTUAL_SIGNAL' ? (
                    <button
                      className="button tiny ghost"
                      type="button"
                      onClick={() => onRemoveSink?.(sinkNode.id)}
                    >
                      {t('pipelineSinkRemove')}
                    </button>
                  ) : null}
                </header>

                {sinkType === 'EVENT_FEED' ? (
                  <p className="muted">{t('pipelineSinkEventFeedHint')}</p>
                ) : null}

                {sinkType === 'SEND_EVENT' ? (
                  <div className="pipeline-sink-details">
                    <p className="muted mono">
                      {sendTopic.length > 0 ? sendTopic : t('pipelineSinkNoTopic')}
                    </p>
                    <div className="pipeline-sink-actions">
                      <button
                        className="button tiny secondary"
                        type="button"
                        onClick={() => openSendEventSinkEditor(sinkNode)}
                        disabled={!view.permissions.sinkEditable}
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
                      {lastReceivedAt ? ` | ${formatTs(lastReceivedAt)}` : ''}
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
              </article>
            );
          })}
        </div>
        {view.permissions.sinkEditable ? (
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
        {!view.permissions.sinkEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
      </article>

      {topicFilterModalSlotIndex !== null ? (
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
      ) : null}

      {transformPayloadModalSlotIndex !== null ? (
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
                      placeholder="pressed"
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
                      placeholder="on"
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
      ) : null}

      <AdminMqttEventModal
        t={t}
        open={sinkEditorSinkId !== null}
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
        titleKey="pipelineSinkSendEventConfigTitle"
        submitLabelKey="save"
        hidePayloadFields
      />
    </section>
  );
}
