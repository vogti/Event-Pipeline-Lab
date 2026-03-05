import { useEffect, useRef, useState } from 'react';
import type { I18nKey } from '../../i18n';
import {
  lockTopicToDevicePrefix,
  normalizeLegacyLedCommandTopic,
  normalizeMqttTemplateForTarget,
  supportedMqttTemplates,
  topicSuffixForLockedPrefix
} from '../../app/mqtt-composer';
import { CloseIcon } from '../../app/shared-icons';
import { ModalPortal } from '../layout/ModalPortal';
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
  targetTypeOptions?: MqttComposerTargetType[];
  titleKey?: I18nKey;
  submitLabelKey?: I18nKey;
  enableLedTab?: boolean;
  hidePayloadFields?: boolean;
  simpleMode?: boolean;
  topicPrefixLock?: string | null;
  enableLedBlinkControls?: boolean;
  showSinkPayloadControls?: boolean;
  initialTab?: 'guided' | 'raw' | 'led';
}

function templateLabelKey(template: MqttComposerTemplate): I18nKey {
  switch (template) {
    case 'button':
      return 'mqttTemplateButton';
    case 'counter':
      return 'mqttTemplateCounter';
    case 'led':
      return 'mqttTemplateLed';
    case 'temperature':
      return 'mqttTemplateTemperature';
    case 'humidity':
      return 'mqttTemplateHumidity';
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
  onDraftChange,
  targetTypeOptions,
  titleKey = 'sendMqttEvent',
  submitLabelKey = 'sendMqttEvent',
  enableLedTab = true,
  hidePayloadFields = false,
  simpleMode = false,
  topicPrefixLock = null,
  enableLedBlinkControls = false,
  showSinkPayloadControls = false,
  initialTab
}: AdminMqttEventModalProps) {
  const [activeTab, setActiveTab] = useState<'guided' | 'raw' | 'led'>(
    initialTab ?? (mode === 'raw' ? 'raw' : 'guided')
  );
  const wasOpenRef = useRef(open);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open || wasOpen) {
      return;
    }
    setActiveTab(initialTab ?? (mode === 'raw' ? 'raw' : 'guided'));
  }, [initialTab, mode, open]);

  useEffect(() => {
    if (activeTab !== 'led') {
      return;
    }
    const topic = draft.deviceId ? `${draft.deviceId}/command/led/${draft.ledColor}` : '';
    onDraftChange('rawTopic', topic);
    if (!hidePayloadFields) {
      const payload = draft.ledOn ? 'on' : 'off';
      onDraftChange('rawPayload', payload);
    }
  }, [activeTab, draft.deviceId, draft.ledColor, draft.ledOn, hidePayloadFields, onDraftChange]);

  useEffect(() => {
    const normalizedRawTopic = normalizeLegacyLedCommandTopic(draft.rawTopic);
    if (normalizedRawTopic !== draft.rawTopic) {
      onDraftChange('rawTopic', normalizedRawTopic);
    }
    const normalizedCustomTopic = normalizeLegacyLedCommandTopic(draft.customTopic);
    if (normalizedCustomTopic !== draft.customTopic) {
      onDraftChange('customTopic', normalizedCustomTopic);
    }
  }, [draft.customTopic, draft.rawTopic, onDraftChange]);

  const normalizedPrefixLock = (topicPrefixLock ?? '').trim().toLowerCase();
  const prefixLockActive = normalizedPrefixLock.length > 0;

  useEffect(() => {
    if (activeTab !== 'guided') {
      return;
    }
    if (draft.template !== 'custom') {
      return;
    }
    if (prefixLockActive) {
      return;
    }
    if (!draft.deviceId || draft.customTopic.trim().length > 0) {
      return;
    }
    onDraftChange('customTopic', `${draft.deviceId.trim().toLowerCase()}/`);
  }, [activeTab, draft.customTopic, draft.deviceId, draft.template, onDraftChange, prefixLockActive]);

  if (!open) {
    return null;
  }

  const defaultTargetTypes: MqttComposerTargetType[] = ['physical', 'virtual', 'custom'];
  const allowedTargetTypes = (targetTypeOptions?.length ? targetTypeOptions : defaultTargetTypes)
    .filter((entry, index, values) => values.indexOf(entry) === index);
  const normalizedTargetType = allowedTargetTypes.includes(draft.targetType)
    ? draft.targetType
    : (allowedTargetTypes[0] ?? 'physical');
  const supportedTemplates = supportedMqttTemplates(normalizedTargetType);
  const normalizedTemplate = normalizeMqttTemplateForTarget(normalizedTargetType, draft.template);
  const availableDeviceIds =
    normalizedTargetType === 'physical'
      ? physicalDeviceIds
      : normalizedTargetType === 'virtual'
        ? virtualDeviceIds
        : prefixLockActive
          ? physicalDeviceIds
          : [];
  const ledAvailableDeviceIds = physicalDeviceIds;
  const showDeviceSelect = normalizedTargetType !== 'custom' || prefixLockActive;
  const customTopicSuffix = prefixLockActive
    ? topicSuffixForLockedPrefix(normalizedPrefixLock, draft.customTopic)
    : draft.customTopic;
  const rawTopicSuffix = prefixLockActive
    ? topicSuffixForLockedPrefix(normalizedPrefixLock, draft.rawTopic)
    : draft.rawTopic;

  const handleCustomTopicChange = (value: string) => {
    if (prefixLockActive) {
      onDraftChange('customTopic', lockTopicToDevicePrefix(normalizedPrefixLock, value));
      return;
    }
    onDraftChange('customTopic', value);
  };

  const handleRawTopicChange = (value: string) => {
    if (prefixLockActive) {
      onDraftChange('rawTopic', lockTopicToDevicePrefix(normalizedPrefixLock, value));
      return;
    }
    onDraftChange('rawTopic', value);
  };

  return (
    <ModalPortal>
    <div className="event-modal-backdrop" onClick={onClose}>
      <div className="event-modal mqtt-compose-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{t(titleKey)}</h2>
          <button
            className="modal-close-button"
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="mqtt-compose-mode-row">
          <button
            className={`button tiny ${activeTab === 'guided' ? 'active' : 'secondary'}`}
            type="button"
            onClick={() => {
              setActiveTab('guided');
              onModeChange('guided');
            }}
          >
            {t('mqttModeGuided')}
          </button>
          <button
            className={`button tiny ${activeTab === 'raw' ? 'active' : 'secondary'}`}
            type="button"
            onClick={() => {
              setActiveTab('raw');
              onModeChange('raw');
            }}
          >
            {t('mqttModeRaw')}
          </button>
          {enableLedTab && allowedTargetTypes.includes('physical') ? (
            <button
              className={`button tiny ${activeTab === 'led' ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => {
                setActiveTab('led');
                onModeChange('raw');
                onTargetTypeChange('physical');
                onTemplateChange('led');
              }}
            >
              {t('mqttModeLed')}
            </button>
          ) : null}
        </div>

        {activeTab === 'led' ? (
          <div className="mqtt-compose-grid">
            <label>
              <span>{t('mqttDevice')}</span>
              <select
                className="input"
                value={draft.deviceId}
                onChange={(event) => onDeviceIdChange(event.target.value)}
                disabled={busy}
              >
                {ledAvailableDeviceIds.length === 0 ? <option value="">{t('stateUnknown')}</option> : null}
                {ledAvailableDeviceIds.map((deviceId) => (
                  <option key={deviceId} value={deviceId}>
                    {deviceId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('mqttLed')}</span>
              <select
                className="input"
                value={draft.ledColor}
                onChange={(event) => onDraftChange('ledColor', event.target.value as 'green' | 'orange')}
                disabled={busy}
              >
                <option value="green">{t('commandGreenLed')}</option>
                <option value="orange">{t('commandOrangeLed')}</option>
              </select>
            </label>
            {!hidePayloadFields ? (
              <label>
                <span>{t('mqttLedState')}</span>
                <select
                  className="input"
                  value={draft.ledOn ? 'on' : 'off'}
                  onChange={(event) => onDraftChange('ledOn', event.target.value === 'on')}
                  disabled={busy}
                >
                  <option value="on">{t('stateOn')}</option>
                  <option value="off">{t('stateOff')}</option>
                </select>
              </label>
            ) : null}
            <label>
              <span>{t('mqttQos')}</span>
              <select
                className="input"
                value={draft.qos}
                onChange={(event) => onDraftChange('qos', Number(event.target.value) as 0 | 1 | 2)}
                disabled={busy}
              >
                <option value={0}>{t('mqttQos0')}</option>
                <option value={1}>{t('mqttQos1')}</option>
                <option value={2}>{t('mqttQos2')}</option>
              </select>
            </label>
            <label>
              <span>{t('mqttTopicPreview')}</span>
              <input className="input mono mqtt-preview-input" value={draft.rawTopic} readOnly />
            </label>
            {!hidePayloadFields ? (
              <label>
                <span>{t('mqttPayloadPreview')}</span>
                <textarea className="input mqtt-compose-textarea mono mqtt-preview-input" value={draft.rawPayload} readOnly />
              </label>
            ) : null}
          </div>
        ) : (
          <div className="mqtt-compose-grid">
          <label>
            <span>{t('mqttTarget')}</span>
            <select
              className="input"
              value={normalizedTargetType}
              onChange={(event) => onTargetTypeChange(event.target.value as MqttComposerTargetType)}
              disabled={busy}
            >
              {allowedTargetTypes.includes('physical') ? (
                <option value="physical">{t('mqttTargetPhysical')}</option>
              ) : null}
              {allowedTargetTypes.includes('virtual') ? (
                <option value="virtual">{t('mqttTargetVirtual')}</option>
              ) : null}
              {allowedTargetTypes.includes('custom') ? (
                <option value="custom">{t('mqttTargetCustom')}</option>
              ) : null}
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
              <option value={0}>{t('mqttQos0')}</option>
              <option value={1}>{t('mqttQos1')}</option>
              <option value={2}>{t('mqttQos2')}</option>
            </select>
          </label>
          </div>
        )}

        {activeTab === 'guided' ? (
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

            {normalizedTemplate === 'led' ? (
              <div className="mqtt-compose-grid">
                <label>
                  <span>{t('mqttLed')}</span>
                  <select
                    className="input"
                    value={draft.ledColor}
                    onChange={(event) => onDraftChange('ledColor', event.target.value as 'green' | 'orange')}
                    disabled={busy}
                  >
                    <option value="green">{t('commandGreenLed')}</option>
                    <option value="orange">{t('commandOrangeLed')}</option>
                  </select>
                </label>
                {!hidePayloadFields ? (
                  <label>
                    <span>{t('mqttLedState')}</span>
                    <select
                      className="input"
                      value={draft.ledOn ? 'on' : 'off'}
                      onChange={(event) => onDraftChange('ledOn', event.target.value === 'on')}
                      disabled={busy}
                    >
                      <option value="on">{t('stateOn')}</option>
                      <option value="off">{t('stateOff')}</option>
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}

            {normalizedTemplate === 'temperature' ? (
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
            ) : null}

            {normalizedTemplate === 'humidity' ? (
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
                  <div className={`mqtt-topic-lock-row ${prefixLockActive ? 'locked' : ''}`}>
                    {prefixLockActive ? <span className="mqtt-topic-prefix mono">{normalizedPrefixLock}/</span> : null}
                    <input
                      className="input mono"
                      value={customTopicSuffix}
                      onChange={(event) => handleCustomTopicChange(event.target.value)}
                      disabled={busy}
                    />
                  </div>
                </label>
                {!hidePayloadFields ? (
                  <label>
                    <span>{t('mqttPayload')}</span>
                    <textarea
                      className="input mqtt-compose-textarea mono"
                      value={draft.customPayload}
                      onChange={(event) => onDraftChange('customPayload', event.target.value)}
                      disabled={busy}
                    />
                  </label>
                ) : null}
              </>
            ) : null}

            {normalizedTemplate !== 'custom' ? (
              <>
                <label>
                  <span>{t('mqttTopicPreview')}</span>
                  <input className="input mono mqtt-preview-input" value={guidedTopic} readOnly />
                </label>
                {!hidePayloadFields ? (
                  <>
                    <label>
                      <span>{t('mqttPayloadPreview')}</span>
                      <textarea className="input mqtt-compose-textarea mono mqtt-preview-input" value={guidedPayload} readOnly />
                    </label>
                    <p className="mqtt-preview-help muted">{t('mqttPreviewReadonly')}</p>
                  </>
                ) : (
                  <p className="mqtt-preview-help muted">{t('pipelineSinkPayloadFromInput')}</p>
                )}
              </>
            ) : null}
          </>
        ) : activeTab === 'raw' ? (
          <>
            <label>
              <span>{t('mqttTopic')}</span>
              <div className={`mqtt-topic-lock-row ${prefixLockActive ? 'locked' : ''}`}>
                {prefixLockActive ? <span className="mqtt-topic-prefix mono">{normalizedPrefixLock}/</span> : null}
                <input
                  className="input mono"
                  value={rawTopicSuffix}
                  onChange={(event) => handleRawTopicChange(event.target.value)}
                  disabled={busy}
                />
              </div>
            </label>
            {!hidePayloadFields ? (
              <label>
                <span>{t('mqttPayload')}</span>
                <textarea
                  className="input mqtt-compose-textarea mono"
                  value={draft.rawPayload}
                  onChange={(event) => onDraftChange('rawPayload', event.target.value)}
                  disabled={busy}
                />
              </label>
            ) : (
              <p className="mqtt-preview-help muted">{t('pipelineSinkPayloadFromInput')}</p>
            )}
          </>
        ) : null}

        {showSinkPayloadControls ? (
          <div className="mqtt-compose-section">
            <h3>{t('mqttSinkPayloadSourceTitle')}</h3>
            <div className="mqtt-radio-list">
              <label className="mqtt-radio-option">
                <input
                  type="radio"
                  name="sink-payload-source"
                  checked={draft.useIncomingPayload}
                  onChange={() => onDraftChange('useIncomingPayload', true)}
                  disabled={busy}
                />
                <div>
                  <strong>{t('mqttSinkPayloadIncomingLabel')}</strong>
                  <p className="muted">{t('mqttSinkPayloadIncomingHelp')}</p>
                </div>
              </label>
              <label className="mqtt-radio-option">
                <input
                  type="radio"
                  name="sink-payload-source"
                  checked={!draft.useIncomingPayload}
                  onChange={() => onDraftChange('useIncomingPayload', false)}
                  disabled={busy}
                />
                <div>
                  <strong>{t('mqttSinkPayloadCustomLabel')}</strong>
                  <p className="muted">{t('mqttSinkPayloadCustomHelp')}</p>
                </div>
              </label>
            </div>
            {!draft.useIncomingPayload ? (
              <label className="mqtt-sink-custom-payload-field">
                <span>{t('mqttPayload')}</span>
                <textarea
                  className="input mqtt-compose-textarea mono"
                  value={draft.rawPayload}
                  onChange={(event) => {
                    const next = event.target.value;
                    onDraftChange('rawPayload', next);
                    onDraftChange('customPayload', next);
                  }}
                  disabled={busy}
                />
              </label>
            ) : (
              <p className="mqtt-preview-help muted">{t('pipelineSinkPayloadFromInput')}</p>
            )}
          </div>
        ) : null}

        {enableLedBlinkControls ? (
          <div className="mqtt-compose-section">
            <h3>{t('mqttLedBlinkSectionTitle')}</h3>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={draft.ledBlinkEnabled}
                onChange={(event) => onDraftChange('ledBlinkEnabled', event.target.checked)}
                disabled={busy}
              />
              <span>{t('mqttLedBlink')}</span>
            </label>
            <label className="mqtt-led-blink-duration">
              <span>{t('mqttLedBlinkMs')}</span>
              <input
                className="input"
                type="number"
                min={50}
                max={10000}
                step={10}
                value={draft.ledBlinkMs}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  const next = Number.isFinite(parsed) ? parsed : draft.ledBlinkMs;
                  onDraftChange('ledBlinkMs', Math.max(50, Math.min(10000, next)));
                }}
                disabled={busy || !draft.ledBlinkEnabled}
              />
            </label>
          </div>
        ) : null}

        {!simpleMode ? (
          <div className="mqtt-retained-block">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={draft.retained}
                onChange={(event) => onDraftChange('retained', event.target.checked)}
                disabled={busy}
              />
              <span>{t('mqttRetained')}</span>
            </label>
            <p className="muted mqtt-retained-help">{t('mqttRetainedHelp')}</p>
          </div>
        ) : null}

        <div className="event-modal-actions">
          <button className="button" type="button" onClick={onSubmit} disabled={busy}>
            {t(submitLabelKey)}
          </button>
          <button className="button secondary" type="button" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
