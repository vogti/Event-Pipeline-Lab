import type { I18nKey } from '../../i18n';
import type { TaskInfo, TaskPipelineConfig, TimestampValue } from '../../types';
import {
  buildPipelineScenarioOverlays,
  parsePipelineScenarioOverlays,
  PIPELINE_SCENARIO_DEFINITIONS,
  scenarioDefaultValue,
  type PipelineScenarioKey,
  withScenarioValue
} from '../../app/pipeline-scenarios';

interface PipelineTaskConfigSectionProps {
  t: (key: I18nKey) => string;
  tasks: TaskInfo[];
  selectedTaskId: string;
  taskLabel: (task: TaskInfo) => string;
  config: TaskPipelineConfig | null;
  busy: boolean;
  onSelectTask: (taskId: string) => void;
  onToggleVisibleToStudents: (visible: boolean) => void;
  onSlotCountChange: (slotCount: number) => void;
  onToggleAllowedBlock: (blockType: string, enabled: boolean) => void;
  onScenarioOverlaysChange: (scenarioOverlays: string[]) => void;
  onSave: () => void;
  formatTs: (value: TimestampValue) => string;
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

export function PipelineTaskConfigSection({
  t,
  tasks,
  selectedTaskId,
  taskLabel,
  config,
  busy,
  onSelectTask,
  onToggleVisibleToStudents,
  onSlotCountChange,
  onToggleAllowedBlock,
  onScenarioOverlaysChange,
  onSave,
  formatTs
}: PipelineTaskConfigSectionProps) {
  const scenarioValues = parsePipelineScenarioOverlays(config?.scenarioOverlays ?? []);

  return (
    <section className="panel panel-animate pipeline-task-config">
      <header className="panel-header">
        <h3>{t('pipelineTaskConfig')}</h3>
        <button className="button small" type="button" onClick={onSave} disabled={busy || !config}>
          {busy ? t('loading') : t('save')}
        </button>
      </header>

      <label className="stack pipeline-field">
        <span>{t('tasks')}</span>
        <select
          className="input"
          value={selectedTaskId}
          onChange={(event) => onSelectTask(event.target.value)}
        >
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {taskLabel(task)}
            </option>
          ))}
        </select>
      </label>

      {config ? (
        <>
          <label className="checkbox-inline pipeline-field">
            <input
              type="checkbox"
              checked={config.visibleToStudents}
              onChange={(event) => onToggleVisibleToStudents(event.target.checked)}
            />
            <span>{t('pipelineVisibleToStudents')}</span>
          </label>

          <label className="stack pipeline-field">
            <span>{t('pipelineSlotCount')}</span>
            <input
              className="input"
              type="number"
              min={config.minSlotCount}
              max={config.maxSlotCount}
              value={config.slotCount}
              onChange={(event) => {
                const next = Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : config.slotCount;
                onSlotCountChange(next);
              }}
            />
          </label>

          <div className="stack pipeline-field">
            <span>{t('pipelineAllowedBlocks')}</span>
            <div className="pipeline-block-checks">
              {config.availableProcessingBlocks.map((block) => (
                <label key={block} className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={config.allowedProcessingBlocks.includes(block)}
                    onChange={(event) => onToggleAllowedBlock(block, event.target.checked)}
                  />
                  <span className="mono">{block}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="stack pipeline-field">
            <span>{t('pipelineScenarioOverlays')}</span>
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
          </div>

          <p className="muted">
            {t('updatedBy')}: {config.updatedBy ?? '-'} | {t('updatedAt')}: {formatTs(config.updatedAt)}
          </p>
        </>
      ) : (
        <p className="muted">{t('loading')}</p>
      )}
    </section>
  );
}
