import type { I18nKey } from '../../i18n';
import type { GroupOverview, TimestampValue } from '../../types';

interface AdminGroupsSectionProps {
  t: (key: I18nKey) => string;
  groups: GroupOverview[];
  formatTs: (value: TimestampValue) => string;
  onShowPipelineBuilder: (groupKey: string) => void;
  onResetGroupProgress: (groupKey: string) => void;
  isResetBusy: (groupKey: string) => boolean;
}

export function AdminGroupsSection({
  t,
  groups,
  formatTs,
  onShowPipelineBuilder,
  onResetGroupProgress,
  isResetBusy
}: AdminGroupsSectionProps) {
  return (
    <section className="panel hero panel-animate full-width">
      <header className="panel-header">
        <h2>{t('groups')}</h2>
      </header>

      <div className="groups-list">
        {groups.map((group) => (
          <article key={group.groupKey} className="group-card">
            <header>
              <strong>{group.groupKey}</strong>
              <span className="chip">{t('online')}: {group.onlineCount}</span>
            </header>
            <p className="muted">{t('revision')}: {group.config.revision}</p>
            <p className="muted">{t('groupMembers')}</p>
            {group.presence.length === 0 ? (
              <p className="muted">{t('groupNoMembersOnline')}</p>
            ) : (
              <ul>
                {group.presence.map((presence) => (
                  <li key={`${presence.username}-${presence.displayName}`}>
                    {presence.displayName} - {formatTs(presence.lastSeen)}
                  </li>
                ))}
              </ul>
            )}

            <div className="admin-card-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => onShowPipelineBuilder(group.groupKey)}
              >
                {t('showPipelineBuilder')}
              </button>
              {group.hasProgress ? (
                <button
                  className="button"
                  type="button"
                  onClick={() => onResetGroupProgress(group.groupKey)}
                  disabled={isResetBusy(group.groupKey)}
                >
                  {t('resetGroupProgress')}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
