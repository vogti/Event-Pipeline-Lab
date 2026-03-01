import { useMemo, useState } from 'react';
import type { I18nKey } from '../../i18n';
import { displayPipelineBlockType } from '../../app/pipeline-block-labels';
import type {
  PipelineBlockObservability,
  PipelineObservability,
  PipelineSampleEvent,
  TimestampValue
} from '../../types';

type SampleViewMode = 'rendered' | 'raw';

interface PipelineObservabilitySectionProps {
  t: (key: I18nKey) => string;
  observability: PipelineObservability | null | undefined;
  formatTs: (value: TimestampValue) => string;
  canResetState: boolean;
  canRestartState: boolean;
  controlsBusy: boolean;
  onResetState?: () => void;
  onRestartStateLost?: () => void;
  onRestartStateRetained?: () => void;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function diffTopLevelKeys(inputValue: unknown, outputValue: unknown): {
  added: string[];
  removed: string[];
  changed: string[];
} {
  const input =
    inputValue && typeof inputValue === 'object' && !Array.isArray(inputValue)
      ? (inputValue as Record<string, unknown>)
      : {};
  const output =
    outputValue && typeof outputValue === 'object' && !Array.isArray(outputValue)
      ? (outputValue as Record<string, unknown>)
      : {};

  const inputKeys = new Set(Object.keys(input));
  const outputKeys = new Set(Object.keys(output));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of outputKeys) {
    if (!inputKeys.has(key)) {
      added.push(key);
      continue;
    }
    if (JSON.stringify(input[key]) !== JSON.stringify(output[key])) {
      changed.push(key);
    }
  }
  for (const key of inputKeys) {
    if (!outputKeys.has(key)) {
      removed.push(key);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort()
  };
}

function selectBlockSample(
  selectedBySlot: Record<number, string>,
  block: PipelineBlockObservability
): PipelineSampleEvent | null {
  if (block.samples.length === 0) {
    return null;
  }
  const selectedTrace = selectedBySlot[block.slotIndex];
  if (selectedTrace) {
    const matched = block.samples.find((sample) => sample.traceId === selectedTrace);
    if (matched) {
      return matched;
    }
  }
  return block.samples[block.samples.length - 1] ?? null;
}

export function PipelineObservabilitySection({
  t,
  observability,
  formatTs,
  canResetState,
  canRestartState,
  controlsBusy,
  onResetState,
  onRestartStateLost,
  onRestartStateRetained
}: PipelineObservabilitySectionProps) {
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<SampleViewMode>('rendered');
  const [selectedTraceBySlot, setSelectedTraceBySlot] = useState<Record<number, string>>({});

  const sortedBlocks = useMemo(() => {
    if (!observability) {
      return [];
    }
    return [...observability.blocks].sort((left, right) => left.slotIndex - right.slotIndex);
  }, [observability]);

  if (!observability || sortedBlocks.length === 0) {
    return (
      <section className="pipeline-observability">
        <header className="pipeline-observability-header">
          <h4>{t('pipelineObservability')}</h4>
        </header>
        <p className="muted">{t('pipelineNoSamples')}</p>
      </section>
    );
  }

  const expandedBlock =
    expandedSlot === null ? null : sortedBlocks.find((block) => block.slotIndex === expandedSlot) ?? null;
  const selectedSample = expandedBlock ? selectBlockSample(selectedTraceBySlot, expandedBlock) : null;
  const parsedInput = selectedSample ? parseJson(selectedSample.inputPayloadJson) : null;
  const parsedOutput = selectedSample ? parseJson(selectedSample.outputPayloadJson) : null;
  const diff = selectedSample ? diffTopLevelKeys(parsedInput, parsedOutput) : null;

  return (
    <section className="pipeline-observability">
      <header className="pipeline-observability-header">
        <h4>{t('pipelineObservability')}</h4>
        <p className="muted">
          {t('pipelineObservedEvents')}: {observability.observedEvents} | {t('pipelineSampling')} 1/
          {observability.sampleEvery} | {t('pipelineStateMode')}: {observability.statePersistenceMode}
          {' | '}
          {t('pipelineRestartCount')}: {observability.restartCount}
          {observability.lastRestartAt ? ` | ${formatTs(observability.lastRestartAt)}` : ''}
          {observability.lastRestartMode ? ` (${observability.lastRestartMode})` : ''}
        </p>
      </header>

      {canResetState || canRestartState ? (
        <div className="pipeline-state-controls">
          {canResetState ? (
            <button
              type="button"
              className="button tiny secondary"
              onClick={onResetState}
              disabled={controlsBusy}
            >
              {t('pipelineStateReset')}
            </button>
          ) : null}
          {canRestartState ? (
            <>
              <button
                type="button"
                className="button tiny secondary"
                onClick={onRestartStateLost}
                disabled={controlsBusy}
              >
                {t('pipelineRestartLost')}
              </button>
              <button
                type="button"
                className="button tiny secondary"
                onClick={onRestartStateRetained}
                disabled={controlsBusy}
              >
                {t('pipelineRestartRetained')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="event-table">
          <thead>
            <tr>
              <th>{t('pipelineSlot')}</th>
              <th>{t('pipelineBlock')}</th>
              <th>{t('pipelineMetricIn')}</th>
              <th>{t('pipelineMetricOut')}</th>
              <th>{t('pipelineMetricDrop')}</th>
              <th>{t('pipelineMetricErrors')}</th>
              <th>{t('pipelineStateType')}</th>
              <th>{t('pipelineStateEntries')}</th>
              <th>{t('pipelineStateTtl')}</th>
              <th>{t('pipelineStateMemory')}</th>
              <th>{t('pipelineMetricLatencyP50')}</th>
              <th>{t('pipelineMetricLatencyP95')}</th>
              <th>{t('pipelineMetricBacklog')}</th>
              <th>{t('pipelineSamples')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedBlocks.map((block) => {
              const expanded = expandedSlot === block.slotIndex;
              return (
                <tr key={`${block.slotIndex}:${block.blockType}`}>
                  <td>{block.slotIndex + 1}</td>
                  <td className="mono">{displayPipelineBlockType(block.blockType)}</td>
                  <td>{block.inCount}</td>
                  <td>{block.outCount}</td>
                  <td>{block.dropCount}</td>
                  <td>{block.errorCount}</td>
                  <td className="mono">{block.stateType}</td>
                  <td>{block.stateEntryCount}</td>
                  <td>{block.stateTtlSeconds ?? '-'}</td>
                  <td>{block.stateMemoryBytes}</td>
                  <td>{block.latencyP50Ms.toFixed(3)} ms</td>
                  <td>{block.latencyP95Ms.toFixed(3)} ms</td>
                  <td>{block.backlogDepth}</td>
                  <td>
                    <button
                      type="button"
                      className="button tiny secondary"
                      onClick={() => setExpandedSlot(expanded ? null : block.slotIndex)}
                    >
                      {expanded ? t('hide') : `${t('pipelineInspect')} (${block.samples.length})`}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expandedBlock ? (
        <div className="pipeline-sample-panel">
          <header className="pipeline-sample-header">
            <h5>
              {t('pipelineInspect')} - {t('pipelineSlot')} {expandedBlock.slotIndex + 1} (
              {displayPipelineBlockType(expandedBlock.blockType)})
            </h5>
            <div className="pipeline-sample-actions">
              <select
                className="input"
                value={selectedSample?.traceId ?? ''}
                onChange={(event) =>
                  setSelectedTraceBySlot((previous) => ({
                    ...previous,
                    [expandedBlock.slotIndex]: event.target.value
                  }))
                }
              >
                {expandedBlock.samples.length === 0 ? (
                  <option value="">{t('pipelineNoSamples')}</option>
                ) : null}
                {expandedBlock.samples.map((sample) => (
                  <option key={sample.traceId} value={sample.traceId}>
                    {sample.traceId.slice(0, 8)} - {formatTs(sample.ingestTs)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button tiny secondary"
                onClick={() => setViewMode((previous) => (previous === 'rendered' ? 'raw' : 'rendered'))}
              >
                {viewMode === 'rendered' ? t('switchToRawEvent') : t('switchToRenderedEvent')}
              </button>
            </div>
          </header>

          {selectedSample ? (
            <>
              <p className="muted">
                Trace: <span className="mono">{selectedSample.traceId}</span> | {t('eventFieldIngestTs')}:{' '}
                {formatTs(selectedSample.ingestTs)} | {t('device')}: {selectedSample.deviceId} | {t('feedHeaderTopic')}:{' '}
                <span className="mono">{selectedSample.topic}</span>
                {selectedSample.dropped ? ` | ${t('pipelineDropped')}: ${selectedSample.dropReason ?? '-'}` : ''}
              </p>

              {viewMode === 'raw' ? (
                <div className="pipeline-sample-grid">
                  <div>
                    <h6>{t('pipelineInput')}</h6>
                    <pre className="json-box">{selectedSample.inputPayloadJson}</pre>
                  </div>
                  <div>
                    <h6>{t('pipelineOutput')}</h6>
                    <pre className="json-box">{selectedSample.outputPayloadJson ?? ''}</pre>
                  </div>
                </div>
              ) : (
                <>
                  <div className="pipeline-sample-grid">
                    <div>
                      <h6>{t('pipelineInput')}</h6>
                      <pre className="json-box">{prettyJson(parsedInput)}</pre>
                    </div>
                    <div>
                      <h6>{t('pipelineOutput')}</h6>
                      <pre className="json-box">{prettyJson(parsedOutput)}</pre>
                    </div>
                  </div>
                  {diff ? (
                    <div className="pipeline-diff-grid">
                      <span className="chip ok">{t('pipelineDiffAdded')}: {diff.added.join(', ') || '-'}</span>
                      <span className="chip warn">{t('pipelineDiffChanged')}: {diff.changed.join(', ') || '-'}</span>
                      <span className="chip">{t('pipelineDiffRemoved')}: {diff.removed.join(', ') || '-'}</span>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p className="muted">{t('pipelineNoSamples')}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
