import type { MetricIconKind } from './shared-types';

export function MetricIcon({ kind }: { kind: MetricIconKind }) {
  if (kind === 'temperature') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M10 4a2 2 0 1 1 4 0v8.4a4.6 4.6 0 1 1-4 0V4Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="12" y1="10" x2="12" y2="16.2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === 'humidity') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M12 3.6C9.6 6.6 6.5 9.9 6.5 13.5a5.5 5.5 0 0 0 11 0c0-3.6-3.1-6.9-5.5-9.9Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === 'brightness') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <line x1="12" y1="3.5" x2="12" y2="6" stroke="currentColor" strokeWidth="1.8" />
        <line x1="12" y1="18" x2="12" y2="20.5" stroke="currentColor" strokeWidth="1.8" />
        <line x1="3.5" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="1.8" />
        <line x1="18" y1="12" x2="20.5" y2="12" stroke="currentColor" strokeWidth="1.8" />
        <line x1="6.3" y1="6.3" x2="8" y2="8" stroke="currentColor" strokeWidth="1.8" />
        <line x1="16" y1="16" x2="17.7" y2="17.7" stroke="currentColor" strokeWidth="1.8" />
        <line x1="6.3" y1="17.7" x2="8" y2="16" stroke="currentColor" strokeWidth="1.8" />
        <line x1="16" y1="8" x2="17.7" y2="6.3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === 'buttons') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="8" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="16" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === 'counter') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4.2" y="6.5" width="15.6" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <line x1="8.4" y1="10" x2="15.6" y2="10" stroke="currentColor" strokeWidth="1.8" />
        <line x1="8.4" y1="14" x2="15.6" y2="14" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4.4" y="8.2" width="6.3" height="7.6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13.3" y="8.2" width="6.3" height="7.6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M10.3 3.5h3.4l.5 2.1 1.9.8 1.9-1.1 2.4 2.4-1.1 1.9.8 1.9 2.1.5v3.4l-2.1.5-.8 1.9 1.1 1.9-2.4 2.4-1.9-1.1-1.9.8-.5 2.1h-3.4l-.5-2.1-1.9-.8-1.9 1.1-2.4-2.4 1.1-1.9-.8-1.9-2.1-.5v-3.4l2.1-.5.8-1.9-1.1-1.9 2.4-2.4 1.9 1.1 1.9-.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M6 6l12 12M18 6L6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}
