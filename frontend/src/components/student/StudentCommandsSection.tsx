import type { I18nKey } from '../../i18n';
import { formatBrightnessMeasurement, MetricIcon } from '../../app/shared';
import type { DeviceCommandType, StudentDeviceScope, StudentDeviceState } from '../../types';

interface StudentCommandsSectionProps {
  t: (key: I18nKey) => string;
  studentCommandWhitelist: string[];
  commandTargetScope: StudentDeviceScope;
  targetDeviceId: string;
  resolvedTargetId: string;
  targetDeviceState: StudentDeviceState | null;
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
  resolvedTargetId,
  targetDeviceState,
  ownDeviceId,
  adminDeviceId,
  onTargetDeviceIdChange,
  isCommandBusy,
  onSendCommand
}: StudentCommandsSectionProps) {
  const trimmedOwn = ownDeviceId.trim();
  const trimmedAdmin = adminDeviceId.trim();
  const hasAdmin = trimmedAdmin.length > 0;
  const hasTarget = resolvedTargetId.trim().length > 0;

  const online: boolean | null = targetDeviceState ? targetDeviceState.online : null;
  const redPressed = targetDeviceState?.buttonRedPressed ?? null;
  const blackPressed = targetDeviceState?.buttonBlackPressed ?? null;
  const greenOn = targetDeviceState?.ledGreenOn ?? null;
  const orangeOn = targetDeviceState?.ledOrangeOn ?? null;

  const redButtonClass = redPressed === null
    ? 'state-unknown'
    : redPressed
      ? 'state-pressed'
      : 'state-released';
  const blackButtonClass = blackPressed === null
    ? 'state-unknown'
    : blackPressed
      ? 'state-pressed'
      : 'state-released';
  const redButtonLabel = redPressed === null
    ? t('stateUnknown')
    : redPressed
      ? t('statePressed')
      : t('stateReleased');
  const blackButtonLabel = blackPressed === null
    ? t('stateUnknown')
    : blackPressed
      ? t('statePressed')
      : t('stateReleased');

  const temperature = online !== true || targetDeviceState?.temperatureC == null
    ? '-'
    : `${targetDeviceState.temperatureC.toFixed(1)} °C`;
  const humidity = online !== true || targetDeviceState?.humidityPct == null
    ? '-'
    : `${Math.round(targetDeviceState.humidityPct)} %`;
  const brightness = online !== true || targetDeviceState?.brightness == null
    ? '-'
    : formatBrightnessMeasurement(targetDeviceState.brightness);
  const counterValue = targetDeviceState?.counterValue == null
    ? '-'
    : Number.isInteger(targetDeviceState.counterValue)
      ? String(targetDeviceState.counterValue)
      : targetDeviceState.counterValue.toFixed(2);

  const nextGreenState = greenOn === null ? true : !greenOn;
  const nextOrangeState = orangeOn === null ? true : !orangeOn;
  const greenBusy = isCommandBusy('LED_GREEN', nextGreenState);
  const orangeBusy = isCommandBusy('LED_ORANGE', nextOrangeState);
  const counterBusy = isCommandBusy('COUNTER_RESET');

  return (
    <section className="panel panel-animate">
      <div className="panel-header student-command-header">
        <h2>{t('commands')}</h2>
        <div className="student-command-header-right">
          <span className="chip mono">{resolvedTargetId || t('stateUnknown')}</span>
          <span className={`chip ${online === true ? 'ok' : online === false ? 'warn' : ''}`}>
            {online === null ? t('stateUnknown') : online ? t('online') : t('offline')}
          </span>
        </div>
      </div>

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

      <div className="device-metrics-grid student-command-metrics">
        <div className="device-metric">
          <span className="metric-icon">
            <MetricIcon kind="temperature" />
          </span>
          <span className="metric-text">{temperature}</span>
        </div>
        <div className="device-metric">
          <span className="metric-icon">
            <MetricIcon kind="humidity" />
          </span>
          <span className="metric-text">{humidity}</span>
        </div>
        <div className="device-metric">
          <span className="metric-icon">
            <MetricIcon kind="brightness" />
          </span>
          <span className="metric-text">{brightness}</span>
        </div>
        <div className="device-metric">
          <span className="metric-icon">
            <MetricIcon kind="counter" />
          </span>
          <span className="metric-text">{counterValue}</span>
        </div>
        <div className="device-metric full">
          <span className="metric-icon">
            <MetricIcon kind="buttons" />
          </span>
          <span className="metric-text metric-state-row">
            <span className="metric-label">{t('colorRed')}:</span>
            <span className={`state-label ${redButtonClass}`}>{redButtonLabel}</span>
          </span>
        </div>
        <div className="device-metric full">
          <span className="metric-icon">
            <MetricIcon kind="buttons" />
          </span>
          <span className="metric-text metric-state-row">
            <span className="metric-label">{t('colorBlack')}:</span>
            <span className={`state-label ${blackButtonClass}`}>{blackButtonLabel}</span>
          </span>
        </div>
      </div>

      <div className="virtual-led-controls student-led-controls">
        {studentCommandWhitelist.includes('LED_GREEN') ? (
          <button
            type="button"
            className={`virtual-led-toggle green ${greenOn ? 'lit' : ''}`}
            onClick={() => onSendCommand('LED_GREEN', nextGreenState)}
            aria-pressed={Boolean(greenOn)}
            disabled={!hasTarget || greenBusy}
          >
            <span className="virtual-led-lamp" aria-hidden="true" />
            <span>{t('commandGreenLed')}</span>
          </button>
        ) : null}
        {studentCommandWhitelist.includes('LED_ORANGE') ? (
          <button
            type="button"
            className={`virtual-led-toggle orange ${orangeOn ? 'lit' : ''}`}
            onClick={() => onSendCommand('LED_ORANGE', nextOrangeState)}
            aria-pressed={Boolean(orangeOn)}
            disabled={!hasTarget || orangeBusy}
          >
            <span className="virtual-led-lamp" aria-hidden="true" />
            <span>{t('commandOrangeLed')}</span>
          </button>
        ) : null}
      </div>

      <div className="button-grid student-command-actions">
        {studentCommandWhitelist.includes('COUNTER_RESET') ? (
          <button
            className="button ghost"
            type="button"
            onClick={() => onSendCommand('COUNTER_RESET')}
            disabled={!hasTarget || counterBusy}
          >
            {t('commandCounterReset')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
