import type { I18nKey } from '../../i18n';
import type { PipelineCompareRow, TimestampValue } from '../../types';

interface PipelineCompareSectionProps {
  t: (key: I18nKey) => string;
  rows: PipelineCompareRow[];
  formatTs: (value: TimestampValue) => string;
}

export function PipelineCompareSection({ t, rows, formatTs }: PipelineCompareSectionProps) {
  return (
    <section className="panel panel-animate">
      <header className="panel-header">
        <h3>{t('pipelineCompare')}</h3>
      </header>
      {rows.length === 0 ? (
        <p className="muted">{t('pipelineNoGroups')}</p>
      ) : (
        <div className="table-wrap">
          <table className="event-table">
            <thead>
              <tr>
                <th>{t('pipelineGroup')}</th>
                <th>{t('revision')}</th>
                <th>{t('updatedBy')}</th>
                <th>{t('updatedAt')}</th>
                <th>{t('pipelineProcessing')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.taskId}:${row.groupKey}`}>
                  <td>{row.groupKey}</td>
                  <td>{row.revision}</td>
                  <td>{row.updatedBy}</td>
                  <td>{formatTs(row.updatedAt)}</td>
                  <td className="mono">{row.slotBlocks.join(' -> ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
