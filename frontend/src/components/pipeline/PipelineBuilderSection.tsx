import type { I18nKey } from '../../i18n';
import type { PipelineProcessingSection, PipelineView } from '../../types';

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
  onScenarioOverlaysChange?: (nextValue: string) => void;
  onSinkTargetsChange?: (nextValue: string) => void;
  onSinkGoalChange?: (nextValue: string) => void;
  onSave: () => void;
  saveBusy: boolean;
}

function listToMultiline(value: string[]): string {
  return value.join('\n');
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
  saveBusy
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
            <textarea
              className="input"
              value={listToMultiline(view.input.scenarioOverlays)}
              onChange={(event) => onScenarioOverlaysChange?.(event.target.value)}
              disabled={!view.permissions.inputEditable}
              rows={3}
            />
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
    </section>
  );
}
