import type { I18nKey } from '../../i18n';
import type { DeviceCommandType, StudentDeviceScope } from '../../types';

interface StudentCommandsSectionProps {
  t: (key: I18nKey) => string;
  studentCommandWhitelist: string[];
  commandTargetScope: StudentDeviceScope;
  targetDeviceId: string;
  ownDeviceId: string;
  adminDeviceId: string;
  onTargetDeviceIdChange: (value: string) => void;
  isCommandBusy: (command: DeviceCommandType, on?: boolean) => boolean;
  onSendCommand: (command: DeviceCommandType, on?: boolean) => void;
}

export function StudentCommandsSection({
  t,
  studentCommandWhitelist,
  commandTargetScope,
  targetDeviceId,
  ownDeviceId,
  adminDeviceId,
  onTargetDeviceIdChange,
  isCommandBusy,
  onSendCommand
}: StudentCommandsSectionProps) {
  const trimmedTarget = targetDeviceId.trim();
  const trimmedOwn = ownDeviceId.trim();
  const trimmedAdmin = adminDeviceId.trim();
  const hasAdmin = trimmedAdmin.length > 0;
  const resolvedTargetId = commandTargetScope === 'OWN_DEVICE'
    ? trimmedOwn
    : commandTargetScope === 'ADMIN_DEVICE'
      ? trimmedAdmin
      : commandTargetScope === 'OWN_AND_ADMIN_DEVICE'
        ? (hasAdmin
          ? (trimmedTarget === trimmedOwn || trimmedTarget === trimmedAdmin ? trimmedTarget : trimmedOwn)
          : trimmedOwn)
        : trimmedTarget;
  const hasTarget = resolvedTargetId.length > 0;

  return (
    <section className="panel panel-animate">
      <h2>{t('commands')}</h2>
      {commandTargetScope === 'OWN_DEVICE' ? (
        <p className="muted">{`${t('studentCommandScopeOwn')} (${ownDeviceId})`}</p>
      ) : null}
      {commandTargetScope === 'ADMIN_DEVICE' ? (
        <p className="muted">
          {adminDeviceId
            ? `${t('studentCommandScopeAdmin')} (${adminDeviceId})`
            : t('studentCommandAdminDeviceMissing')}
        </p>
      ) : null}
      {commandTargetScope === 'ALL_DEVICES' ? (
        <label className="stack">
          <span>{t('studentCommandScopeAll')}</span>
          <input
            className="input mono"
            type="text"
            value={targetDeviceId}
            onChange={(event) => onTargetDeviceIdChange(event.target.value)}
            placeholder={t('studentCommandTargetDevice')}
          />
        </label>
      ) : null}
      {commandTargetScope === 'OWN_AND_ADMIN_DEVICE' ? (
        hasAdmin ? (
          <label className="stack">
            <span>{t('studentCommandScopeOwnAdmin')}</span>
            <select
              className="input"
              value={resolvedTargetId}
              onChange={(event) => onTargetDeviceIdChange(event.target.value)}
            >
              <option value={trimmedOwn}>{`${t('studentCommandTargetOwn')} (${trimmedOwn})`}</option>
              <option value={trimmedAdmin}>{`${t('studentCommandTargetAdmin')} (${trimmedAdmin})`}</option>
            </select>
          </label>
        ) : (
          <p className="muted">
            {`${t('studentCommandScopeOwn')} (${trimmedOwn}) · ${t('studentCommandAdminDeviceMissing')}`}
          </p>
        )
      ) : null}
      <div className="button-grid">
        {studentCommandWhitelist.includes('LED_GREEN') ? (
          <>
            <button
              className="button"
              type="button"
              onClick={() => onSendCommand('LED_GREEN', true)}
              disabled={!hasTarget || isCommandBusy('LED_GREEN', true)}
            >
              {t('commandGreenOn')}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => onSendCommand('LED_GREEN', false)}
              disabled={!hasTarget || isCommandBusy('LED_GREEN', false)}
            >
              {t('commandGreenOff')}
            </button>
          </>
        ) : null}

        {studentCommandWhitelist.includes('LED_ORANGE') ? (
          <>
            <button
              className="button"
              type="button"
              onClick={() => onSendCommand('LED_ORANGE', true)}
              disabled={!hasTarget || isCommandBusy('LED_ORANGE', true)}
            >
              {t('commandOrangeOn')}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => onSendCommand('LED_ORANGE', false)}
              disabled={!hasTarget || isCommandBusy('LED_ORANGE', false)}
            >
              {t('commandOrangeOff')}
            </button>
          </>
        ) : null}

        {studentCommandWhitelist.includes('COUNTER_RESET') ? (
          <button
            className="button ghost"
            type="button"
            onClick={() => onSendCommand('COUNTER_RESET')}
            disabled={!hasTarget || isCommandBusy('COUNTER_RESET')}
          >
            {t('commandCounterReset')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
