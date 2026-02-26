import type { I18nKey } from '../../i18n';
import type { TaskInfo, TimestampValue, GroupOverview } from '../../types';

interface AdminGroupsTasksSectionProps {
  t: (key: I18nKey) => string;
  tasks: TaskInfo[];
  groups: GroupOverview[];
  taskLabel: (task: TaskInfo) => string;
  taskDescriptionLabel: (task: TaskInfo) => string;
  onActivateTask: (taskId: string) => void;
  isTaskActivationBusy: (taskId: string) => boolean;
  formatTs: (value: TimestampValue) => string;
}

export function AdminGroupsTasksSection({
  t,
  tasks,
  groups,
  taskLabel,
  taskDescriptionLabel,
  onActivateTask,
  isTaskActivationBusy,
  formatTs
}: AdminGroupsTasksSectionProps) {
  return (
    <>
      <section className="panel hero panel-animate">
        <h2>{t('tasks')}</h2>
        <div className="tasks-list">
          {tasks.map((task) => (
            <article key={task.id} className={`task-card ${task.active ? 'active' : ''}`}>
              <header>
                <strong>{taskLabel(task)}</strong>
                {task.active ? <span className="chip">{t('statusActive')}</span> : null}
              </header>
              <p>{taskDescriptionLabel(task)}</p>
              <button
                className="button"
                type="button"
                onClick={() => onActivateTask(task.id)}
                disabled={isTaskActivationBusy(task.id) || task.active}
              >
                {t('activate')}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-animate">
        <h2>{t('groups')}</h2>
        <div className="groups-list">
          {groups.map((group) => (
            <article key={group.groupKey} className="group-card">
              <header>
                <strong>{group.groupKey}</strong>
                <span className="chip">{t('online')}: {group.onlineCount}</span>
              </header>
              <p className="muted">{t('revision')}: {group.config.revision}</p>
              <ul>
                {group.presence.map((presence) => (
                  <li key={`${presence.username}-${presence.displayName}`}>
                    {presence.displayName} - {formatTs(presence.lastSeen)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
