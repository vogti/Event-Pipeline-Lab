import type { I18nKey } from '../../i18n';
import type { TaskInfo, TaskPipelineConfig, TimestampValue } from '../../types';

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
  onSave: () => void;
  formatTs: (value: TimestampValue) => string;
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
  onSave,
  formatTs
}: PipelineTaskConfigSectionProps) {
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
