package ch.marcovogt.epl.eventingestionnormalization;

import ch.marcovogt.epl.deviceregistryhealth.DeviceStatus;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusDto;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusService;
import ch.marcovogt.epl.deviceregistryhealth.DeviceTelemetryService;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.pipelinebuilder.PipelineEventProcessingResult;
import ch.marcovogt.epl.pipelinebuilder.PipelineLogModeService;
import ch.marcovogt.epl.pipelinebuilder.PipelineObservabilityUpdateDto;
import ch.marcovogt.epl.pipelinebuilder.PipelineSinkRuntimeUpdateDto;
import ch.marcovogt.epl.pipelinebuilder.PipelineStateService;
import ch.marcovogt.epl.mqttgateway.PublishedEventSourceTracker;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import ch.marcovogt.epl.realtimewebsocket.RealtimeSyncService;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
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
    private final DeviceTelemetryService deviceTelemetryService;
    private final EventFeedService eventFeedService;
    private final AdminWebSocketBroadcaster adminWebSocketBroadcaster;
    private final RealtimeSyncService realtimeSyncService;
    private final PipelineStateService pipelineStateService;
    private final PipelineLogModeService pipelineLogModeService;
    private final PublishedEventSourceTracker publishedEventSourceTracker;
    private final Clock clock;

    public EventIngestionService(
            CanonicalEventNormalizer canonicalEventNormalizer,
            CanonicalEventRepository canonicalEventRepository,
            DeviceStatusService deviceStatusService,
            DeviceTelemetryService deviceTelemetryService,
            EventFeedService eventFeedService,
            AdminWebSocketBroadcaster adminWebSocketBroadcaster,
            RealtimeSyncService realtimeSyncService,
            PipelineStateService pipelineStateService,
            PipelineLogModeService pipelineLogModeService,
            PublishedEventSourceTracker publishedEventSourceTracker
    ) {
        this.canonicalEventNormalizer = canonicalEventNormalizer;
        this.canonicalEventRepository = canonicalEventRepository;
        this.deviceStatusService = deviceStatusService;
        this.deviceTelemetryService = deviceTelemetryService;
        this.eventFeedService = eventFeedService;
        this.adminWebSocketBroadcaster = adminWebSocketBroadcaster;
        this.realtimeSyncService = realtimeSyncService;
        this.pipelineStateService = pipelineStateService;
        this.pipelineLogModeService = pipelineLogModeService;
        this.publishedEventSourceTracker = publishedEventSourceTracker;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public CanonicalEventDto ingest(String topic, byte[] payloadBytes) {
        Instant ingestTs = Instant.now(clock);
        NormalizedEvent normalizedEvent = canonicalEventNormalizer.normalize(topic, payloadBytes, ingestTs);
        String actorSource = publishedEventSourceTracker.consume(topic, new String(payloadBytes, StandardCharsets.UTF_8));
        if (PublishedEventSourceTracker.INTERNAL_FANOUT_SOURCE.equals(actorSource)) {
            log.debug("Skipped internally generated fan-out event topic={}", topic);
            return null;
        }
        if (actorSource != null && !actorSource.isBlank()) {
            normalizedEvent.event().setSource(actorSource);
        }

        CanonicalEvent saved = canonicalEventRepository.save(normalizedEvent.event());
        CanonicalEventDto eventDto = CanonicalEventDto.from(saved);
        deviceTelemetryService.observeEvent(saved);

        eventFeedService.appendToLiveBuffer(eventDto);
        adminWebSocketBroadcaster.broadcastEvent(eventDto);
        realtimeSyncService.broadcastEventToStudents(eventDto);
        pipelineLogModeService.publish(eventDto);

        try {
            List<PipelineEventProcessingResult> processingResults =
                    pipelineStateService.recordObservabilityAndProjectEvents(eventDto);
            for (PipelineEventProcessingResult processingResult : processingResults) {
                PipelineObservabilityUpdateDto observabilityUpdate = processingResult.observabilityUpdate();
                if (observabilityUpdate != null) {
                    realtimeSyncService.broadcastPipelineObservability(observabilityUpdate);
                }
                CanonicalEventDto projectedEvent = processingResult.projectedEvent();
                if (projectedEvent != null) {
                    eventFeedService.appendToPipelineLiveBuffer(projectedEvent);
                    adminWebSocketBroadcaster.broadcast("event.pipeline.append", projectedEvent);
                    realtimeSyncService.broadcastPipelineEventToStudents(projectedEvent);
                }
                PipelineSinkRuntimeUpdateDto sinkRuntimeUpdate = processingResult.sinkRuntimeUpdate();
                if (sinkRuntimeUpdate != null) {
                    realtimeSyncService.broadcastPipelineSinkRuntime(sinkRuntimeUpdate);
                }
            }
        } catch (Exception ex) {
            log.warn("Failed to update pipeline observability for event {}: {}", eventDto.id(), ex.getMessage());
        }

        DeviceStatus status = deviceStatusService.upsertFromInbound(
                saved,
                normalizedEvent.payloadNode(),
                normalizedEvent.explicitOnline()
        );
        if (status != null) {
            DeviceStatusDto statusDto = DeviceStatusDto.from(status);
            adminWebSocketBroadcaster.broadcastDeviceStatus(statusDto);
            realtimeSyncService.broadcastDeviceStatusToStudents(statusDto);
        }

        log.debug(
                "Ingested event topic={} deviceId={} eventType={} valid={}",
                topic,
                saved.getDeviceId(),
                saved.getEventType(),
                saved.isValid()
        );

        return eventDto;
    }
}
