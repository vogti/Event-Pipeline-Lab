import type { I18nKey } from '../../i18n';
import {
  normalizeMqttTemplateForTarget,
  supportedMqttTemplates
} from '../../app/mqtt-composer';
import type {
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft
} from '../../app/shared-types';

interface AdminMqttEventModalProps {
  t: (key: I18nKey) => string;
  open: boolean;
  busy: boolean;
  mode: MqttComposerMode;
  draft: MqttEventDraft;
  physicalDeviceIds: string[];
  virtualDeviceIds: string[];
  guidedTopic: string;
  guidedPayload: string;
  onClose: () => void;
  onSubmit: () => void;
  onModeChange: (mode: MqttComposerMode) => void;
  onTargetTypeChange: (targetType: MqttComposerTargetType) => void;
  onTemplateChange: (template: MqttComposerTemplate) => void;
  onDeviceIdChange: (deviceId: string) => void;
  onDraftChange: <K extends keyof MqttEventDraft>(key: K, value: MqttEventDraft[K]) => void;
}

function templateLabelKey(template: MqttComposerTemplate): I18nKey {
  switch (template) {
    case 'button':
      return 'mqttTemplateButton';
    case 'counter':
      return 'mqttTemplateCounter';
    case 'dht22':
      return 'mqttTemplateDht22';
    case 'ldr':
      return 'mqttTemplateLdr';
    case 'heartbeat':
      return 'mqttTemplateHeartbeat';
    case 'wifi':
      return 'mqttTemplateWifi';
    case 'custom':
      return 'mqttTemplateCustom';
    default:
      return 'mqttTemplateCustom';
  }
}

