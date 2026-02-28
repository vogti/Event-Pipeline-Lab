import type { I18nKey } from '../i18n';
import type { CounterResetTarget, VirtualDevicePatch } from '../app/shared-types';
import type { CanonicalEvent, VirtualDeviceState } from '../types';
import { CloseIcon } from '../app/shared-icons';

interface AppModalsProps {
  t: (key: I18nKey) => string;
  selectedEvent: CanonicalEvent | null;
  selectedEventFields: Array<[string, string]>;
  selectedEventRawJson: string;
  selectedEventPayloadPretty: string;
  eventDetailsViewMode: 'rendered' | 'raw';
  onToggleEventDetailsViewMode: () => void;
  onCloseSelectedEvent: () => void;
  virtualControlDeviceId: string | null;
  selectedAdminVirtualDevice: VirtualDeviceState | null;
  virtualControlPatch: VirtualDevicePatch | null;
  virtualMirrorModeActive: boolean;
  onCloseVirtualControlModal: () => void;
  onSetModalVirtualField: (field: keyof VirtualDevicePatch, value: boolean | number) => void;
  resetEventsModalOpen: boolean;
  onCloseResetEventsModal: () => void;
  onResetStoredEvents: () => void;
  resetEventsBusy: boolean;
  counterResetTarget: CounterResetTarget | null;
  onCloseCounterResetModal: () => void;
  onConfirmCounterReset: () => void;
  counterResetBusy: boolean;
  pinEditorDeviceId: string | null;
  pinEditorValue: string;
  onPinEditorValueChange: (value: string) => void;
  pinEditorLoading: boolean;
  pinEditorSaveBusy: boolean;
  onSavePinEditor: () => void;
  onClosePinEditor: () => void;
}

