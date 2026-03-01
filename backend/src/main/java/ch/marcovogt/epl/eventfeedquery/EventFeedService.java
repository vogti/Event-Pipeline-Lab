package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.AppRole;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import ch.marcovogt.epl.taskscenarioengine.TaskCapabilities;
import java.util.Comparator;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EventFeedService {

    private final CanonicalEventRepository canonicalEventRepository;
    private final LiveEventBuffer liveEventBuffer;
    private final PipelineLiveEventBuffer pipelineLiveEventBuffer;
    private final AppSettingsService appSettingsService;

    public EventFeedService(
            CanonicalEventRepository canonicalEventRepository,
            LiveEventBuffer liveEventBuffer,
            PipelineLiveEventBuffer pipelineLiveEventBuffer,
            AppSettingsService appSettingsService
    ) {
        this.canonicalEventRepository = canonicalEventRepository;
        this.liveEventBuffer = liveEventBuffer;
        this.pipelineLiveEventBuffer = pipelineLiveEventBuffer;
        this.appSettingsService = appSettingsService;
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

    public void appendToPipelineLiveBuffer(CanonicalEventDto eventDto) {
        pipelineLiveEventBuffer.append(eventDto);
    }

    public void clearLiveBuffer() {
        liveEventBuffer.clear();
        pipelineLiveEventBuffer.clear();
    }

    @Transactional(readOnly = true)
    public List<CanonicalEventDto> getFeedForPrincipal(
            SessionPrincipal principal,
            TaskCapabilities capabilities,
            EventFeedStage stage,
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
        final boolean studentVirtualVisible = principal.role() == AppRole.ADMIN
                || appSettingsService.isStudentVirtualDeviceVisible();

        List<CanonicalEventDto> source = stage == EventFeedStage.AFTER_PIPELINE
                ? pipelineLiveEventBuffer.snapshot(prefetch)
                : canonicalEventRepository.findRecent(null, category, PageRequest.of(0, prefetch))
                        .stream()
                        .map(CanonicalEventDto::from)
                        .toList();

        return source.stream()
                .filter(event -> category == null || event.category() == category)
                .filter(event -> finalIncludeInternal || !event.isInternal())
                .filter(event -> studentVirtualVisible || !DeviceIdMapping.isVirtualDeviceId(event.deviceId()))
                .filter(event -> {
                    if (finalTopicFilter == null) {
                        return true;
                    }
                    return event.topic().toLowerCase().contains(finalTopicFilter)
                            || event.eventType().toLowerCase().contains(finalTopicFilter);
                })
                .filter(event -> visibleForPrincipal(
                        event,
                        principal,
                        capabilities,
                        finalRequestedDeviceId,
                        stage
                ))
                .sorted(
                        Comparator.comparing(CanonicalEventDto::ingestTs, Comparator.nullsLast(Comparator.naturalOrder()))
                                .reversed()
                                .thenComparing(event -> event.id().toString(), Comparator.reverseOrder())
                )
                .limit(boundedLimit)
                .toList();
    }

    private boolean visibleForPrincipal(
            CanonicalEventDto event,
            SessionPrincipal principal,
            TaskCapabilities capabilities,
            String requestedDeviceId,
            EventFeedStage stage
    ) {
        if (principal.role() == AppRole.ADMIN) {
            return requestedDeviceId == null || requestedDeviceId.equals(event.deviceId());
        }

        if (stage == EventFeedStage.AFTER_PIPELINE) {
            if (!isOwnDeviceEvent(event, principal.groupKey())) {
                return false;
            }
            return requestedDeviceId == null || requestedDeviceId.equals(event.deviceId());
        }

        StudentDeviceScope scope = capabilities.studentEventVisibilityScope() == null
                ? (capabilities.canViewRoomEvents() ? StudentDeviceScope.ALL_DEVICES : StudentDeviceScope.OWN_DEVICE)
                : capabilities.studentEventVisibilityScope();
        if (!isVisibleForStudentScope(event, principal.groupKey(), scope)) {
            return false;
        }

        return requestedDeviceId == null || requestedDeviceId.equals(event.deviceId());
    }

    private boolean isVisibleForStudentScope(CanonicalEventDto event, String groupKey, StudentDeviceScope scope) {
        if (scope == StudentDeviceScope.ALL_DEVICES) {
            return true;
        }

        if (scope == StudentDeviceScope.ADMIN_DEVICE) {
            return isAdminDeviceEvent(event);
        }

        if (scope == StudentDeviceScope.OWN_AND_ADMIN_DEVICE) {
            return isOwnDeviceEvent(event, groupKey) || isAdminDeviceEvent(event);
        }

        return isOwnDeviceEvent(event, groupKey);
    }

    private boolean isOwnDeviceEvent(CanonicalEventDto event, String groupKey) {
        String effectiveGroup = hasText(event.groupKey())
                ? event.groupKey().trim()
                : DeviceIdMapping.groupKeyForDevice(event.deviceId()).orElse(event.deviceId());
        return groupKey != null && groupKey.equalsIgnoreCase(effectiveGroup);
    }

    private boolean isAdminDeviceEvent(CanonicalEventDto event) {
        String adminDeviceId = appSettingsService.getAdminDeviceId();
        return hasText(adminDeviceId) && adminDeviceId.equalsIgnoreCase(event.deviceId());
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
