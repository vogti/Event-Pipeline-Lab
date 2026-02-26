import type { I18nKey } from '../../i18n';
import type { PipelineProcessingSection, PipelineView, TimestampValue } from '../../types';
import {
  buildPipelineScenarioOverlays,
  parsePipelineScenarioOverlays,
  PIPELINE_SCENARIO_DEFINITIONS,
  scenarioDefaultValue,
  type PipelineScenarioKey,
  withScenarioValue
} from '../../app/pipeline-scenarios';
import { PipelineObservabilitySection } from './PipelineObservabilitySection';

interface PipelineBuilderSectionProps {
  t: (key: I18nKey) => string;
  title: string;
  view: PipelineView | null;
  groupOptions?: string[];
  selectedGroupKey?: string;
  onSelectGroup?: (groupKey: string) => void;
  draftProcessing: PipelineProcessingSection | null;
  onChangeSlotBlock: (slotIndex: number, blockType: string) => void;
  onInputModeChange?: (nextMode: string) => void;
  onDeviceScopeChange?: (nextScope: string) => void;
  onIngestFiltersChange?: (nextValue: string) => void;
  onScenarioOverlaysChange?: (nextValue: string[]) => void;
  onSinkTargetsChange?: (nextValue: string) => void;
  onSinkGoalChange?: (nextValue: string) => void;
  onSave: () => void;
  saveBusy: boolean;
  formatTs: (value: TimestampValue) => string;
}

function listToMultiline(value: string[]): string {
  return value.join('\n');
}

function scenarioLabelKey(key: PipelineScenarioKey): I18nKey {
  switch (key) {
    case 'duplicates':
      return 'pipelineScenarioDuplicates';
    case 'delay':
      return 'pipelineScenarioDelay';
    case 'drops':
      return 'pipelineScenarioDrops';
    case 'out_of_order':
      return 'pipelineScenarioOutOfOrder';
    default:
      return 'pipelineScenarioDuplicates';
  }
}

function scenarioBadgeLabel(t: (key: I18nKey) => string, key: PipelineScenarioKey, value: number): string {
  const base = t(scenarioLabelKey(key));
  if (key === 'delay') {
    return `${base} ${value}ms`;
  }
  return `${base} ${value}%`;
}