export function AdminMqttEventModal({
  t,
  open,
  busy,
  mode,
  draft,
  physicalDeviceIds,
  virtualDeviceIds,
  guidedTopic,
  guidedPayload,
  onClose,
  onSubmit,
  onModeChange,
  onTargetTypeChange,
  onTemplateChange,
  onDeviceIdChange,
  onDraftChange
}: AdminMqttEventModalProps) {
  if (!open) {
    return null;
  }

  const supportedTemplates = supportedMqttTemplates(draft.targetType);
  const normalizedTemplate = normalizeMqttTemplateForTarget(draft.targetType, draft.template);
  const availableDeviceIds =
    draft.targetType === 'physical'
      ? physicalDeviceIds
      : draft.targetType === 'virtual'
        ? virtualDeviceIds
        : [];
  const showDeviceSelect = draft.targetType !== 'custom';

  return (
    <div className="event-modal-backdrop" onClick={onClose}>
      <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{t('sendMqttEvent')}</h2>
          <button className="button secondary" type="button" onClick={onClose}>
            {t('close')}
          </button>
        </div>

        <p className="muted">{t('mqttComposerHint')}</p>

        <div className="mqtt-compose-mode-row">
          <button
            className={`button tiny ${mode === 'guided' ? 'active' : 'secondary'}`}
            type="button"
            onClick={() => onModeChange('guided')}
          >
            {t('mqttModeGuided')}
          </button>
          <button
            className={`button tiny ${mode === 'raw' ? 'active' : 'secondary'}`}
            type="button"
            onClick={() => onModeChange('raw')}
          >
            {t('mqttModeRaw')}
          </button>
        </div>

        <div className="mqtt-compose-grid">
          <label>
            <span>{t('mqttTarget')}</span>
            <select
              className="input"
              value={draft.targetType}
              onChange={(event) => onTargetTypeChange(event.target.value as MqttComposerTargetType)}
              disabled={busy}
            >
              <option value="physical">{t('mqttTargetPhysical')}</option>
              <option value="virtual">{t('mqttTargetVirtual')}</option>
              <option value="custom">{t('mqttTargetCustom')}</option>
            </select>
          </label>

          {showDeviceSelect ? (
            <label>
              <span>{t('mqttDevice')}</span>
              <select
                className="input"
                value={draft.deviceId}
                onChange={(event) => onDeviceIdChange(event.target.value)}
                disabled={busy}
              >
                {availableDeviceIds.length === 0 ? <option value="">{t('stateUnknown')}</option> : null}
                {availableDeviceIds.map((deviceId) => (
                  <option key={deviceId} value={deviceId}>
                    {deviceId}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            <span>{t('mqttTemplate')}</span>
            <select
              className="input"
              value={normalizedTemplate}
              onChange={(event) => onTemplateChange(event.target.value as MqttComposerTemplate)}
              disabled={busy}
            >
              {supportedTemplates.map((template) => (
                <option key={template} value={template}>
                  {t(templateLabelKey(template))}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{t('mqttQos')}</span>
            <select
              className="input"
              value={draft.qos}
              onChange={(event) => onDraftChange('qos', Number(event.target.value) as 0 | 1 | 2)}
              disabled={busy}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
        </div>

        {mode === 'guided' ? (
          <>
            {normalizedTemplate === 'button' ? (
              <div className="mqtt-compose-grid">
                <label>
                  <span>{t('mqttButton')}</span>
                  <select
                    className="input"
                    value={draft.buttonColor}
                    onChange={(event) => onDraftChange('buttonColor', event.target.value as 'red' | 'black')}
                    disabled={busy}
                  >
                    <option value="red">{t('colorRed')}</option>
                    <option value="black">{t('colorBlack')}</option>
                  </select>
                </label>
                <label>
                  <span>{t('mqttButtonState')}</span>
                  <select
                    className="input"
                    value={draft.buttonPressed ? 'pressed' : 'released'}
                    onChange={(event) => onDraftChange('buttonPressed', event.target.value === 'pressed')}
                    disabled={busy}
                  >
                    <option value="pressed">{t('statePressed')}</option>
                    <option value="released">{t('stateReleased')}</option>
                  </select>
                </label>
              </div>
            ) : null}

            {normalizedTemplate === 'counter' ? (
              <label>
                <span>{t('mqttCounterValue')}</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={draft.counterValue}
                  onChange={(event) =>
                    onDraftChange('counterValue', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 0)
                  }
                  disabled={busy}
                />
              </label>
            ) : null}

            {normalizedTemplate === 'dht22' ? (
              <div className="mqtt-compose-grid">
                <label>
                  <span>{t('mqttTemperature')}</span>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={draft.temperatureC}
                    onChange={(event) =>
                      onDraftChange('temperatureC', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : draft.temperatureC)
                    }
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>{t('mqttHumidity')}</span>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={draft.humidityPct}
                    onChange={(event) =>
                      onDraftChange('humidityPct', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : draft.humidityPct)
                    }
                    disabled={busy}
                  />
                </label>
              </div>
            ) : null}

            {normalizedTemplate === 'ldr' ? (
              <label>
                <span>{t('mqttBrightnessVoltage')}</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  max="3.3"
                  value={draft.brightnessV}
                  onChange={(event) =>
                    onDraftChange('brightnessV', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : draft.brightnessV)
                  }
                  disabled={busy}
                />
              </label>
            ) : null}

            {normalizedTemplate === 'heartbeat' ? (
              <label>
                <span>{t('mqttUptimeSeconds')}</span>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  value={draft.uptimeSec}
                  onChange={(event) =>
                    onDraftChange('uptimeSec', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : draft.uptimeSec)
                  }
                  disabled={busy}
                />
              </label>
            ) : null}

            {normalizedTemplate === 'wifi' ? (
              <label>
                <span>{t('mqttRssi')}</span>
                <input
                  className="input"
                  type="number"
                  step="1"
                  value={draft.rssi}
                  onChange={(event) =>
                    onDraftChange('rssi', Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : draft.rssi)
                  }
                  disabled={busy}
                />
              </label>
            ) : null}

            {normalizedTemplate === 'custom' ? (
              <>
                <label>
                  <span>{t('mqttTopic')}</span>
                  <input
                    className="input mono"
                    value={draft.customTopic}
                    onChange={(event) => onDraftChange('customTopic', event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>{t('mqttPayload')}</span>
                  <textarea
                    className="input mqtt-compose-textarea mono"
                    value={draft.customPayload}
                    onChange={(event) => onDraftChange('customPayload', event.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            ) : null}

            <label>
              <span>{t('mqttTopicPreview')}</span>
              <input className="input mono" value={guidedTopic} readOnly />
            </label>
            <label>
              <span>{t('mqttPayloadPreview')}</span>
              <textarea className="input mqtt-compose-textarea mono" value={guidedPayload} readOnly />
            </label>
          </>
        ) : (
          <>
            <label>
              <span>{t('mqttTopic')}</span>
              <input
                className="input mono"
                value={draft.rawTopic}
                onChange={(event) => onDraftChange('rawTopic', event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              <span>{t('mqttPayload')}</span>
              <textarea
                className="input mqtt-compose-textarea mono"
                value={draft.rawPayload}
                onChange={(event) => onDraftChange('rawPayload', event.target.value)}
                disabled={busy}
              />
            </label>
          </>
        )}

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={draft.retained}
            onChange={(event) => onDraftChange('retained', event.target.checked)}
            disabled={busy}
          />
          <span>{t('mqttRetained')}</span>
        </label>

        <div className="event-modal-actions">
          <button className="button" type="button" onClick={onSubmit} disabled={busy}>
            {t('sendMqttEvent')}
          </button>
          <button className="button secondary" type="button" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
