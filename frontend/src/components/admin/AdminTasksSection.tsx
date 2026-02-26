import type { I18nKey } from '../../i18n';
import type { TaskInfo, TaskPipelineConfig, TimestampValue } from '../../types';

interface AdminTasksSectionProps {
  t: (key: I18nKey) => string;
  tasks: TaskInfo[];
  selectedTaskId: string;
  taskLabel: (task: TaskInfo) => string;
  taskDescriptionLabel: (task: TaskInfo) => string;
  taskConfig: TaskPipelineConfig | null;
  taskConfigBusy: boolean;
  onActivateTask: (taskId: string) => void;
  isTaskActivationBusy: (taskId: string) => boolean;
  onSelectTask: (taskId: string) => void;
  onToggleVisibleToStudents: (visible: boolean) => void;
  onSlotCountChange: (slotCount: number) => void;
  onToggleAllowedBlock: (blockType: string, enabled: boolean) => void;
  onSaveTaskConfig: () => void;
  formatTs: (value: TimestampValue) => string;
}

export function AdminTasksSection({
  t,
  tasks,
  selectedTaskId,
  taskLabel,
  taskDescriptionLabel,
  taskConfig,
  taskConfigBusy,
  onActivateTask,
  isTaskActivationBusy,
  onSelectTask,
  onToggleVisibleToStudents,
  onSlotCountChange,
  onToggleAllowedBlock,
  onSaveTaskConfig,
  formatTs
}: AdminTasksSectionProps) {
  return (
    <section className="panel hero panel-animate full-width">
      <header className="panel-header">
        <h2>{t('tasks')}</h2>
      </header>

      <div className="tasks-list">
        {tasks.map((task) => {
          const isSelected = task.id === selectedTaskId;
          const hasConfig = isSelected && taskConfig && taskConfig.taskId === task.id;
          return (
            <article key={task.id} className={`task-card ${task.active ? 'active' : ''}`}>
              <header>
                <strong>{taskLabel(task)}</strong>
                {task.active ? <span className="chip">{t('statusActive')}</span> : null}
              </header>
              <p>{taskDescriptionLabel(task)}</p>

              <div className="admin-card-actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => onActivateTask(task.id)}
                  disabled={isTaskActivationBusy(task.id) || task.active}
                >
                  {t('activate')}
                </button>
                <button
                  className={`button secondary ${isSelected ? 'active' : ''}`}
                  type="button"
                  onClick={() => onSelectTask(task.id)}
                >
                  {t('edit')}
                </button>
              </div>

              {hasConfig ? (
                <div className="pipeline-task-inline-editor">
                  <label className="checkbox-inline pipeline-field">
                    <input
                      type="checkbox"
                      checked={taskConfig.visibleToStudents}
                      onChange={(event) => onToggleVisibleToStudents(event.target.checked)}
                    />
                    <span>{t('pipelineVisibleToStudents')}</span>
                  </label>

                  <label className="stack pipeline-field">
                    <span>{t('pipelineSlotCount')}</span>
                    <input
                      className="input"
                      type="number"
                      min={taskConfig.minSlotCount}
                      max={taskConfig.maxSlotCount}
                      value={taskConfig.slotCount}
                      onChange={(event) => {
                        const next = Number.isFinite(event.target.valueAsNumber)
                          ? event.target.valueAsNumber
                          : taskConfig.slotCount;
                        onSlotCountChange(next);
                      }}
                    />
                  </label>

                  <div className="stack pipeline-field">
                    <span>{t('pipelineAllowedBlocks')}</span>
                    <div className="pipeline-block-checks">
                      {taskConfig.availableProcessingBlocks.map((block) => (
                        <label key={block} className="checkbox-inline">
                          <input
                            type="checkbox"
                            checked={taskConfig.allowedProcessingBlocks.includes(block)}
                            onChange={(event) => onToggleAllowedBlock(block, event.target.checked)}
                          />
                          <span className="mono">{block}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="task-config-meta-row">
                    <button
                      className="button small"
                      type="button"
                      onClick={onSaveTaskConfig}
                      disabled={taskConfigBusy}
                    >
                      {taskConfigBusy ? t('loading') : t('save')}
                    </button>
                    <span className="muted">
                      {t('updatedBy')}: {taskConfig.updatedBy ?? '-'} | {t('updatedAt')}:{' '}
                      {formatTs(taskConfig.updatedAt)}
                    </span>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
