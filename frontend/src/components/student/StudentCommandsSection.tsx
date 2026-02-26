import type { I18nKey } from '../../i18n';
import type { DeviceCommandType } from '../../types';

interface StudentCommandsSectionProps {
  t: (key: I18nKey) => string;
  studentCommandWhitelist: string[];
  busyKey: string | null;
  onSendCommand: (command: DeviceCommandType, on?: boolean) => void;
}

export function StudentCommandsSection({
  t,
  studentCommandWhitelist,
  busyKey,
  onSendCommand
}: StudentCommandsSectionProps) {
  return (
    <section className="panel panel-animate">
      <h2>{t('commands')}</h2>
      <p className="muted">{t('ownDeviceOnly')}</p>
      <div className="button-grid">
        {studentCommandWhitelist.includes('LED_GREEN') ? (
          <>
            <button
              className="button"
              type="button"
              onClick={() => onSendCommand('LED_GREEN', true)}
              disabled={busyKey === 'student-command-LED_GREEN-true'}
            >
              {t('commandGreenOn')}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => onSendCommand('LED_GREEN', false)}
              disabled={busyKey === 'student-command-LED_GREEN-false'}
            >
              {t('commandGreenOff')}
            </button>
          </>
        ) : null}

        {studentCommandWhitelist.includes('LED_ORANGE') ? (
          <>
            <button
              className="button"
              type="button"
              onClick={() => onSendCommand('LED_ORANGE', true)}
              disabled={busyKey === 'student-command-LED_ORANGE-true'}
            >
              {t('commandOrangeOn')}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => onSendCommand('LED_ORANGE', false)}
              disabled={busyKey === 'student-command-LED_ORANGE-false'}
            >
              {t('commandOrangeOff')}
            </button>
          </>
        ) : null}

        {studentCommandWhitelist.includes('COUNTER_RESET') ? (
          <button
            className="button ghost"
            type="button"
            onClick={() => onSendCommand('COUNTER_RESET')}
            disabled={busyKey === 'student-command-COUNTER_RESET-undefined'}
          >
            {t('commandCounterReset')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
