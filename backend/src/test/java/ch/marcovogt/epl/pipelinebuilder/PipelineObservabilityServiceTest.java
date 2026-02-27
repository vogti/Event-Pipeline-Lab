package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;

import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PipelineObservabilityServiceTest {

    private PipelineObservabilityService service;

    @BeforeEach
    void setUp() {
        service = new PipelineObservabilityService(
                new ObjectMapper(),
                Clock.fixed(Instant.parse("2026-02-26T15:00:00Z"), ZoneOffset.UTC),
                1,
                3,
                64,
                64
        );
    }

    @Test
    void shouldTrackCountersAndKeepSamplesBounded() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                2,
                List.of(
                        new PipelineSlot(0, "FILTER_RATE_LIMIT", java.util.Map.of()),
                        new PipelineSlot(1, "ENRICH_METADATA", java.util.Map.of())
                )
        );

        for (int index = 0; index < 10; index++) {
            service.recordEvent("task_intro", "epld01", processing, event("trace-" + index, "{\"v\":" + index + "}"));
        }

        PipelineObservabilityDto snapshot = service.snapshot("task_intro", "epld01", processing);
        assertThat(snapshot.observedEvents()).isEqualTo(10);
        assertThat(snapshot.blocks()).hasSize(2);

        PipelineBlockObservabilityDto rateLimitBlock = snapshot.blocks().get(0);
        assertThat(rateLimitBlock.blockType()).isEqualTo("FILTER_RATE_LIMIT");
        assertThat(rateLimitBlock.inCount()).isEqualTo(10);
        assertThat(rateLimitBlock.outCount()).isEqualTo(2);
        assertThat(rateLimitBlock.dropCount()).isEqualTo(8);
        assertThat(rateLimitBlock.dropReasons()).containsEntry("rate_limited", 8L);
        assertThat(rateLimitBlock.stateType()).isEqualTo("NONE");
        assertThat(rateLimitBlock.samples().size()).isLessThanOrEqualTo(10);
        assertThat(rateLimitBlock.samples()).isNotEmpty();
    }

    @Test
    void shouldMarkDuplicatesForDedupBlock() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "DEDUP", java.util.Map.of()))
        );

        CanonicalEventDto event = event("same", "{\"counter\":1}");
        service.recordEvent("task_intro", "epld01", processing, event);
        service.recordEvent("task_intro", "epld01", processing, event);

        PipelineObservabilityDto snapshot = service.snapshot("task_intro", "epld01", processing);
        PipelineBlockObservabilityDto dedupBlock = snapshot.blocks().get(0);

        assertThat(dedupBlock.inCount()).isEqualTo(2);
        assertThat(dedupBlock.outCount()).isEqualTo(1);
        assertThat(dedupBlock.dropCount()).isEqualTo(1);
        assertThat(dedupBlock.dropReasons()).containsEntry("duplicate", 1L);
        assertThat(dedupBlock.stateType()).isEqualTo("DEDUP_STORE");
        assertThat(dedupBlock.stateEntryCount()).isGreaterThan(0);
        assertThat(dedupBlock.stateTtlSeconds()).isEqualTo(10L);
    }

    @Test
    void restartLostShouldClearObservedStateWhileRetainedShouldKeep() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "WINDOW_AGGREGATE", java.util.Map.of()))
        );

        CanonicalEventDto event = event("window", "{\"counter\":1}");
        service.recordEvent("task_intro", "epld01", processing, event);
        service.recordEvent("task_intro", "epld01", processing, event);

        PipelineObservabilityDto before = service.snapshot("task_intro", "epld01", processing);
        assertThat(before.observedEvents()).isEqualTo(2);
        assertThat(before.blocks().get(0).stateEntryCount()).isEqualTo(2);

        service.restart("task_intro", "epld01", processing, true);
        PipelineObservabilityDto retained = service.snapshot("task_intro", "epld01", processing);
        assertThat(retained.statePersistenceMode()).isEqualTo("PERSISTED");
        assertThat(retained.lastRestartMode()).isEqualTo("RETAINED");
        assertThat(retained.blocks().get(0).stateEntryCount()).isEqualTo(2);

        service.restart("task_intro", "epld01", processing, false);
        PipelineObservabilityDto lost = service.snapshot("task_intro", "epld01", processing);
        assertThat(lost.statePersistenceMode()).isEqualTo("EPHEMERAL");
        assertThat(lost.lastRestartMode()).isEqualTo("LOST");
        assertThat(lost.blocks().get(0).stateEntryCount()).isEqualTo(0);
    }

    @Test
    void extractValueBlockShouldReplacePayloadWithExtractedValue() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "EXTRACT_VALUE", java.util.Map.of()))
        );

        CanonicalEventDto input = event(
                "extract",
                "epld/epld01/event/led/green",
                "led.green.state_changed",
                EventCategory.STATUS,
                "{\"output\":true}"
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"on\"");
    }

    @Test
    void transformPayloadBlockShouldMapExtractedValues() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                2,
                List.of(
                        new PipelineSlot(0, "EXTRACT_VALUE", java.util.Map.of()),
                        new PipelineSlot(
                                1,
                                "TRANSFORM_PAYLOAD",
                                java.util.Map.of(
                                        "transformMappings",
                                        List.of(
                                                java.util.Map.of("from", "pressed", "to", "on"),
                                                java.util.Map.of("from", "released", "to", "off")
                                        )
                                )
                        )
                )
        );

        CanonicalEventDto input = event(
                "transform",
                "epld/epld01/event/button",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}"
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"on\"");
    }

    private CanonicalEventDto event(String suffix, String payloadJson) {
        return event(
                suffix,
                "epld/epld01/event/button",
                "button.black.press",
                EventCategory.BUTTON,
                payloadJson
        );
    }

    private CanonicalEventDto event(
            String suffix,
            String topic,
            String eventType,
            EventCategory category,
            String payloadJson
    ) {
        return new CanonicalEventDto(
                UUID.nameUUIDFromBytes(("event-" + suffix).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                topic,
                eventType,
                category,
                payloadJson,
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                true,
                null,
                false,
                "{}",
                "epld01",
                null
        );
    }
}
