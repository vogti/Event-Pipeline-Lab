import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { I18nKey } from '../../i18n';
import type { TaskInfo, TaskPipelineConfig } from '../../types';
import { CloseIcon } from '../../app/shared-icons';
import { PipelineScenarioEditor } from '../pipeline/PipelineScenarioEditor';

interface TaskDetailsDraft {
  titleDe: string;
  titleEn: string;
  descriptionDe: string;
  descriptionEn: string;
}

interface CreateTaskDraft extends TaskDetailsDraft {
  taskId: string;
  templateTaskId: string;
}

interface AdminTasksSectionProps {
  t: (key: I18nKey) => string;
  tasks: TaskInfo[];
  selectedTaskId: string;
  taskLabel: (task: TaskInfo) => string;
  taskDescriptionLabel: (task: TaskInfo) => string;
  taskConfig: TaskPipelineConfig | null;
  taskConfigBusy: boolean;
  taskMutationBusy: boolean;
  onActivateTask: (taskId: string) => void;
  isTaskActivationBusy: (taskId: string) => boolean;
  onSelectTask: (taskId: string) => void;
  onToggleVisibleToStudents: (visible: boolean) => void;
  onSlotCountChange: (slotCount: number) => void;
  onToggleAllowedBlock: (blockType: string, enabled: boolean) => void;
  onScenarioOverlaysChange: (scenarioOverlays: string[]) => void;
  onSaveTaskConfig: () => void;
  onSaveTaskDetails: (taskId: string, details: TaskDetailsDraft) => void;
  onCreateTask: (draft: CreateTaskDraft) => void;
}

function emptyTaskDetailsDraft(): TaskDetailsDraft {
  return {
    titleDe: '',
    titleEn: '',
    descriptionDe: '',
    descriptionEn: ''
  };
}

function emptyCreateTaskDraft(templateTaskId: string): CreateTaskDraft {
  return {
    taskId: '',
    titleDe: '',
    titleEn: '',
    descriptionDe: '',
    descriptionEn: '',
    templateTaskId
  };
}

