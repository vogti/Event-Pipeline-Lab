import type { I18nKey } from '../../i18n';
import type { PresenceUser, TimestampValue } from '../../types';

interface StudentPresenceSectionProps {
  t: (key: I18nKey) => string;
  groupPresence: PresenceUser[];
  formatTs: (value: TimestampValue) => string;
}

export function StudentPresenceSection({ t, groupPresence, formatTs }: StudentPresenceSectionProps) {
  return (
    <section className="panel panel-animate">
      <h2>{t('groupPresence')}</h2>
      <ul className="presence-list">
        {groupPresence.map((presence) => (
          <li key={`${presence.username}-${presence.displayName}`}>
            <strong>{presence.displayName}</strong>
            <span>{formatTs(presence.lastSeen)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
