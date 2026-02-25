package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EventFeedService {

    private final CanonicalEventRepository canonicalEventRepository;
    private final LiveEventBuffer liveEventBuffer;

    public EventFeedService(CanonicalEventRepository canonicalEventRepository, LiveEventBuffer liveEventBuffer) {
        this.canonicalEventRepository = canonicalEventRepository;
        this.liveEventBuffer = liveEventBuffer;
    }

    @Transactional(readOnly = true)
    public List<CanonicalEventDto> getRecentEvents(int limit, String deviceId, EventCategory category) {
        int boundedLimit = Math.max(1, Math.min(limit, 500));
        return canonicalEventRepository.findRecent(
                        isBlank(deviceId) ? null : deviceId,
                        category,
                        PageRequest.of(0, boundedLimit)
                )
                .stream()
                .map(CanonicalEventDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<CanonicalEventDto> getLiveBuffer(int limit) {
        return liveEventBuffer.snapshot(Math.max(1, Math.min(limit, 500)));
    }

    public void appendToLiveBuffer(CanonicalEventDto eventDto) {
        liveEventBuffer.append(eventDto);
    }

    @Transactional(readOnly = true)
    public List<CanonicalEventDto> getFeedForPrincipal(
            SessionPrincipal principal,
            TaskCapabilities capabilities,
            int limit,
            String topicContains,
            EventCategory category,
            Boolean includeInternal,
            String deviceId
    ) {
        int boundedLimit = Math.max(1, Math.min(limit, 500));
        int prefetch = Math.min(500, Math.max(100, boundedLimit * 8));

        boolean includeInternalEffective = Boolean.TRUE.equals(includeInternal);
        if (principal.role() == AppRole.STUDENT && !capabilities.showInternalEventsToggle()) {
            includeInternalEffective = false;
        }

        String topicFilter = null;
        if (hasText(topicContains)) {
            if (principal.role() == AppRole.ADMIN || capabilities.canFilterByTopic()) {
                topicFilter = topicContains.toLowerCase();
            }
        }

        String requestedDeviceId = null;
        if (hasText(deviceId)) {
            if (principal.role() == AppRole.ADMIN || capabilities.canViewRoomEvents()) {
                requestedDeviceId = deviceId.trim();
            }
        }

        final String finalTopicFilter = topicFilter;
        final String finalRequestedDeviceId = requestedDeviceId;
        final boolean finalIncludeInternal = includeInternalEffective;

        return canonicalEventRepository.findRecent(null, category, PageRequest.of(0, prefetch))
                .stream()
                .map(CanonicalEventDto::from)
                .filter(event -> finalIncludeInternal || !event.isInternal())
                .filter(event -> {
                    if (finalTopicFilter == null) {
                        return true;
                    }
                    return event.topic().toLowerCase().contains(finalTopicFilter)
                            || event.eventType().toLowerCase().contains(finalTopicFilter);
                })
                .filter(event -> visibleForPrincipal(event, principal, capabilities, finalRequestedDeviceId))
                .limit(boundedLimit)
                .toList();
    }

    private boolean visibleForPrincipal(
            CanonicalEventDto event,
            SessionPrincipal principal,
            TaskCapabilities capabilities,
            String requestedDeviceId
    ) {
        if (principal.role() == AppRole.ADMIN) {
            return requestedDeviceId == null || requestedDeviceId.equals(event.deviceId());
        }

        String effectiveGroup = hasText(event.groupKey()) ? event.groupKey() : event.deviceId();
        if (!capabilities.canViewRoomEvents() && !principal.groupKey().equals(effectiveGroup)) {
            return false;
        }

        return requestedDeviceId == null || requestedDeviceId.equals(event.deviceId());
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
