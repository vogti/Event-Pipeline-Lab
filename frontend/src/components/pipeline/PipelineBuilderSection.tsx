import { Fragment, useState, type DragEvent } from 'react';
import type { I18nKey } from '../../i18n';
import type {
  PipelineLogModeStatus,
  PipelineLogReplayResponse,
  PipelineProcessingSection,
  PipelineView,
  TimestampValue
} from '../../types';
import { PipelineObservabilitySection } from './PipelineObservabilitySection';

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
  onSinkTargetsChange?: (nextValue: string) => void;
  onSinkGoalChange?: (nextValue: string) => void;
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
  const maxSlotCount = Math.max(1, processing.slotCount);
  const byIndex = new Map<number, PipelineProcessingSection['slots'][number]>();
  for (const slot of processing.slots) {
    if (slot.index < 0 || slot.index >= maxSlotCount) {
      continue;
    }
    byIndex.set(slot.index, slot);
  }

  let lastConfiguredIndex = -1;
  for (const slot of byIndex.values()) {
    if ((slot.blockType ?? 'NONE') !== 'NONE' && slot.index > lastConfiguredIndex) {
      lastConfiguredIndex = slot.index;
    }
  }

  const visibleSlotCount = Math.min(maxSlotCount, Math.max(1, lastConfiguredIndex + 2));
  return Array.from({ length: visibleSlotCount }, (_, slotIndex) => {
    const slot = byIndex.get(slotIndex);
    return {
      index: slotIndex,
      blockType: slot?.blockType ?? 'NONE',
      config: slot?.config ?? {}
    };
  });
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
  onSinkTargetsChange,
  onSinkGoalChange,
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

  return (
    <section className="pipeline-builder full-width">
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

      <div className="pipeline-sections">
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

            <section className="pipeline-flow-board" onDragLeave={() => setDragOverSlotIndex(null)}>
              {processingSlots.map((slot) => {
                const isEmpty = slot.blockType === 'NONE';
                const isDropTarget = dragOverSlotIndex === slot.index;
                const showSlotDeviceScope = !isEmpty && blockSupportsDeviceScope(slot.blockType);
                const slotDeviceScope = normalizeSlotDeviceScope(slot.config.deviceScope);
                return (
                  <Fragment key={slot.index}>
                    {slot.index > 0 ? (
                      <div className="pipeline-flow-connector" aria-hidden="true">
                        <span className="pipeline-flow-arrow">→</span>
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
                      {view.permissions.processingEditable && !isEmpty ? (
                        <div className="pipeline-flow-node-header">
                          <span />
                          <button
                            type="button"
                            className="button tiny ghost"
                            onClick={() => setSlotBlockType(slot.index, 'NONE')}
                          >
                            ×
                          </button>
                        </div>
                      ) : null}
                      <strong className="mono">{slot.blockType}</strong>
                      <select
                        className="input pipeline-slot-select"
                        value={slot.blockType}
                        onChange={(event) => setSlotBlockType(slot.index, event.target.value)}
                        disabled={!view.permissions.processingEditable}
                      >
                        {blockOptions.map((blockType) => (
                          <option key={blockType} value={blockType}>
                            {blockType}
                          </option>
                        ))}
                      </select>
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
                    </div>
                  </Fragment>
                );
              })}
            </section>
          </div>
          {!view.permissions.processingEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
          <PipelineObservabilitySection
            t={t}
            observability={view.observability}
            formatTs={formatTs}
            canResetState={view.permissions.stateResetAllowed}
            canRestartState={view.permissions.stateRestartAllowed}
            controlsBusy={Boolean(stateControlBusy)}
            onResetState={onResetState}
            onRestartStateLost={onRestartStateLost}
            onRestartStateRetained={onRestartStateRetained}
          />
        </article>

        <article className="panel panel-animate full-width pipeline-panel pipeline-panel-sink">
          <h4>{t('pipelineSink')}</h4>
          <label className="stack pipeline-field">
            <span>{t('pipelineSinkTargets')}</span>
            <textarea
              className="input"
              value={listToMultiline(view.sink.targets)}
              onChange={(event) => onSinkTargetsChange?.(event.target.value)}
              disabled={!view.permissions.sinkEditable}
              rows={3}
            />
          </label>
          <label className="stack pipeline-field">
            <span>{t('pipelineSinkGoal')}</span>
            <textarea
              className="input"
              value={view.sink.goal}
              onChange={(event) => onSinkGoalChange?.(event.target.value)}
              disabled={!view.permissions.sinkEditable}
              rows={5}
            />
          </label>
          {!view.permissions.sinkEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
        </article>
      </div>
    </section>
  );
}
