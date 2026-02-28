import type { I18nKey } from '../../i18n';
import type { VirtualDevicePatch } from '../../app/shared-types';

interface StudentVirtualDeviceSectionProps {
  t: (key: I18nKey) => string;
  deviceId: string;
  patch: VirtualDevicePatch;
  mirrorModeActive: boolean;
  onSetField: <K extends keyof VirtualDevicePatch>(field: K, value: VirtualDevicePatch[K]) => void;
}

export function StudentVirtualDeviceSection({
  t,
  deviceId,
  patch,
  mirrorModeActive,
  onSetField
}: StudentVirtualDeviceSectionProps) {
  const temperature = Number.isFinite(patch.temperatureC) ? patch.temperatureC ?? 0 : 0;
  const humidity = Number.isFinite(patch.humidityPct) ? patch.humidityPct ?? 0 : 0;
  const brightness = Number.isFinite(patch.brightness) ? patch.brightness ?? 0 : 0;
  const counter = Number.isFinite(patch.counterValue) ? patch.counterValue ?? 0 : 0;

  return (
    <section className="panel panel-animate">
      <div className="panel-header virtual-device-panel-header">
        <h2>{t('virtualDevice')}</h2>
        <span className="chip virtual-device-id-label mono">{deviceId}</span>
      </div>

      {mirrorModeActive ? <p className="muted">{t('virtualDeviceMirrorModeNote')}</p> : null}

      <div className="virtual-button-row">
        <button
          type="button"
          className={`button virtual-push-button virtual-red ${patch.buttonRedPressed ? 'active' : ''}`}
          onClick={() => onSetField('buttonRedPressed', !Boolean(patch.buttonRedPressed))}
        >
          {t('colorRed')}
        </button>
        <button
          type="button"
          className={`button virtual-push-button virtual-black ${patch.buttonBlackPressed ? 'active' : ''}`}
          onClick={() => onSetField('buttonBlackPressed', !Boolean(patch.buttonBlackPressed))}
        >
          {t('colorBlack')}
        </button>
        <button
          type="button"
          className="button virtual-counter-button"
          onClick={() => onSetField('counterValue', Math.max(0, Math.round(counter) + 1))}
        >
          {t('metricCounter')}: {Math.max(0, Math.round(counter))}
        </button>
      </div>

      <div className="virtual-controls-grid">
        <div className="virtual-led-controls">
          <button
            type="button"
            className={`virtual-led-toggle green ${patch.ledGreenOn ? 'lit' : ''}`}
            onClick={() => onSetField('ledGreenOn', !Boolean(patch.ledGreenOn))}
            aria-pressed={Boolean(patch.ledGreenOn)}
          >
            <span className="virtual-led-lamp" aria-hidden="true" />
            <span>{t('commandGreenLed')}</span>
          </button>
          <button
            type="button"
            className={`virtual-led-toggle orange ${patch.ledOrangeOn ? 'lit' : ''}`}
            onClick={() => onSetField('ledOrangeOn', !Boolean(patch.ledOrangeOn))}
            aria-pressed={Boolean(patch.ledOrangeOn)}
          >
            <span className="virtual-led-lamp" aria-hidden="true" />
            <span>{t('commandOrangeLed')}</span>
          </button>
        </div>

        <label className="virtual-slider-field">
          <span>
            {t('metricTemp')} <strong>{temperature.toFixed(1)} °C</strong>
          </span>
          <input
            className="virtual-slider"
            type="range"
            min={-10}
            max={50}
            step={0.1}
            value={temperature}
            onChange={(event) => onSetField('temperatureC', Number(event.target.value))}
          />
        </label>

        <label className="virtual-slider-field">
          <span>
            {t('metricHumidity')} <strong>{humidity.toFixed(0)} %</strong>
          </span>
          <input
            className="virtual-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={humidity}
            onChange={(event) => onSetField('humidityPct', Number(event.target.value))}
          />
        </label>

        <label className="virtual-slider-field">
          <span>
            {t('metricBrightness')} <strong>{brightness.toFixed(2)} V</strong>
          </span>
          <input
            className="virtual-slider"
            type="range"
            min="0"
            max="3.3"
            step={0.01}
            value={brightness}
            onChange={(event) => onSetField('brightness', Number(event.target.value))}
          />
        </label>
      </div>

    </section>
  );
}
