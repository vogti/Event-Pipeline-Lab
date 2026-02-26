import type { ReactNode } from 'react';
import type { I18nKey } from '../../i18n';

interface StudentFeedSectionProps {
  t: (key: I18nKey) => string;
  studentFeedPaused: boolean;
  feedViewMode: 'rendered' | 'raw';
  onTogglePause: () => void;
  onToggleFeedViewMode: () => void;
  onClearFeed: () => void;
  studentTopicFilter: string;
  onStudentTopicFilterChange: (value: string) => void;
  canFilterByTopic: boolean;
  showInternalEventsToggle: boolean;
  studentShowInternal: boolean;
  onStudentShowInternalChange: (value: boolean) => void;
  studentVisibleFeedCount: number;
  studentFeedRows: ReactNode;
}

export function StudentFeedSection({
  t,
  studentFeedPaused,
  feedViewMode,
  onTogglePause,
  onToggleFeedViewMode,
  onClearFeed,
  studentTopicFilter,
  onStudentTopicFilterChange,
  canFilterByTopic,
  showInternalEventsToggle,
  studentShowInternal,
  onStudentShowInternalChange,
  studentVisibleFeedCount,
  studentFeedRows
}: StudentFeedSectionProps) {
  return (
    <section className="panel panel-animate feed-panel full-width">
      <h2>{t('liveFeed')}</h2>
      <div className="toolbar">
        <button className="button secondary" type="button" onClick={onTogglePause}>
          {studentFeedPaused ? t('resume') : t('pause')}
        </button>
        <button className="button secondary" type="button" onClick={onToggleFeedViewMode}>
          {feedViewMode === 'rendered' ? t('switchToRawFeed') : t('switchToRenderedFeed')}
        </button>
        <button className="button secondary" type="button" onClick={onClearFeed}>
          {t('clear')}
        </button>

        <input
          className="input"
          placeholder={t('topicFilter')}
          value={studentTopicFilter}
          onChange={(event) => onStudentTopicFilterChange(event.target.value)}
          disabled={!canFilterByTopic}
        />

        {showInternalEventsToggle ? (
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={studentShowInternal}
              onChange={(event) => onStudentShowInternalChange(event.target.checked)}
            />
            <span>{t('includeInternal')}</span>
          </label>
        ) : null}
      </div>

      <div className="feed-table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>{t('feedHeaderIngestTs')}</th>
              <th>{t('feedHeaderDeviceId')}</th>
              <th>{t('feedHeaderEventType')}</th>
              <th>{feedViewMode === 'rendered' ? t('value') : t('rawPayload')}</th>
              <th>{t('feedHeaderTopic')}</th>
            </tr>
          </thead>
          <tbody>
            {studentVisibleFeedCount === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {t('noEvents')}
                </td>
              </tr>
            ) : (
              studentFeedRows
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
