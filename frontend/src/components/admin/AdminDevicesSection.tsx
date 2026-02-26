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
        <button
          className="panel-refresh-button"
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          <svg
            className={`panel-refresh-icon${busy ? ' spinning' : ''}`}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M20 12a8 8 0 1 1-2.34-5.66"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M20 4v6h-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className="devices-grid">
        {cards}
      </div>
    </section>
  );
}
