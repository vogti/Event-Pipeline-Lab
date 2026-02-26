import type { I18nKey } from '../../i18n';
import type { TaskCapabilities } from '../../types';

interface StudentCapabilitiesSectionProps {
  t: (key: I18nKey) => string;
  capabilities: TaskCapabilities;
}

export function StudentCapabilitiesSection({ t, capabilities }: StudentCapabilitiesSectionProps) {
  return (
    <section className="panel panel-animate">
      <h2>{t('capabilities')}</h2>
      <div className="chip-row">
        <span className="chip">canViewRoomEvents: {String(capabilities.canViewRoomEvents)}</span>
        <span className="chip">canSendDeviceCommands: {String(capabilities.canSendDeviceCommands)}</span>
        <span className="chip">canFilterByTopic: {String(capabilities.canFilterByTopic)}</span>
        <span className="chip">
          showInternalEventsToggle: {String(capabilities.showInternalEventsToggle)}
        </span>
      </div>
    </section>
  );
}
