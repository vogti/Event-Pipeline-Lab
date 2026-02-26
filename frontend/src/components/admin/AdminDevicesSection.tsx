import type { ReactNode } from 'react';

interface AdminDevicesSectionProps {
  title: string;
  refreshLabel: string;
  busy: boolean;
  onRefresh: () => void;
  cards: ReactNode;
}

export function AdminDevicesSection({
  title,
  refreshLabel,
  busy,
  onRefresh,
  cards
}: AdminDevicesSectionProps) {
  return (
    <section className="panel panel-animate full-width">
      <div className="panel-header">
        <h2>{title}</h2>
        <button className="button secondary" type="button" onClick={onRefresh} disabled={busy}>
          {refreshLabel}
        </button>
      </div>

      <div className="devices-grid">
        {cards}
      </div>
    </section>
  );
}