export function PipelineBuilderSection({
  t,
  title,
  view,
  groupOptions,
  selectedGroupKey,
  onSelectGroup,
  draftProcessing,
  onChangeSlotBlock,
  onInputModeChange,
  onDeviceScopeChange,
  onIngestFiltersChange,
  onScenarioOverlaysChange,
  onSinkTargetsChange,
  onSinkGoalChange,
  onSave,
  saveBusy,
  formatTs
}: PipelineBuilderSectionProps) {
  if (!view) {
    return (
      <section className="panel panel-animate">
        <header className="panel-header">
          <h3>{title}</h3>
        </header>
        <p className="muted">{t('loading')}</p>
      </section>
    );
  }

  if (!view.permissions.visible) {
    return (
      <section className="panel panel-animate">
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
  const scenarioValues = parsePipelineScenarioOverlays(view.input.scenarioOverlays);
  const activeScenarioBadges = PIPELINE_SCENARIO_DEFINITIONS.flatMap((definition) => {
    const value = scenarioValues[definition.key];
    if (!value) {
      return [];
    }
    return [scenarioBadgeLabel(t, definition.key, value)];
  });

  return (
    <section className="panel panel-animate pipeline-builder">
      <header className="panel-header">
        <h3>{title}</h3>
        <div className="pipeline-builder-actions">
          {groupOptions && onSelectGroup ? (
            <select
              className="input"
              value={selectedGroupKey ?? ''}
              onChange={(event) => onSelectGroup(event.target.value)}
            >
              {groupOptions.length === 0 ? (
                <option value="">{t('pipelineNoGroups')}</option>
              ) : null}
              {groupOptions.map((groupKey) => (
                <option key={groupKey} value={groupKey}>
                  {groupKey}
                </option>
              ))}
            </select>
          ) : null}
          <button className="button small" type="button" onClick={onSave} disabled={saveBusy || !hasEditableSection}>
            {saveBusy ? t('loading') : t('pipelineSave')}
          </button>
        </div>
      </header>

      <div className="pipeline-grid">
        <article className="pipeline-column">
          <h4>{t('pipelineInput')}</h4>
          <label className="stack pipeline-field">
            <span>{t('pipelineInputMode')}</span>
            <select
              className="input"
              value={view.input.mode}
              onChange={(event) => onInputModeChange?.(event.target.value)}
              disabled={!view.permissions.inputEditable}
            >
              <option value="LIVE_MQTT">LIVE_MQTT</option>
              <option value="LOG_MODE">LOG_MODE</option>
            </select>
          </label>
          <label className="stack pipeline-field">
            <span>{t('pipelineDeviceScope')}</span>
            <select
              className="input"
              value={view.input.deviceScope}
              onChange={(event) => onDeviceScopeChange?.(event.target.value)}
              disabled={!view.permissions.inputEditable}
            >
              <option value="SINGLE_DEVICE">SINGLE_DEVICE</option>
              <option value="GROUP_DEVICES">GROUP_DEVICES</option>
              <option value="ALL_DEVICES">ALL_DEVICES</option>
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
          <label className="stack pipeline-field">
            <span>{t('pipelineScenarioOverlays')}</span>
            {view.permissions.inputEditable ? (
              <div className="pipeline-scenario-editor">
                {PIPELINE_SCENARIO_DEFINITIONS.map((definition) => {
                  const activeValue = scenarioValues[definition.key];
                  const enabled = typeof activeValue === 'number' && activeValue > 0;
                  const value = activeValue ?? scenarioDefaultValue(definition.key);
                  return (
                    <div className="pipeline-scenario-row" key={definition.key}>
                      <label className="checkbox-inline">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => {
                            if (!onScenarioOverlaysChange) {
                              return;
                            }
                            const nextValues = withScenarioValue(
                              scenarioValues,
                              definition.key,
                              event.target.checked ? value : null
                            );
                            onScenarioOverlaysChange(buildPipelineScenarioOverlays(nextValues));
                          }}
                        />
                        <span>{t(scenarioLabelKey(definition.key))}</span>
                      </label>
                      <div className="pipeline-scenario-controls">
                        <input
                          className="input"
                          type="range"
                          min={definition.min}
                          max={definition.max}
                          step={definition.step}
                          value={value}
                          onChange={(event) => {
                            if (!onScenarioOverlaysChange) {
                              return;
                            }
                            const nextRaw = Number.parseInt(event.target.value, 10);
                            const nextValue = Number.isFinite(nextRaw) ? nextRaw : value;
                            const nextValues = withScenarioValue(
                              scenarioValues,
                              definition.key,
                              enabled ? nextValue : null
                            );
                            onScenarioOverlaysChange(buildPipelineScenarioOverlays(nextValues));
                          }}
                          disabled={!enabled}
                        />
                        <input
                          className="input pipeline-scenario-number"
                          type="number"
                          min={definition.min}
                          max={definition.max}
                          step={definition.step}
                          value={value}
                          onChange={(event) => {
                            if (!onScenarioOverlaysChange) {
                              return;
                            }
                            const nextRaw = Number.parseInt(event.target.value, 10);
                            const nextValue = Number.isFinite(nextRaw) ? nextRaw : value;
                            const nextValues = withScenarioValue(
                              scenarioValues,
                              definition.key,
                              enabled ? nextValue : null
                            );
                            onScenarioOverlaysChange(buildPipelineScenarioOverlays(nextValues));
                          }}
                          disabled={!enabled}
                        />
                        <span className="muted">{definition.unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : activeScenarioBadges.length > 0 ? (
              <div className="chip-row">
                {activeScenarioBadges.map((label) => (
                  <span className="chip warn" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="muted">{t('pipelineScenarioNone')}</p>
            )}
          </label>
          {!view.permissions.inputEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
        </article>

        <article className="pipeline-column">
          <h4>{t('pipelineProcessing')}</h4>
          <div className="pipeline-slot-list">
            {Array.from({ length: processing.slotCount }).map((_, slotIndex) => {
              const slot =
                processing.slots.find((entry) => entry.index === slotIndex) ?? {
                  index: slotIndex,
                  blockType: 'NONE',
                  config: {}
                };
              return (
                <label className="stack pipeline-field" key={slotIndex}>
                  <span>
                    {t('pipelineSlot')} {slotIndex + 1}
                  </span>
                  <select
                    className="input"
                    value={slot.blockType}
                    onChange={(event) => onChangeSlotBlock(slotIndex, event.target.value)}
                    disabled={!view.permissions.processingEditable}
                  >
                    {blockOptions.map((blockType) => (
                      <option key={blockType} value={blockType}>
                        {blockType}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </article>

        <article className="pipeline-column">
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

      <PipelineObservabilitySection
        t={t}
        observability={view.observability}
        formatTs={formatTs}
      />
    </section>
  );
}
