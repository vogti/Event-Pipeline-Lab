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
  onCloseVirtualControlModal: () => void;
  onSetModalVirtualField: (field: keyof VirtualDevicePatch, value: boolean | number) => void;
  onSaveAdminVirtualDevice: () => void;
  virtualControlBusy: boolean;
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
  onCloseVirtualControlModal,
  onSetModalVirtualField,
  onSaveAdminVirtualDevice,
  virtualControlBusy,
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
              <h2>
                {t('virtualDeviceControls')}: {virtualControlDeviceId}
              </h2>
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

            <p className="muted">
              {t('groupConfig')}: {selectedAdminVirtualDevice.groupKey}
            </p>

            <div className="virtual-controls-grid">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={Boolean(virtualControlPatch.buttonRedPressed)}
                  onChange={(event) => onSetModalVirtualField('buttonRedPressed', event.target.checked)}
                />
                <span>{t('colorRed')}</span>
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={Boolean(virtualControlPatch.buttonBlackPressed)}
                  onChange={(event) => onSetModalVirtualField('buttonBlackPressed', event.target.checked)}
                />
                <span>{t('colorBlack')}</span>
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={Boolean(virtualControlPatch.ledGreenOn)}
                  onChange={(event) => onSetModalVirtualField('ledGreenOn', event.target.checked)}
                />
                <span>{t('commandGreenLed')}</span>
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={Boolean(virtualControlPatch.ledOrangeOn)}
                  onChange={(event) => onSetModalVirtualField('ledOrangeOn', event.target.checked)}
                />
                <span>{t('commandOrangeLed')}</span>
              </label>
              <label>
                <span>{t('metricTemp')}</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={virtualControlPatch.temperatureC ?? 0}
                  onChange={(event) => {
                    const next = Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : (virtualControlPatch.temperatureC ?? 0);
                    onSetModalVirtualField('temperatureC', next);
                  }}
                />
              </label>
              <label>
                <span>{t('metricHumidity')}</span>
                <input
                  className="input"
                  type="number"
                  step="0.1"
                  value={virtualControlPatch.humidityPct ?? 0}
                  onChange={(event) => {
                    const next = Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : (virtualControlPatch.humidityPct ?? 0);
                    onSetModalVirtualField('humidityPct', next);
                  }}
                />
              </label>
              <label>
                <span>{t('metricBrightness')}</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="3.3"
                  value={virtualControlPatch.brightness ?? 0}
                  onChange={(event) => {
                    const raw = Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : (virtualControlPatch.brightness ?? 0);
                    const next = Math.min(3.3, Math.max(0, raw));
                    onSetModalVirtualField('brightness', Number(next.toFixed(2)));
                  }}
                />
              </label>
              <label>
                <span>{t('metricCounter')}</span>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  value={virtualControlPatch.counterValue ?? 0}
                  onChange={(event) => {
                    const raw = Number.isFinite(event.target.valueAsNumber)
                      ? event.target.valueAsNumber
                      : (virtualControlPatch.counterValue ?? 0);
                    onSetModalVirtualField('counterValue', Math.max(0, Math.round(raw)));
                  }}
                />
              </label>
            </div>

            <div className="event-modal-actions">
              <button className="button" type="button" onClick={onSaveAdminVirtualDevice} disabled={virtualControlBusy}>
                {t('applyVirtualState')}
              </button>
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
