import { useEffect } from 'react';
import type { I18nKey } from '../../i18n';

export interface ToastMessage {
  id: number;
  text: string;
}

interface ToastStackProps {
  t: (key: I18nKey) => string;
  toasts: ToastMessage[];
  onDismiss: (toastId: number) => void;
}

interface ToastItemProps {
  toast: ToastMessage;
  t: (key: I18nKey) => string;
  onDismiss: (toastId: number) => void;
}

function ToastItem({ toast, t, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(toast.id);
    }, 3800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [onDismiss, toast.id]);

  return (
    <div className="toast toast-info" role="status" aria-live="polite">
      <span>{toast.text}</span>
      <button
        className="toast-dismiss"
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('close')}
        title={t('close')}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function ToastStack({ t, toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} t={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
