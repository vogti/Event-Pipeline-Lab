import type { I18nKey } from '../../i18n';
import type { VirtualDevicePatch } from '../../app/shared-types';

interface StudentVirtualDeviceSectionProps {
  t: (key: I18nKey) => string;
  deviceId: string;
  patch: VirtualDevicePatch;
  busy: boolean;
  onSetField: <K extends keyof VirtualDevicePatch>(field: K, value: VirtualDevicePatch[K]) => void;
  onSave: () => void;
}

export function StudentVirtualDeviceSection({
  t,
  deviceId,
  patch,
  busy,
  onSetField,
  onSave
}: StudentVirtualDeviceSectionProps) {
  return (
    <section className="panel panel-animate">
      <h2>{t('virtualDevice')}</h2>
      <p className="muted">{deviceId}</p>
      <div className="virtual-controls-grid">
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={Boolean(patch.buttonRedPressed)}
            onChange={(event) => onSetField('buttonRedPressed', event.target.checked)}
          />
          <span>{t('colorRed')}</span>
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={Boolean(patch.buttonBlackPressed)}
            onChange={(event) => onSetField('buttonBlackPressed', event.target.checked)}
          />
          <span>{t('colorBlack')}</span>
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={Boolean(patch.ledGreenOn)}
            onChange={(event) => onSetField('ledGreenOn', event.target.checked)}
          />
          <span>{t('commandGreenLed')}</span>
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={Boolean(patch.ledOrangeOn)}
            onChange={(event) => onSetField('ledOrangeOn', event.target.checked)}
          />
          <span>{t('commandOrangeLed')}</span>
        </label>
        <label>
          <span>{t('metricTemp')}</span>
          <input
            className="input"
            type="number"
            step="0.1"
            value={patch.temperatureC ?? 0}
            onChange={(event) => {
              const next = Number.isFinite(event.target.valueAsNumber)
                ? event.target.valueAsNumber
                : (patch.temperatureC ?? 0);
              onSetField('temperatureC', next);
            }}
          />
        </label>
        <label>
          <span>{t('metricHumidity')}</span>
          <input
            className="input"
            type="number"
            step="0.1"
            value={patch.humidityPct ?? 0}
            onChange={(event) => {
              const next = Number.isFinite(event.target.valueAsNumber)
                ? event.target.valueAsNumber
                : (patch.humidityPct ?? 0);
              onSetField('humidityPct', next);
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
            value={patch.brightness ?? 0}
            onChange={(event) => {
              const raw = Number.isFinite(event.target.valueAsNumber)
                ? event.target.valueAsNumber
                : (patch.brightness ?? 0);
              const next = Math.min(3.3, Math.max(0, raw));
              onSetField('brightness', Number(next.toFixed(2)));
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
            value={patch.counterValue ?? 0}
            onChange={(event) => {
              const raw = Number.isFinite(event.target.valueAsNumber)
                ? event.target.valueAsNumber
                : (patch.counterValue ?? 0);
              onSetField('counterValue', Math.max(0, Math.round(raw)));
            }}
          />
        </label>
      </div>

      <button
        className="button"
        type="button"
        onClick={onSave}
        disabled={busy}
      >
        {t('applyVirtualState')}
      </button>
    </section>
  );
}
