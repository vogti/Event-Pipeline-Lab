import type { I18nKey } from '../../i18n';
import type { PipelineView, TaskInfo, TaskPipelineConfig } from '../../types';
import {
  buildPipelineScenarioOverlays,
  parsePipelineScenarioOverlays,
  PIPELINE_SCENARIO_DEFINITIONS,
  type PipelineScenarioKey,
  scenarioDefaultValue,
  withScenarioValue
} from '../../app/pipeline-scenarios';

interface PipelineScenariosSectionProps {
  t: (key: I18nKey) => string;
  tasks: TaskInfo[];
  selectedTaskId: string;
  taskLabel: (task: TaskInfo) => string;
  taskConfig: TaskPipelineConfig | null;
  taskBusy: boolean;
  onSelectTask: (taskId: string) => void;
  onTaskScenarioOverlaysChange: (scenarioOverlays: string[]) => void;
  onSaveTaskScenarios: () => void;
  pipelineView: PipelineView | null;
  groupOptions: string[];
  selectedGroupKey: string;
  onSelectGroup: (groupKey: string) => void;
  pipelineBusy: boolean;
  onPipelineScenarioOverlaysChange: (scenarioOverlays: string[]) => void;
  onSavePipelineScenarios: () => void;
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

function scenarioDescriptionKey(key: PipelineScenarioKey): I18nKey {
  switch (key) {
    case 'duplicates':
      return 'pipelineScenarioDuplicatesDesc';
    case 'delay':
      return 'pipelineScenarioDelayDesc';
    case 'drops':
      return 'pipelineScenarioDropsDesc';
    case 'out_of_order':
      return 'pipelineScenarioOutOfOrderDesc';
    default:
      return 'pipelineScenarioDuplicatesDesc';
  }
}

interface ScenarioEditorProps {
  t: (key: I18nKey) => string;
  overlays: string[];
  disabled: boolean;
  onChange: (nextOverlays: string[]) => void;
}

function ScenarioEditor({ t, overlays, disabled, onChange }: ScenarioEditorProps) {
  const scenarioValues = parsePipelineScenarioOverlays(overlays);

  return (
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
                disabled={disabled}
                onChange={(event) => {
                  const nextValues = withScenarioValue(
                    scenarioValues,
                    definition.key,
                    event.target.checked ? value : null
                  );
                  onChange(buildPipelineScenarioOverlays(nextValues));
                }}
              />
              <span>{t(scenarioLabelKey(definition.key))}</span>
            </label>
            <p className="muted pipeline-scenario-description">{t(scenarioDescriptionKey(definition.key))}</p>
            <div className="pipeline-scenario-controls">
              <input
                className="input"
                type="range"
                min={definition.min}
                max={definition.max}
                step={definition.step}
                value={value}
                disabled={disabled || !enabled}
                onChange={(event) => {
                  const nextRaw = Number.parseInt(event.target.value, 10);
                  const nextValue = Number.isFinite(nextRaw) ? nextRaw : value;
                  const nextValues = withScenarioValue(
                    scenarioValues,
                    definition.key,
                    enabled ? nextValue : null
                  );
                  onChange(buildPipelineScenarioOverlays(nextValues));
                }}
              />
              <input
                className="input pipeline-scenario-number"
                type="number"
                min={definition.min}
                max={definition.max}
                step={definition.step}
                value={value}
                disabled={disabled || !enabled}
                onChange={(event) => {
                  const nextRaw = Number.parseInt(event.target.value, 10);
                  const nextValue = Number.isFinite(nextRaw) ? nextRaw : value;
                  const nextValues = withScenarioValue(
                    scenarioValues,
                    definition.key,
                    enabled ? nextValue : null
                  );
                  onChange(buildPipelineScenarioOverlays(nextValues));
                }}
              />
              <span className="muted">{definition.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PipelineScenariosSection({
  t,
  tasks,
  selectedTaskId,
  taskLabel,
  taskConfig,
  taskBusy,
  onSelectTask,
  onTaskScenarioOverlaysChange,
  onSaveTaskScenarios,
  pipelineView,
  groupOptions,
  selectedGroupKey,
  onSelectGroup,
  pipelineBusy,
  onPipelineScenarioOverlaysChange,
  onSavePipelineScenarios
}: PipelineScenariosSectionProps) {
  const taskScenarioOverlays = taskConfig?.scenarioOverlays ?? [];
  const pipelineScenarioOverlays = pipelineView?.input.scenarioOverlays ?? [];
  const pipelineEditable = Boolean(pipelineView?.permissions.inputEditable);

  return (
    <>
      <section className="panel panel-animate">
        <header className="panel-header">
          <h3>{t('scenarioTaskTitle')}</h3>
          <button
            className="button small"
            type="button"
            onClick={onSaveTaskScenarios}
            disabled={taskBusy || !taskConfig}
          >
            {taskBusy ? t('loading') : t('save')}
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

        <ScenarioEditor
          t={t}
          overlays={taskScenarioOverlays}
          disabled={!taskConfig || taskBusy}
          onChange={onTaskScenarioOverlaysChange}
        />
      </section>

      <section className="panel panel-animate">
        <header className="panel-header">
          <h3>{t('scenarioPipelineTitle')}</h3>
          <button
            className="button small"
            type="button"
            onClick={onSavePipelineScenarios}
            disabled={pipelineBusy || !pipelineView || !pipelineEditable}
          >
            {pipelineBusy ? t('loading') : t('pipelineSave')}
          </button>
        </header>

        <label className="stack pipeline-field">
          <span>{t('pipelineGroup')}</span>
          <select
            className="input"
            value={selectedGroupKey}
            onChange={(event) => onSelectGroup(event.target.value)}
          >
            {groupOptions.length === 0 ? <option value="">{t('pipelineNoGroups')}</option> : null}
            {groupOptions.map((groupKey) => (
              <option key={groupKey} value={groupKey}>
                {groupKey}
              </option>
            ))}
          </select>
        </label>

        {pipelineView ? (
          <>
            <ScenarioEditor
              t={t}
              overlays={pipelineScenarioOverlays}
              disabled={pipelineBusy || !pipelineEditable}
              onChange={onPipelineScenarioOverlaysChange}
            />
            {!pipelineEditable ? <p className="muted">{t('pipelineReadOnlyTask')}</p> : null}
          </>
        ) : (
          <p className="muted">{t('loading')}</p>
        )}
      </section>
    </>
  );
}
