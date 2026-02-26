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
    }

    private CanonicalEventDto event(String suffix, String payloadJson) {
        return new CanonicalEventDto(
                UUID.nameUUIDFromBytes(("event-" + suffix).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                "epld/epld01/event/button",
                "button.black.press",
                EventCategory.BUTTON,
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
