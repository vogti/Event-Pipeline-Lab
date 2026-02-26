import type { I18nKey } from '../../i18n';
import type { AdminPage, WsConnectionState } from '../../app/shared-types';

interface AdminDashboardSectionProps {
  t: (key: I18nKey) => string;
  wsConnection: WsConnectionState;
  wsLabel: string;
  deviceCount: number;
  onlineDeviceCount: number;
  groupCount: number;
  onlineUserCount: number;
  eventCount: number;
  currentTaskLabel: string;
  lastEventLabel: string;
  onNavigate: (page: AdminPage) => void;
}

export function AdminDashboardSection({
  t,
  wsConnection,
  wsLabel,
  deviceCount,
  onlineDeviceCount,
  groupCount,
  onlineUserCount,
  eventCount,
  currentTaskLabel,
  lastEventLabel,
  onNavigate
}: AdminDashboardSectionProps) {
  return (
    <>
      <section className="panel hero panel-animate full-width">
        <div className="panel-header">
          <h2>{t('dashboard')}</h2>
          <span className={`status-pill ${wsConnection}`}>{wsLabel}</span>
        </div>
        <div className="chip-row">
          <span className="chip">{t('devices')}: {deviceCount}</span>
          <span className="chip ok">{t('online')}: {onlineDeviceCount}</span>
          <span className="chip warn">{t('offline')}: {Math.max(0, deviceCount - onlineDeviceCount)}</span>
          <span className="chip">{t('groups')}: {groupCount}</span>
          <span className="chip">{t('groupPresence')}: {onlineUserCount}</span>
          <span className="chip">{t('liveFeed')}: {eventCount}</span>
        </div>
        <div className="meta-row">
          <span>{t('currentTask')}: {currentTaskLabel}</span>
          <span>{t('lastEvent')}: {lastEventLabel}</span>
        </div>
        <div className="admin-dashboard-actions">
          <button className="button secondary" type="button" onClick={() => onNavigate('devices')}>
            {t('devices')}
          </button>
          <button className="button secondary" type="button" onClick={() => onNavigate('virtualDevices')}>
            {t('virtualDevices')}
          </button>
          <button className="button secondary" type="button" onClick={() => onNavigate('feed')}>
            {t('liveFeed')}
          </button>
          <button className="button secondary" type="button" onClick={() => onNavigate('tasks')}>
            {t('tasks')}
          </button>
          <button className="button secondary" type="button" onClick={() => onNavigate('groups')}>
            {t('groups')}
          </button>
          <button className="button secondary" type="button" onClick={() => onNavigate('systemStatus')}>
            {t('systemStatus')}
          </button>
          <button className="button secondary" type="button" onClick={() => onNavigate('settings')}>
            {t('settings')}
          </button>
        </div>
      </section>

      <section className="panel panel-animate">
        <h2>{t('tasks')}</h2>
        <p className="muted">
          {t('currentTask')}: {currentTaskLabel}
        </p>
      </section>

      <section className="panel panel-animate">
        <h2>{t('groups')}</h2>
        <p className="muted">{t('groupPresence')}: {onlineUserCount}</p>
      </section>
    </>
  );
}
