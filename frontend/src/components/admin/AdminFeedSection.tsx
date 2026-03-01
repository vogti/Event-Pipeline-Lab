import type { ReactNode } from 'react';
import type { I18nKey } from '../../i18n';
import type { AdminFeedSource } from '../../app/shared-types';

interface AdminFeedSectionProps {
  t: (key: I18nKey) => string;
  title?: string;
  adminFeedPaused: boolean;
  feedViewMode: 'rendered' | 'raw';
  showRawViewToggle?: boolean;
  onTogglePause: () => void;
  onToggleFeedViewMode: () => void;
  onClearFeed: () => void;
  showPublishEventButton?: boolean;
  onOpenSendEventModal?: () => void;
  adminTopicFilter: string;
  onAdminTopicFilterChange: (value: string) => void;
  showInternalEventsToggle?: boolean;
  adminIncludeInternal: boolean;
  onAdminIncludeInternalChange: (value: boolean) => void;
  showFeedSourceSelector?: boolean;
  adminFeedSource?: AdminFeedSource;
  onAdminFeedSourceChange?: (value: AdminFeedSource) => void;
  adminVisibleFeedCount: number;
  adminFeedRows: ReactNode;
}

export function AdminFeedSection({
  t,
  title,
  adminFeedPaused,
  feedViewMode,
  showRawViewToggle = true,
  onTogglePause,
  onToggleFeedViewMode,
  onClearFeed,
  showPublishEventButton = true,
  onOpenSendEventModal,
  adminTopicFilter,
  onAdminTopicFilterChange,
  showInternalEventsToggle = true,
  adminIncludeInternal,
  onAdminIncludeInternalChange,
  showFeedSourceSelector = true,
  adminFeedSource,
  onAdminFeedSourceChange,
  adminVisibleFeedCount,
  adminFeedRows
}: AdminFeedSectionProps) {
  return (
    <section className="panel panel-animate feed-panel full-width">
      <h2>{title ?? t('liveFeed')}</h2>
      <div className="toolbar">
        <button className="button secondary" type="button" onClick={onTogglePause}>
          {adminFeedPaused ? t('resume') : t('pause')}
        </button>
        {showRawViewToggle ? (
          <button className="button secondary" type="button" onClick={onToggleFeedViewMode}>
            {feedViewMode === 'rendered' ? t('switchToRawFeed') : t('switchToRenderedFeed')}
          </button>
        ) : null}
        <button className="button secondary" type="button" onClick={onClearFeed}>
          {t('clear')}
        </button>
        {showPublishEventButton && onOpenSendEventModal ? (
          <button className="button ghost" type="button" onClick={onOpenSendEventModal}>
            {t('publishEvent')}
          </button>
        ) : null}

        <input
          className="input"
          placeholder={t('topicFilter')}
          value={adminTopicFilter}
          onChange={(event) => onAdminTopicFilterChange(event.target.value)}
        />

        {showInternalEventsToggle ? (
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={adminIncludeInternal}
              onChange={(event) => onAdminIncludeInternalChange(event.target.checked)}
            />
            <span>{t('includeInternal')}</span>
          </label>
        ) : null}

        {showFeedSourceSelector && adminFeedSource && onAdminFeedSourceChange ? (
          <select
            className="input"
            value={adminFeedSource}
            onChange={(event) => onAdminFeedSourceChange(event.target.value as AdminFeedSource)}
          >
            <option value="AFTER_DISTURBANCES">{t('feedSourceAfterDisturbances')}</option>
            <option value="BEFORE_DISTURBANCES">{t('feedSourceBeforeDisturbances')}</option>
          </select>
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
            {adminVisibleFeedCount === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {t('noEvents')}
                </td>
              </tr>
            ) : (
              adminFeedRows
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