export function AppModals({
  t,
  selectedEvent,
  selectedEventFields,
  selectedEventRawJson,
  selectedEventPayloadPretty,
  eventDetailsViewMode,
  onToggleEventDetailsViewMode,
  onCloseSelectedEvent,
  virtualControlDeviceId,
  selectedAdminVirtualDevice,
  virtualControlPatch,
  virtualMirrorModeActive,
  onCloseVirtualControlModal,
  onSetModalVirtualField,
  resetEventsModalOpen,
  onCloseResetEventsModal,
  onResetStoredEvents,
  resetEventsBusy,
  counterResetTarget,
  onCloseCounterResetModal,
  onConfirmCounterReset,
  counterResetBusy,
  pinEditorDeviceId,
  pinEditorValue,
  onPinEditorValueChange,
  pinEditorLoading,
  pinEditorSaveBusy,
  onSavePinEditor,
  onClosePinEditor
}: AppModalsProps) {
  const virtualTemperature = Number.isFinite(virtualControlPatch?.temperatureC)
    ? virtualControlPatch?.temperatureC ?? 0
    : 0;
  const virtualHumidity = Number.isFinite(virtualControlPatch?.humidityPct)
    ? virtualControlPatch?.humidityPct ?? 0
    : 0;
  const virtualBrightness = Number.isFinite(virtualControlPatch?.brightness)
    ? virtualControlPatch?.brightness ?? 0
    : 0;
  const virtualCounter = Number.isFinite(virtualControlPatch?.counterValue)
    ? virtualControlPatch?.counterValue ?? 0
    : 0;

  return (
    <>
      {selectedEvent ? (
        <div className="event-modal-backdrop" onClick={onCloseSelectedEvent}>
          <div className="event-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('eventDetails')}</h2>
              <div className="event-modal-actions">
                <button className="button secondary" type="button" onClick={onToggleEventDetailsViewMode}>
                  {eventDetailsViewMode === 'rendered'
                    ? t('switchToRawEvent')
                    : t('switchToRenderedEvent')}
                </button>
                <button
                  className="modal-close-button"
                  type="button"
                  onClick={onCloseSelectedEvent}
                  aria-label={t('close')}
                  title={t('close')}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            {eventDetailsViewMode === 'rendered' ? (
              <>
                <div className="event-details-grid">
                  {selectedEventFields.map(([key, value]) => (
                    <div key={key} className="event-details-row">
                      <div className="event-details-key">{key}</div>
                      <div className="event-details-value mono">{value}</div>
                    </div>
                  ))}
                </div>
                <h3 className="event-modal-subtitle">{t('payload')}</h3>
                <pre className="event-modal-pre">{selectedEventPayloadPretty}</pre>
              </>
            ) : (
              <pre className="event-modal-pre event-modal-pre-raw">{selectedEventRawJson}</pre>
            )}
          </div>
        </div>
      ) : null}

      {virtualControlDeviceId && selectedAdminVirtualDevice && virtualControlPatch ? (
        <div className="event-modal-backdrop" onClick={onCloseVirtualControlModal}>
          <div className="event-modal virtual-device-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('virtualDeviceControls')}</h2>
              <div className="virtual-modal-header-right">
                <span className="chip virtual-device-id-label mono">{virtualControlDeviceId}</span>
                <button
                  className="modal-close-button"
                  type="button"
                  onClick={onCloseVirtualControlModal}
                  aria-label={t('close')}
                  title={t('close')}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <p className="muted">
              {t('groupConfig')}: {selectedAdminVirtualDevice.groupKey}
            </p>
            {virtualMirrorModeActive ? <p className="muted">{t('virtualDeviceMirrorModeNote')}</p> : null}

            <div className="virtual-button-row">
              <button
                type="button"
                className={`button virtual-push-button virtual-red ${virtualControlPatch.buttonRedPressed ? 'active' : ''}`}
                onClick={() => onSetModalVirtualField('buttonRedPressed', !Boolean(virtualControlPatch.buttonRedPressed))}
              >
                {t('colorRed')}
              </button>
              <button
                type="button"
                className={`button virtual-push-button virtual-black ${virtualControlPatch.buttonBlackPressed ? 'active' : ''}`}
                onClick={() => onSetModalVirtualField('buttonBlackPressed', !Boolean(virtualControlPatch.buttonBlackPressed))}
              >
                {t('colorBlack')}
              </button>
              <button
                type="button"
                className="button virtual-counter-button"
                onClick={() => onSetModalVirtualField('counterValue', Math.max(0, Math.round(virtualCounter) + 1))}
              >
                {t('metricCounter')}: {Math.max(0, Math.round(virtualCounter))}
              </button>
            </div>

            <div className="virtual-controls-grid">
              <div className="virtual-led-controls">
                <button
                  type="button"
                  className={`virtual-led-toggle green ${virtualControlPatch.ledGreenOn ? 'lit' : ''}`}
                  onClick={() => onSetModalVirtualField('ledGreenOn', !Boolean(virtualControlPatch.ledGreenOn))}
                  aria-pressed={Boolean(virtualControlPatch.ledGreenOn)}
                >
                  <span className="virtual-led-lamp" aria-hidden="true" />
                  <span>{t('commandGreenLed')}</span>
                </button>
                <button
                  type="button"
                  className={`virtual-led-toggle orange ${virtualControlPatch.ledOrangeOn ? 'lit' : ''}`}
                  onClick={() => onSetModalVirtualField('ledOrangeOn', !Boolean(virtualControlPatch.ledOrangeOn))}
                  aria-pressed={Boolean(virtualControlPatch.ledOrangeOn)}
                >
                  <span className="virtual-led-lamp" aria-hidden="true" />
                  <span>{t('commandOrangeLed')}</span>
                </button>
              </div>
              <label className="virtual-slider-field">
                <span>
                  {t('metricTemp')} <strong>{virtualTemperature.toFixed(1)} °C</strong>
                </span>
                <input
                  className="virtual-slider"
                  type="range"
                  min={-10}
                  max={50}
                  step={0.1}
                  value={virtualTemperature}
                  onChange={(event) => onSetModalVirtualField('temperatureC', Number(event.target.value))}
                />
              </label>
              <label className="virtual-slider-field">
                <span>
                  {t('metricHumidity')} <strong>{virtualHumidity.toFixed(0)} %</strong>
                </span>
                <input
                  className="virtual-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={virtualHumidity}
                  onChange={(event) => onSetModalVirtualField('humidityPct', Number(event.target.value))}
                />
              </label>
              <label className="virtual-slider-field">
                <span>
                  {t('metricBrightness')} <strong>{virtualBrightness.toFixed(2)} V</strong>
                </span>
                <input
                  className="virtual-slider"
                  type="range"
                  min="0"
                  max="3.3"
                  step={0.01}
                  value={virtualBrightness}
                  onChange={(event) => onSetModalVirtualField('brightness', Number(event.target.value))}
                />
              </label>
            </div>
            <div className="event-modal-actions">
              <button className="button secondary" type="button" onClick={onCloseVirtualControlModal}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetEventsModalOpen ? (
        <div className="event-modal-backdrop" onClick={onCloseResetEventsModal}>
          <div className="event-modal counter-reset-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('resetStoredEventsConfirmTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={onCloseResetEventsModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <p>{t('resetStoredEventsConfirmBody')}</p>
            <div className="event-modal-actions">
              <button className="button danger" type="button" onClick={onResetStoredEvents} disabled={resetEventsBusy}>
                {t('resetStoredEvents')}
              </button>
              <button className="button secondary" type="button" onClick={onCloseResetEventsModal}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {counterResetTarget ? (
        <div className="event-modal-backdrop" onClick={onCloseCounterResetModal}>
          <div className="event-modal counter-reset-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>{t('counterResetDialogTitle')}</h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={onCloseCounterResetModal}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>
            <p>
              {t('counterResetDialogBody')} <strong>{counterResetTarget.deviceId}</strong>?
            </p>
            <div className="event-modal-actions">
              <button className="button danger" type="button" onClick={onConfirmCounterReset} disabled={counterResetBusy}>
                {t('commandCounterReset')}
              </button>
              <button className="button secondary" type="button" onClick={onCloseCounterResetModal}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pinEditorDeviceId ? (
        <div className="event-modal-backdrop" onClick={onClosePinEditor}>
          <div className="event-modal pin-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <h2>
                {t('pinSettingsForDevice')}: {pinEditorDeviceId}
              </h2>
              <button
                className="modal-close-button"
                type="button"
                onClick={onClosePinEditor}
                aria-label={t('close')}
                title={t('close')}
              >
                <CloseIcon />
              </button>
            </div>

            <label className="form-grid">
              <span>{t('pin')}</span>
              <input
                className="input mono"
                value={pinEditorValue}
                onChange={(event) => onPinEditorValueChange(event.target.value)}
                disabled={pinEditorLoading || pinEditorSaveBusy}
              />
            </label>

            {pinEditorLoading ? <p className="muted">{t('loading')}</p> : null}

            <div className="event-modal-actions">
              <button className="button" type="button" onClick={onSavePinEditor} disabled={pinEditorLoading || pinEditorSaveBusy}>
                {t('savePin')}
              </button>
              <button className="button secondary" type="button" onClick={onClosePinEditor}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
