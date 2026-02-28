import type { ReactNode } from 'react';
import type { StudentFeedSource } from '../../app/shared-types';
import type { I18nKey } from '../../i18n';

interface StudentFeedSectionProps {
  t: (key: I18nKey) => string;
  studentFeedPaused: boolean;
  feedViewMode: 'rendered' | 'raw';
  showRawViewToggle?: boolean;
  onTogglePause: () => void;
  onToggleFeedViewMode: () => void;
  onClearFeed: () => void;
  showSendEventButton?: boolean;
  onOpenSendEventModal?: () => void;
  studentTopicFilter: string;
  onStudentTopicFilterChange: (value: string) => void;
  canFilterByTopic: boolean;
  showInternalEventsToggle: boolean;
  studentShowInternal: boolean;
  onStudentShowInternalChange: (value: boolean) => void;
  showFeedSourceSelector?: boolean;
  studentFeedSource: StudentFeedSource;
  onStudentFeedSourceChange: (value: StudentFeedSource) => void;
  studentVisibleFeedCount: number;
  studentFeedRows: ReactNode;
}

export function StudentFeedSection({
  t,
  studentFeedPaused,
  feedViewMode,
  showRawViewToggle = true,
  onTogglePause,
  onToggleFeedViewMode,
  onClearFeed,
  showSendEventButton = false,
  onOpenSendEventModal,
  studentTopicFilter,
  onStudentTopicFilterChange,
  canFilterByTopic,
  showInternalEventsToggle,
  studentShowInternal,
  onStudentShowInternalChange,
  showFeedSourceSelector = true,
  studentFeedSource,
  onStudentFeedSourceChange,
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
        {showRawViewToggle ? (
          <button className="button secondary" type="button" onClick={onToggleFeedViewMode}>
            {feedViewMode === 'rendered' ? t('switchToRawFeed') : t('switchToRenderedFeed')}
          </button>
        ) : null}
        <button className="button secondary" type="button" onClick={onClearFeed}>
          {t('clear')}
        </button>
        {showSendEventButton ? (
          <button className="button ghost" type="button" onClick={onOpenSendEventModal}>
            {t('publishEvent')}
          </button>
        ) : null}

        <input
          className="input"
          placeholder={t('topicFilter')}
          value={studentTopicFilter}
          onChange={(event) => onStudentTopicFilterChange(event.target.value)}
          disabled={!canFilterByTopic}
        />

        {showFeedSourceSelector ? (
          <select
            className="input"
            value={studentFeedSource}
            onChange={(event) => onStudentFeedSourceChange(event.target.value as StudentFeedSource)}
          >
            <option value="BEFORE_PIPELINE">{t('feedSourceBeforePipeline')}</option>
            <option value="AFTER_PIPELINE">{t('feedSourceAfterPipeline')}</option>
          </select>
        ) : null}

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
              <th>{t('feedHeaderTopic')}</th>
              <th>{feedViewMode === 'rendered' ? t('value') : t('rawPayload')}</th>
            </tr>
          </thead>
          <tbody>
            {studentVisibleFeedCount === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
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
