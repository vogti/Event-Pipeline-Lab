package com.sostiges.epl.eventingestionnormalization;

import com.sostiges.epl.deviceregistryhealth.DeviceStatus;
import com.sostiges.epl.deviceregistryhealth.DeviceStatusDto;
import com.sostiges.epl.deviceregistryhealth.DeviceStatusService;
import com.sostiges.epl.eventfeedquery.EventFeedService;
import com.sostiges.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import java.time.Clock;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EventIngestionService {

    private static final Logger log = LoggerFactory.getLogger(EventIngestionService.class);

    private final CanonicalEventNormalizer canonicalEventNormalizer;
    private final CanonicalEventRepository canonicalEventRepository;
    private final DeviceStatusService deviceStatusService;
    private final EventFeedService eventFeedService;
    private final AdminWebSocketBroadcaster adminWebSocketBroadcaster;
    private final Clock clock;

    public EventIngestionService(
            CanonicalEventNormalizer canonicalEventNormalizer,
            CanonicalEventRepository canonicalEventRepository,
            DeviceStatusService deviceStatusService,
            EventFeedService eventFeedService,
            AdminWebSocketBroadcaster adminWebSocketBroadcaster
    ) {
        this.canonicalEventNormalizer = canonicalEventNormalizer;
        this.canonicalEventRepository = canonicalEventRepository;
        this.deviceStatusService = deviceStatusService;
        this.eventFeedService = eventFeedService;
        this.adminWebSocketBroadcaster = adminWebSocketBroadcaster;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public CanonicalEventDto ingest(String topic, byte[] payloadBytes) {
        Instant ingestTs = Instant.now(clock);
        NormalizedEvent normalizedEvent = canonicalEventNormalizer.normalize(topic, payloadBytes, ingestTs);

        CanonicalEvent saved = canonicalEventRepository.save(normalizedEvent.event());
        CanonicalEventDto eventDto = CanonicalEventDto.from(saved);

        eventFeedService.appendToLiveBuffer(eventDto);
        adminWebSocketBroadcaster.broadcastEvent(eventDto);

        DeviceStatus status = deviceStatusService.upsertFromInbound(
                saved,
                normalizedEvent.payloadNode(),
                normalizedEvent.explicitOnline()
        );
        if (status != null) {
            adminWebSocketBroadcaster.broadcastDeviceStatus(DeviceStatusDto.from(status));
        }

        log.debug(
                "Ingested MQTT topic={} deviceId={} eventType={} valid={}",
                topic,
                saved.getDeviceId(),
                saved.getEventType(),
                saved.isValid()
        );

        return eventDto;
    }
}
