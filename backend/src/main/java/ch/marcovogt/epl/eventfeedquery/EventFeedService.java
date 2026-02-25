package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
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

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
