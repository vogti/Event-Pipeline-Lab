import type { I18nKey } from '../../i18n';
import { AdminIcon } from '../../app/shared-icons';
import type { LanguageMode, VirtualDeviceTopicMode } from '../../types';

interface AdminSettingsSectionProps {
  t: (key: I18nKey) => string;
  mode: LanguageMode;
  timeFormat24h: boolean;
  studentVirtualDeviceVisible: boolean;
  adminDeviceId: string | null;
  virtualDeviceTopicMode: VirtualDeviceTopicMode;
  physicalDeviceOptions: string[];
  busy: boolean;
  onModeChange: (mode: LanguageMode) => void;
  onTimeFormat24hChange: (value: boolean) => void;
  onStudentVirtualDeviceVisibleChange: (value: boolean) => void;
  onAdminDeviceIdChange: (value: string | null) => void;
  onVirtualDeviceTopicModeChange: (mode: VirtualDeviceTopicMode) => void;
  onSave: () => void;
}

export function AdminSettingsSection({
  t,
  mode,
  timeFormat24h,
  studentVirtualDeviceVisible,
  adminDeviceId,
  virtualDeviceTopicMode,
  physicalDeviceOptions,
  busy,
  onModeChange,
  onTimeFormat24hChange,
  onStudentVirtualDeviceVisibleChange,
  onAdminDeviceIdChange,
  onVirtualDeviceTopicModeChange,
  onSave
}: AdminSettingsSectionProps) {
  const adminDeviceOptions =
    adminDeviceId && !physicalDeviceOptions.includes(adminDeviceId)
      ? [adminDeviceId, ...physicalDeviceOptions]
      : physicalDeviceOptions;

  return (
    <section className="panel panel-animate full-width" id="admin-settings-panel">
      <h2>{t('settings')}</h2>
      <label>
        <span>{t('defaultLanguageMode')}</span>
        <select
          className="input"
          value={mode}
          onChange={(event) => onModeChange(event.target.value as LanguageMode)}
        >
          <option value="DE">{t('modeDe')}</option>
          <option value="EN">{t('modeEn')}</option>
          <option value="BROWSER_EN_FALLBACK">{t('modeBrowser')}</option>
        </select>
      </label>
      <label>
        <span>{t('timeFormat')}</span>
        <select
          className="input"
          value={timeFormat24h ? '24' : '12'}
          onChange={(event) => onTimeFormat24hChange(event.target.value === '24')}
        >
          <option value="24">{t('timeFormat24h')}</option>
          <option value="12">{t('timeFormat12h')}</option>
        </select>
      </label>
      <label className="checkbox-inline">
        <input
          type="checkbox"
          checked={studentVirtualDeviceVisible}
          onChange={(event) => onStudentVirtualDeviceVisibleChange(event.target.checked)}
        />
        <span>{t('virtualVisibleToStudents')}</span>
      </label>
      <label>
        <span>{t('virtualDeviceTopicModeLabel')}</span>
        <select
          className="input"
          value={virtualDeviceTopicMode}
          onChange={(event) => onVirtualDeviceTopicModeChange(event.target.value as VirtualDeviceTopicMode)}
        >
          <option value="OWN_TOPIC">{t('virtualDeviceTopicModeOwn')}</option>
          <option value="PHYSICAL_TOPIC">{t('virtualDeviceTopicModePhysical')}</option>
        </select>
      </label>
      <label>
        <span className="icon-inline-label">
          <span className="inline-icon" aria-hidden="true">
            <AdminIcon />
          </span>
          {t('adminDeviceSetting')}
        </span>
        <select
          className="input"
          value={adminDeviceId ?? ''}
          onChange={(event) => {
            const next = event.target.value.trim();
            onAdminDeviceIdChange(next.length > 0 ? next : null);
          }}
        >
          <option value="">{t('adminDeviceNone')}</option>
          {adminDeviceOptions.map((deviceId) => (
            <option key={deviceId} value={deviceId}>
              {deviceId}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button"
        type="button"
        onClick={onSave}
        disabled={busy}
      >
        {t('saveSettings')}
      </button>
    </section>
  );
}
