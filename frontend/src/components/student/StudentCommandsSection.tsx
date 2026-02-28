import { useState } from 'react';
import type { I18nKey } from '../../i18n';
import { formatBrightnessMeasurement, MetricIcon, rssiBars, rssiClassName } from '../../app/shared';
import { CloseIcon } from '../../app/shared-icons';
import type { DeviceCommandType, StudentDeviceState } from '../../types';

interface StudentCommandsSectionProps {
  t: (key: I18nKey) => string;
  studentCommandWhitelist: string[];
  deviceId: string;
  deviceState: StudentDeviceState | null;
  isCommandBusy: (command: DeviceCommandType, on?: boolean) => boolean;
  onSendCommand: (command: DeviceCommandType, on?: boolean) => void;
}

export function StudentCommandsSection({
  t,
  studentCommandWhitelist,
  deviceId,
  deviceState,
  isCommandBusy,
  onSendCommand
}: StudentCommandsSectionProps) {
  const [counterResetModalOpen, setCounterResetModalOpen] = useState(false);
  const resolvedDeviceId = deviceId.trim();
  const hasTarget = resolvedDeviceId.length > 0;

  const online: boolean | null = deviceState ? deviceState.online : null;
  const rssi = deviceState?.rssi ?? null;
  const redPressed = deviceState?.buttonRedPressed ?? null;
  const blackPressed = deviceState?.buttonBlackPressed ?? null;
  const greenOn = deviceState?.ledGreenOn ?? null;
  const orangeOn = deviceState?.ledOrangeOn ?? null;
  const rssiHint = online === true ? (rssi === null ? t('rssiNoData') : `${Math.round(rssi)} dBm`) : '-';
  const bars = online === true ? rssiBars(rssi) : 0;

  const renderRssiIndicator = (idSuffix: string) => (
    <span className="rssi-tooltip-host">
      <span
        className={`rssi-bars ${online === true ? rssiClassName(rssi) : 'none'}`}
        aria-label={rssiHint}
        aria-describedby={`student-rssi-tooltip-${idSuffix}`}
      >
        <span className={`bar ${bars >= 1 ? 'active' : ''}`} />
        <span className={`bar ${bars >= 2 ? 'active' : ''}`} />
        <span className={`bar ${bars >= 3 ? 'active' : ''}`} />
        <span className={`bar ${bars >= 4 ? 'active' : ''}`} />
      </span>
      <span className="rssi-tooltip" id={`student-rssi-tooltip-${idSuffix}`}>
        {rssiHint}
      </span>
    </span>
  );

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

  const temperature = online !== true || deviceState?.temperatureC == null
    ? '-'
    : `${deviceState.temperatureC.toFixed(1)} °C`;
  const humidity = online !== true || deviceState?.humidityPct == null
    ? '-'
    : `${Math.round(deviceState.humidityPct)} %`;
  const brightness = online !== true || deviceState?.brightness == null
    ? '-'
    : formatBrightnessMeasurement(deviceState.brightness);
  const counterValue = deviceState?.counterValue == null
    ? '-'
    : Number.isInteger(deviceState.counterValue)
      ? String(deviceState.counterValue)
      : deviceState.counterValue.toFixed(2);

  const nextGreenState = greenOn === null ? true : !greenOn;
  const nextOrangeState = orangeOn === null ? true : !orangeOn;
  const greenBusy = isCommandBusy('LED_GREEN', nextGreenState);
  const orangeBusy = isCommandBusy('LED_ORANGE', nextOrangeState);
  const counterBusy = isCommandBusy('COUNTER_RESET');
  const canResetCounter = studentCommandWhitelist.includes('COUNTER_RESET');

  return (
    <section className="panel panel-animate">
      <div className="panel-header student-command-header">
        <h2>{t('device')}</h2>
        <div className="student-command-header-right">
          <span className="chip mono">
            <span>{resolvedDeviceId || t('stateUnknown')}</span>
          </span>
          <span className={`chip ${online === true ? 'ok' : online === false ? 'warn' : ''}`}>
            {online === true ? renderRssiIndicator('status') : null}
            {online === null ? t('stateUnknown') : online ? t('online') : t('offline')}
          </span>
        </div>
      </div>

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
        {canResetCounter ? (
          <button
            type="button"
            className="device-metric counter-metric-trigger"
            onClick={() => setCounterResetModalOpen(true)}
            title={t('commandCounterReset')}
            disabled={!hasTarget || counterBusy}
          >
            <span className="metric-icon">
              <MetricIcon kind="counter" />
            </span>
            <span className="metric-text">{counterValue}</span>
          </button>
        ) : (
          <div className="device-metric">
            <span className="metric-icon">
              <MetricIcon kind="counter" />
            </span>
            <span className="metric-text">{counterValue}</span>
          </div>
        )}
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

      {counterResetModalOpen ? (
        <div className="event-modal-backdrop" onClick={() => setCounterResetModalOpen(false)}>
          <div className="event-modal counter-reset-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('counterResetDialogTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={() => setCounterResetModalOpen(false)}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <p>
              {t('counterResetDialogBody')} <strong>{resolvedDeviceId || t('stateUnknown')}</strong>?
            </p>
            <div className="event-modal-actions">
              <button
                className="button danger"
                type="button"
                onClick={() => {
                  onSendCommand('COUNTER_RESET');
                  setCounterResetModalOpen(false);
                }}
                disabled={!hasTarget || counterBusy}
              >
                {t('commandCounterReset')}
              </button>
              <button className="button secondary" type="button" onClick={() => setCounterResetModalOpen(false)}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
