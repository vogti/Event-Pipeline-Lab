import type { I18nKey } from '../../i18n';
import {
  buildPipelineScenarioOverlays,
  parsePipelineScenarioOverlays,
  PIPELINE_SCENARIO_DEFINITIONS,
  type PipelineScenarioKey,
  scenarioDefaultValue,
  withScenarioValue
} from '../../app/pipeline-scenarios';

function scenarioLabelKey(key: PipelineScenarioKey): I18nKey {
  switch (key) {
    case 'duplicates':
      return 'pipelineScenarioDuplicates';
    case 'delay':
      return 'pipelineScenarioDelay';
    case 'drops':
      return 'pipelineScenarioDrops';
    case 'out_of_order':
      return 'pipelineScenarioOutOfOrder';
    default:
      return 'pipelineScenarioDuplicates';
  }
}

function scenarioDescriptionKey(key: PipelineScenarioKey): I18nKey {
  switch (key) {
    case 'duplicates':
      return 'pipelineScenarioDuplicatesDesc';
    case 'delay':
      return 'pipelineScenarioDelayDesc';
    case 'drops':
      return 'pipelineScenarioDropsDesc';
    case 'out_of_order':
      return 'pipelineScenarioOutOfOrderDesc';
    default:
      return 'pipelineScenarioDuplicatesDesc';
  }
}

interface PipelineScenarioEditorProps {
  t: (key: I18nKey) => string;
  overlays: string[];
  disabled: boolean;
  onChange: (nextOverlays: string[]) => void;
}

export function PipelineScenarioEditor({
  t,
  overlays,
  disabled,
  onChange
}: PipelineScenarioEditorProps) {
  const scenarioValues = parsePipelineScenarioOverlays(overlays);

  return (
    <div className="pipeline-scenario-editor">
      {PIPELINE_SCENARIO_DEFINITIONS.map((definition) => {
        const activeValue = scenarioValues[definition.key];
        const enabled = typeof activeValue === 'number' && activeValue > 0;
        const value = activeValue ?? scenarioDefaultValue(definition.key);
        return (
          <div className="pipeline-scenario-row" key={definition.key}>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={enabled}
                disabled={disabled}
                onChange={(event) => {
                  const nextValues = withScenarioValue(
                    scenarioValues,
                    definition.key,
                    event.target.checked ? value : null
                  );
                  onChange(buildPipelineScenarioOverlays(nextValues));
                }}
              />
              <span>{t(scenarioLabelKey(definition.key))}</span>
            </label>
            <p className="muted pipeline-scenario-description">{t(scenarioDescriptionKey(definition.key))}</p>
            <div className="pipeline-scenario-controls">
              <input
                className="input"
                type="range"
                min={definition.min}
                max={definition.max}
                step={definition.step}
                value={value}
                disabled={disabled || !enabled}
                onChange={(event) => {
                  const nextRaw = Number.parseInt(event.target.value, 10);
                  const nextValue = Number.isFinite(nextRaw) ? nextRaw : value;
                  const nextValues = withScenarioValue(
                    scenarioValues,
                    definition.key,
                    enabled ? nextValue : null
                  );
                  onChange(buildPipelineScenarioOverlays(nextValues));
                }}
              />
              <input
                className="input pipeline-scenario-number"
                type="number"
                min={definition.min}
                max={definition.max}
                step={definition.step}
                value={value}
                disabled={disabled || !enabled}
                onChange={(event) => {
                  const nextRaw = Number.parseInt(event.target.value, 10);
                  const nextValue = Number.isFinite(nextRaw) ? nextRaw : value;
                  const nextValues = withScenarioValue(
                    scenarioValues,
                    definition.key,
                    enabled ? nextValue : null
                  );
                  onChange(buildPipelineScenarioOverlays(nextValues));
                }}
              />
              <span className="muted">{definition.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