export function AdminTasksSection({
  t,
  tasks,
  selectedTaskId,
  taskLabel,
  taskDescriptionLabel,
  taskConfig,
  taskConfigBusy,
  taskMutationBusy,
  onActivateTask,
  isTaskActivationBusy,
  onSelectTask,
  onToggleVisibleToStudents,
  onSlotCountChange,
  onToggleAllowedBlock,
  onScenarioOverlaysChange,
  onSaveTaskConfig,
  onSaveTaskDetails,
  onCreateTask
}: AdminTasksSectionProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<TaskDetailsDraft>(emptyTaskDetailsDraft);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskDraft, setCreateTaskDraft] = useState<CreateTaskDraft>(() =>
    emptyCreateTaskDraft(tasks[0]?.id ?? '')
  );

  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) ?? null,
    [tasks, editingTaskId]
  );
  const editingTaskConfig = editingTask && taskConfig?.taskId === editingTask.id
    ? taskConfig
    : null;

  useEffect(() => {
    if (!editingTaskId && !createTaskOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditingTaskId(null);
        setCreateTaskOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [createTaskOpen, editingTaskId]);

  const openTaskSettings = (taskId: string) => {
    const task = tasks.find((entry) => entry.id === taskId);
    if (task) {
      setDetailsDraft({
        titleDe: task.titleDe,
        titleEn: task.titleEn,
        descriptionDe: task.descriptionDe,
        descriptionEn: task.descriptionEn
      });
    } else {
      setDetailsDraft(emptyTaskDetailsDraft());
    }
    setEditingTaskId(taskId);
    if (taskId !== selectedTaskId) {
      onSelectTask(taskId);
    }
  };

  const closeTaskSettings = () => {
    setEditingTaskId(null);
  };

  const openCreateTaskModal = () => {
    const templateTaskId = selectedTaskId || tasks[0]?.id || '';
    setCreateTaskDraft(emptyCreateTaskDraft(templateTaskId));
    setCreateTaskOpen(true);
  };

  const closeCreateTaskModal = () => {
    setCreateTaskOpen(false);
  };

  const saveTaskDetails = () => {
    if (!editingTask) {
      return;
    }
    onSaveTaskDetails(editingTask.id, detailsDraft);
  };

  const saveCreatedTask = () => {
    onCreateTask(createTaskDraft);
  };

  const taskSettingsModal = editingTask ? (
    <div className="event-modal-backdrop" onClick={closeTaskSettings}>
      <div className="event-modal task-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{taskLabel(editingTask)}</h2>
          <button
            className="modal-close-button"
            type="button"
            onClick={closeTaskSettings}
            aria-label={t('close')}
            title={t('close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="pipeline-task-inline-editor">
          <label className="stack pipeline-field">
            <span>{t('titleDe')}</span>
            <input
              className="input"
              type="text"
              value={detailsDraft.titleDe}
              onChange={(event) =>
                setDetailsDraft((previous) => ({ ...previous, titleDe: event.target.value }))
              }
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('titleEn')}</span>
            <input
              className="input"
              type="text"
              value={detailsDraft.titleEn}
              onChange={(event) =>
                setDetailsDraft((previous) => ({ ...previous, titleEn: event.target.value }))
              }
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('descriptionDe')}</span>
            <textarea
              className="input textarea"
              value={detailsDraft.descriptionDe}
              onChange={(event) =>
                setDetailsDraft((previous) => ({ ...previous, descriptionDe: event.target.value }))
              }
              rows={3}
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('descriptionEn')}</span>
            <textarea
              className="input textarea"
              value={detailsDraft.descriptionEn}
              onChange={(event) =>
                setDetailsDraft((previous) => ({ ...previous, descriptionEn: event.target.value }))
              }
              rows={3}
            />
          </label>

          <button
            className="button secondary small"
            type="button"
            onClick={saveTaskDetails}
            disabled={taskMutationBusy}
          >
            {taskMutationBusy ? t('loading') : t('save')}
          </button>

          {editingTaskConfig ? (
            <>
              <hr />
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
            </>
          ) : (
            <p className="muted">{t('loading')}</p>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const createTaskModal = createTaskOpen ? (
    <div className="event-modal-backdrop" onClick={closeCreateTaskModal}>
      <div className="event-modal task-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{t('createTask')}</h2>
          <button
            className="modal-close-button"
            type="button"
            onClick={closeCreateTaskModal}
            aria-label={t('close')}
            title={t('close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="pipeline-task-inline-editor">
          <label className="stack pipeline-field">
            <span>{t('taskId')}</span>
            <input
              className="input mono"
              type="text"
              value={createTaskDraft.taskId}
              onChange={(event) =>
                setCreateTaskDraft((previous) => ({ ...previous, taskId: event.target.value }))
              }
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('taskTemplate')}</span>
            <select
              className="input"
              value={createTaskDraft.templateTaskId}
              onChange={(event) =>
                setCreateTaskDraft((previous) => ({ ...previous, templateTaskId: event.target.value }))
              }
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {taskLabel(task)}
                </option>
              ))}
            </select>
          </label>

          <label className="stack pipeline-field">
            <span>{t('titleDe')}</span>
            <input
              className="input"
              type="text"
              value={createTaskDraft.titleDe}
              onChange={(event) =>
                setCreateTaskDraft((previous) => ({ ...previous, titleDe: event.target.value }))
              }
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('titleEn')}</span>
            <input
              className="input"
              type="text"
              value={createTaskDraft.titleEn}
              onChange={(event) =>
                setCreateTaskDraft((previous) => ({ ...previous, titleEn: event.target.value }))
              }
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('descriptionDe')}</span>
            <textarea
              className="input textarea"
              value={createTaskDraft.descriptionDe}
              onChange={(event) =>
                setCreateTaskDraft((previous) => ({ ...previous, descriptionDe: event.target.value }))
              }
              rows={3}
            />
          </label>

          <label className="stack pipeline-field">
            <span>{t('descriptionEn')}</span>
            <textarea
              className="input textarea"
              value={createTaskDraft.descriptionEn}
              onChange={(event) =>
                setCreateTaskDraft((previous) => ({ ...previous, descriptionEn: event.target.value }))
              }
              rows={3}
            />
          </label>

          <button
            className="button"
            type="button"
            onClick={saveCreatedTask}
            disabled={taskMutationBusy}
          >
            {taskMutationBusy ? t('loading') : t('createTask')}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <section className="panel hero panel-animate full-width">
        <header className="panel-header">
          <h2>{t('tasks')}</h2>
          <button className="button secondary small" type="button" onClick={openCreateTaskModal}>
            {t('createTask')}
          </button>
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

      {typeof document !== 'undefined' && createTaskModal
        ? createPortal(createTaskModal, document.body)
        : null}
    </>
  );
}
