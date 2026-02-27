import type { ReactNode } from 'react';
import type { I18nKey } from '../../i18n';
import type { AdminFeedSource } from '../../app/shared-types';
import type { EventCategory } from '../../types';

interface AdminFeedSectionProps {
  t: (key: I18nKey) => string;
  adminFeedPaused: boolean;
  feedViewMode: 'rendered' | 'raw';
  onTogglePause: () => void;
  onToggleFeedViewMode: () => void;
  onClearFeed: () => void;
  onOpenSendEventModal: () => void;
  adminTopicFilter: string;
  onAdminTopicFilterChange: (value: string) => void;
  adminDeviceFilter: string;
  onAdminDeviceFilterChange: (value: string) => void;
  adminCategoryFilter: EventCategory | 'ALL';
  onAdminCategoryFilterChange: (value: EventCategory | 'ALL') => void;
  categoryOptions: Array<EventCategory | 'ALL'>;
  adminIncludeInternal: boolean;
  onAdminIncludeInternalChange: (value: boolean) => void;
  adminFeedSource: AdminFeedSource;
  onAdminFeedSourceChange: (value: AdminFeedSource) => void;
  adminVisibleFeedCount: number;
  adminFeedRows: ReactNode;
}

export function AdminFeedSection({
  t,
  adminFeedPaused,
  feedViewMode,
  onTogglePause,
  onToggleFeedViewMode,
  onClearFeed,
  onOpenSendEventModal,
  adminTopicFilter,
  onAdminTopicFilterChange,
  adminDeviceFilter,
  onAdminDeviceFilterChange,
  adminCategoryFilter,
  onAdminCategoryFilterChange,
  categoryOptions,
  adminIncludeInternal,
  onAdminIncludeInternalChange,
  adminFeedSource,
  onAdminFeedSourceChange,
  adminVisibleFeedCount,
  adminFeedRows
}: AdminFeedSectionProps) {
  return (
    <section className="panel panel-animate feed-panel full-width">
      <h2>{t('liveFeed')}</h2>
      <div className="toolbar">
        <button className="button secondary" type="button" onClick={onTogglePause}>
          {adminFeedPaused ? t('resume') : t('pause')}
        </button>
        <button className="button secondary" type="button" onClick={onToggleFeedViewMode}>
          {feedViewMode === 'rendered' ? t('switchToRawFeed') : t('switchToRenderedFeed')}
        </button>
        <button className="button secondary" type="button" onClick={onClearFeed}>
          {t('clear')}
        </button>
        <button className="button ghost" type="button" onClick={onOpenSendEventModal}>
          {t('sendMqttEvent')}
        </button>

        <input
          className="input"
          placeholder={t('topicFilter')}
          value={adminTopicFilter}
          onChange={(event) => onAdminTopicFilterChange(event.target.value)}
        />

        <input
          className="input"
          placeholder={t('device')}
          value={adminDeviceFilter}
          onChange={(event) => onAdminDeviceFilterChange(event.target.value)}
        />

        <select
          className="input"
          value={adminCategoryFilter}
          onChange={(event) => onAdminCategoryFilterChange(event.target.value as EventCategory | 'ALL')}
        >
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={adminIncludeInternal}
            onChange={(event) => onAdminIncludeInternalChange(event.target.checked)}
          />
          <span>{t('includeInternal')}</span>
        </label>

        <select
          className="input"
          value={adminFeedSource}
          onChange={(event) => onAdminFeedSourceChange(event.target.value as AdminFeedSource)}
        >
          <option value="AFTER_DISTURBANCES">{t('feedSourceAfterDisturbances')}</option>
          <option value="BEFORE_DISTURBANCES">{t('feedSourceBeforeDisturbances')}</option>
          <option value="AFTER_PIPELINE">{t('feedSourceAfterPipeline')}</option>
        </select>
      </div>

      <div className="feed-table-wrap">
        <table className="feed-table">
          <thead>
            <tr>
              <th>{t('feedHeaderIngestTs')}</th>
              <th>{t('feedHeaderDeviceId')}</th>
              <th>{t('feedHeaderEventType')}</th>
              <th>{feedViewMode === 'rendered' ? t('value') : t('rawPayload')}</th>
              <th>{t('category')}</th>
              <th>{t('feedHeaderTopic')}</th>
            </tr>
          </thead>
          <tbody>
            {adminVisibleFeedCount === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
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
