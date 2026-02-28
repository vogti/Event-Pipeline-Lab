package ch.marcovogt.epl.eventingestionnormalization;

import ch.marcovogt.epl.common.EventCategory;
import java.time.Instant;
import java.util.UUID;

public record CanonicalEventDto(
        UUID id,
        String deviceId,
        String source,
        String topic,
        String eventType,
        EventCategory category,
        String payloadJson,
        Instant deviceTs,
        Instant ingestTs,
        boolean valid,
        String validationErrors,
        boolean isInternal,
        String scenarioFlags,
        String groupKey,
        Long sequenceNo
) {
    public CanonicalEventDto(
            UUID id,
            String deviceId,
            String topic,
            String eventType,
            EventCategory category,
            String payloadJson,
            Instant deviceTs,
            Instant ingestTs,
            boolean valid,
            String validationErrors,
            boolean isInternal,
            String scenarioFlags,
            String groupKey,
            Long sequenceNo
    ) {
        this(
                id,
                deviceId,
                deviceId,
                topic,
                eventType,
                category,
                payloadJson,
                deviceTs,
                ingestTs,
                valid,
                validationErrors,
                isInternal,
                scenarioFlags,
                groupKey,
                sequenceNo
        );
    }

    public static CanonicalEventDto from(CanonicalEvent event) {
        return new CanonicalEventDto(
                event.getId(),
                event.getDeviceId(),
                event.getSource(),
                event.getTopic(),
                event.getEventType(),
                event.getCategory(),
                event.getPayloadJson(),
                event.getDeviceTs(),
                event.getIngestTs(),
                event.isValid(),
                event.getValidationErrors(),
                event.isInternal(),
                event.getScenarioFlags(),
                event.getGroupKey(),
                event.getSequenceNo()
        );
    }
}
