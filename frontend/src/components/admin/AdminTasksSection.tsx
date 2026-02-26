import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { I18nKey } from '../../i18n';
import type { TaskInfo, TaskPipelineConfig } from '../../types';
import { CloseIcon } from '../../app/shared-icons';
import { PipelineScenarioEditor } from '../pipeline/PipelineScenarioEditor';

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
  onScenarioOverlaysChange: (scenarioOverlays: string[]) => void;
  onSaveTaskConfig: () => void;
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
  onScenarioOverlaysChange,
  onSaveTaskConfig
}: AdminTasksSectionProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) ?? null,
    [tasks, editingTaskId]
  );
  const editingTaskConfig = editingTask && taskConfig?.taskId === editingTask.id
    ? taskConfig
    : null;

  useEffect(() => {
    if (!editingTaskId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditingTaskId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [editingTaskId]);

  const openTaskSettings = (taskId: string) => {
    setEditingTaskId(taskId);
    if (taskId !== selectedTaskId) {
      onSelectTask(taskId);
    }
  };

  const taskSettingsModal = editingTask ? (
    <div className="event-modal-backdrop" onClick={() => setEditingTaskId(null)}>
      <div className="event-modal task-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{taskLabel(editingTask)}</h2>
          <button
            className="modal-close-button"
            type="button"
            onClick={() => setEditingTaskId(null)}
            aria-label={t('close')}
            title={t('close')}
          >
            <CloseIcon />
          </button>
        </div>

        <p className="muted">{taskDescriptionLabel(editingTask)}</p>

        {editingTaskConfig ? (
          <div className="pipeline-task-inline-editor">
            <label className="checkbox-inline pipeline-field">
              <input
                type="checkbox"
                checked={editingTaskConfig.visibleToStudents}
                onChange={(event) => onToggleVisibleToStudents(event.target.checked)}
              />
              <span>{t('pipelineVisibleToStudents')}</span>
            </label>

            <label className="stack pipeline-field">
              <span>{t('pipelineSlotCount')}</span>
              <input
                className="input"
                type="number"
                min={editingTaskConfig.minSlotCount}
                max={editingTaskConfig.maxSlotCount}
                value={editingTaskConfig.slotCount}
                onChange={(event) => {
                  const next = Number.isFinite(event.target.valueAsNumber)
                    ? event.target.valueAsNumber
                    : editingTaskConfig.slotCount;
                  onSlotCountChange(next);
                }}
              />
            </label>

            <div className="stack pipeline-field">
              <span>{t('pipelineAllowedBlocks')}</span>
              <div className="pipeline-block-checks">
                {editingTaskConfig.availableProcessingBlocks.map((block) => (
                  <label key={block} className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={editingTaskConfig.allowedProcessingBlocks.includes(block)}
                      onChange={(event) => onToggleAllowedBlock(block, event.target.checked)}
                    />
                    <span className="mono">{block}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="stack pipeline-field">
              <span>{t('scenarioTaskTitle')}</span>
              <p className="muted">{t('scenarioPresetHint')}</p>
              <PipelineScenarioEditor
                t={t}
                overlays={editingTaskConfig.scenarioOverlays}
                disabled={taskConfigBusy}
                onChange={onScenarioOverlaysChange}
              />
            </div>

            <button
              className="button small"
              type="button"
              onClick={onSaveTaskConfig}
              disabled={taskConfigBusy}
            >
              {taskConfigBusy ? t('loading') : t('save')}
            </button>
          </div>
        ) : (
          <p className="muted">{t('loading')}</p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <section className="panel hero panel-animate full-width">
        <header className="panel-header">
          <h2>{t('tasks')}</h2>
        </header>

        <div className="tasks-list">
          {tasks.map((task) => {
            const isEditing = task.id === editingTaskId;
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
                    className={`button secondary ${isEditing ? 'active' : ''}`}
                    type="button"
                    onClick={() => openTaskSettings(task.id)}
                  >
                    {t('edit')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {typeof document !== 'undefined' && taskSettingsModal
        ? createPortal(taskSettingsModal, document.body)
        : null}
    </>
  );
}
