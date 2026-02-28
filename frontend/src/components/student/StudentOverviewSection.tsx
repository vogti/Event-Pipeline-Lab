import type { I18nKey } from '../../i18n';

interface StudentOverviewSectionProps {
  t: (key: I18nKey) => string;
  taskTitle: string;
  taskDescription: string;
}

export function StudentOverviewSection({
  t,
  taskTitle,
  taskDescription
}: StudentOverviewSectionProps) {
  return (
    <section className="panel hero panel-animate">
      <h2>{t('currentTask')}</h2>
      <h3>{taskTitle}</h3>
      <p>{taskDescription}</p>
    </section>
  );
}
