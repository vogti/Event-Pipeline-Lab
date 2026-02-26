import type { I18nKey } from '../../i18n';
import type { LanguageMode } from '../../types';

interface AdminSettingsSectionProps {
  t: (key: I18nKey) => string;
  mode: LanguageMode;
  timeFormat24h: boolean;
  studentVirtualDeviceVisible: boolean;
  busy: boolean;
  onModeChange: (mode: LanguageMode) => void;
  onTimeFormat24hChange: (value: boolean) => void;
  onStudentVirtualDeviceVisibleChange: (value: boolean) => void;
  onSave: () => void;
}

export function AdminSettingsSection({
  t,
  mode,
  timeFormat24h,
  studentVirtualDeviceVisible,
  busy,
  onModeChange,
  onTimeFormat24hChange,
  onStudentVirtualDeviceVisibleChange,
  onSave
}: AdminSettingsSectionProps) {
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
