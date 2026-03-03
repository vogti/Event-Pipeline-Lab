package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;

import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PipelineObservabilityServiceTest {

    private ObjectMapper objectMapper;
    private PipelineObservabilityService service;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new PipelineObservabilityService(
                objectMapper,
                Clock.fixed(Instant.parse("2026-02-26T15:00:00Z"), ZoneOffset.UTC),
                1,
                3,
                64,
                64
        );
    }

    @Test
    void shouldMeasureLatencyFromNanoClockWithoutSyntheticBaseline() {
        AtomicLong nanos = new AtomicLong(1_000_000_000L);
        PipelineObservabilityService deterministicLatencyService = new PipelineObservabilityService(
                objectMapper,
                Clock.fixed(Instant.parse("2026-02-26T15:00:00Z"), ZoneOffset.UTC),
                1,
                3,
                64,
                64,
                () -> nanos.getAndAdd(200_000L)
        );
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "EXTRACT_VALUE", java.util.Map.of()))
        );

        deterministicLatencyService.recordEvent("task_intro", "epld01", processing, event("lat-1", "{\"v\":1}"));
        deterministicLatencyService.recordEvent("task_intro", "epld01", processing, event("lat-2", "{\"v\":2}"));
        deterministicLatencyService.recordEvent("task_intro", "epld01", processing, event("lat-3", "{\"v\":3}"));

        PipelineObservabilityDto snapshot = deterministicLatencyService.snapshot("task_intro", "epld01", processing);
        PipelineBlockObservabilityDto block = snapshot.blocks().get(0);

        assertThat(block.latencyP50Ms()).isEqualTo(0.2d);
        assertThat(block.latencyP95Ms()).isEqualTo(0.2d);
    }

    @Test
    void shouldTrackCountersAndKeepSamplesBounded() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                2,
                List.of(
                        new PipelineSlot(0, "FILTER_RATE_LIMIT", java.util.Map.of(
                                "rateLimitMaxEvents", 2,
                                "rateLimitWindowMs", 1000
                        )),
                        new PipelineSlot(1, "EXTRACT_VALUE", java.util.Map.of())
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
                List.of(new PipelineSlot(0, "DEDUP", java.util.Map.of("dedupWindowMs", 10_000)))
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
    void filterTopicBlockShouldDropEventsOutsideConfiguredTopicFilter() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_TOPIC", java.util.Map.of("topicFilter", "+/event/button")))
        );

        CanonicalEventDto matching = event(
                "topic-match",
                "epld01/event/button",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}"
        );
        CanonicalEventDto nonMatching = event(
                "topic-miss",
                "epld01/event/sensor/ldr",
                "sensor.ldr.voltage",
                EventCategory.SENSOR,
                "{\"voltage\":2.1}"
        );

        CanonicalEventDto kept = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, nonMatching);

        PipelineObservabilityDto snapshot = service.snapshot("task_intro", "epld01", processing);
        PipelineBlockObservabilityDto block = snapshot.blocks().get(0);

        assertThat(kept).isNotNull();
        assertThat(dropped).isNull();
        assertThat(block.inCount()).isEqualTo(2);
        assertThat(block.outCount()).isEqualTo(1);
        assertThat(block.dropCount()).isEqualTo(1);
        assertThat(block.dropReasons()).containsEntry("topic_filtered", 1L);
    }

    @Test
    void filterTopicBlockShouldAlsoMatchPrefixedTopicsForCompatibility() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_TOPIC", java.util.Map.of("topicFilter", "+/event/button")))
        );

        CanonicalEventDto prefixedTopic = event(
                "topic-prefixed-match",
                "epld/epld01/event/button",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}"
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, prefixedTopic);

        assertThat(output).isNotNull();
    }

    @Test
    void filterPayloadNumericShouldApplyGreaterThanComparison() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "NUMERIC",
                                "payloadFilterOperator", "GT",
                                "payloadFilterValue", "10"
                        )
                ))
        );
        CanonicalEventDto matching = event(
                "payload-num-pass",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "12"
        );
        CanonicalEventDto nonMatching = event(
                "payload-num-drop",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "9"
        );

        CanonicalEventDto kept = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, nonMatching);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(kept).isNotNull();
        assertThat(dropped).isNull();
        assertThat(block.dropReasons()).containsEntry("payload_filtered", 1L);
    }

    @Test
    void filterPayloadNumericShouldParseMeasurementUnitsInPayload() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "NUMERIC",
                                "payloadFilterOperator", "GT",
                                "payloadFilterValue", "2.3"
                        )
                ))
        );
        CanonicalEventDto matching = event(
                "payload-unit-pass",
                "epld01/event/sensor/ldr",
                "sensor.ldr.voltage",
                EventCategory.SENSOR,
                "\"2.37 V\""
        );
        CanonicalEventDto nonMatching = event(
                "payload-unit-drop",
                "epld01/event/sensor/ldr",
                "sensor.ldr.voltage",
                EventCategory.SENSOR,
                "\"2.25 V\""
        );

        CanonicalEventDto kept = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, nonMatching);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(kept).isNotNull();
        assertThat(dropped).isNull();
        assertThat(block.dropReasons()).containsEntry("payload_filtered", 1L);
    }

    @Test
    void filterPayloadNumericShouldAcceptCommaDecimalsAndUnitInConfiguredValue() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "NUMERIC",
                                "payloadFilterOperator", "GTE",
                                "payloadFilterValue", "25.3 \u00b0C"
                        )
                ))
        );
        CanonicalEventDto matching = event(
                "payload-comma-pass",
                "epld01/event/sensor/temperature",
                "sensor.temperature.changed",
                EventCategory.SENSOR,
                "\"25,3 \u00b0C\""
        );
        CanonicalEventDto nonMatching = event(
                "payload-comma-drop",
                "epld01/event/sensor/temperature",
                "sensor.temperature.changed",
                EventCategory.SENSOR,
                "\"24,9 \u00b0C\""
        );

        CanonicalEventDto kept = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, nonMatching);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(kept).isNotNull();
        assertThat(dropped).isNull();
        assertThat(block.dropReasons()).containsEntry("payload_filtered", 1L);
    }

    @Test
    void filterPayloadStringShouldSupportCaseInsensitiveContains() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "STRING",
                                "payloadFilterOperator", "CONTAINS",
                                "payloadFilterValue", "on",
                                "payloadFilterCaseSensitive", false
                        )
                ))
        );
        CanonicalEventDto matching = event(
                "payload-str-pass",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"Pressed_ON_State\""
        );
        CanonicalEventDto nonMatching = event(
                "payload-str-drop",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"released\""
        );

        CanonicalEventDto kept = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, nonMatching);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(kept).isNotNull();
        assertThat(dropped).isNull();
        assertThat(block.dropReasons()).containsEntry("payload_filtered", 1L);
    }

    @Test
    void filterPayloadStringShouldRespectCaseSensitivityWhenEnabled() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "STRING",
                                "payloadFilterOperator", "EQ",
                                "payloadFilterValue", "Pressed",
                                "payloadFilterCaseSensitive", true
                        )
                ))
        );
        CanonicalEventDto mismatchingCase = event(
                "payload-case-drop",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"pressed\""
        );

        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, mismatchingCase);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(dropped).isNull();
        assertThat(block.dropReasons()).containsEntry("payload_filtered", 1L);
    }

    @Test
    void filterPayloadNumericShouldDropNonNumericPayloadsWithSpecificReason() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_VALUE",
                        java.util.Map.of(
                                "payloadFilterMode", "NUMERIC",
                                "payloadFilterOperator", "LTE",
                                "payloadFilterValue", "5"
                        )
                ))
        );
        CanonicalEventDto nonNumeric = event(
                "payload-non-numeric",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"pressed\""
        );

        CanonicalEventDto dropped = service.recordEvent("task_intro", "epld01", processing, nonNumeric);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(dropped).isNull();
        assertThat(block.dropReasons()).containsEntry("payload_non_numeric", 1L);
    }

    @Test
    void conditionalPayloadShouldSetConfiguredPayloadForMatchAndMiss() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "CONDITIONAL_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "NUMERIC",
                                "payloadFilterOperator", "GTE",
                                "payloadFilterValue", "20",
                                "payloadOnMatch", "high",
                                "payloadOnNoMatch", "low"
                        )
                ))
        );
        CanonicalEventDto matching = event(
                "conditional-payload-pass",
                "epld01/event/sensor/temperature",
                "sensor.temperature.changed",
                EventCategory.SENSOR,
                "\"25.3 °C\""
        );
        CanonicalEventDto nonMatching = event(
                "conditional-payload-miss",
                "epld01/event/sensor/temperature",
                "sensor.temperature.changed",
                EventCategory.SENSOR,
                "\"18.9 °C\""
        );

        CanonicalEventDto passOutput = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto missOutput = service.recordEvent("task_intro", "epld01", processing, nonMatching);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(passOutput).isNotNull();
        assertThat(missOutput).isNotNull();
        assertThat(passOutput.payloadJson()).isEqualTo("\"high\"");
        assertThat(missOutput.payloadJson()).isEqualTo("\"low\"");
        assertThat(block.outCount()).isEqualTo(2);
        assertThat(block.dropCount()).isEqualTo(0);
    }

    @Test
    void conditionalPayloadShouldUseNoMatchValueForNonNumericInput() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "CONDITIONAL_PAYLOAD",
                        java.util.Map.of(
                                "payloadFilterMode", "NUMERIC",
                                "payloadFilterOperator", "EQ",
                                "payloadFilterValue", "1",
                                "payloadOnMatch", "yes",
                                "payloadOnNoMatch", "no"
                        )
                ))
        );
        CanonicalEventDto nonNumeric = event(
                "conditional-payload-non-numeric",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"pressed\""
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, nonNumeric);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"no\"");
        assertThat(block.outCount()).isEqualTo(1);
        assertThat(block.dropCount()).isEqualTo(0);
        assertThat(block.dropReasons()).isEmpty();
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

    @Test
    void samplingShouldBeBasedOnPerBlockInputCountForDownstreamInspector() {
        PipelineObservabilityService sampledService = new PipelineObservabilityService(
                new ObjectMapper(),
                Clock.fixed(Instant.parse("2026-02-26T15:00:00Z"), ZoneOffset.UTC),
                10,
                8,
                64,
                64
        );
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                2,
                List.of(
                        new PipelineSlot(0, "FILTER_TOPIC", java.util.Map.of("topicFilter", "+/event/button")),
                        new PipelineSlot(1, "EXTRACT_VALUE", java.util.Map.of())
                )
        );

        CanonicalEventDto droppedFirst = event(
                "sample-drop-first",
                "epld01/event/sensor/ldr",
                "sensor.ldr.voltage",
                EventCategory.SENSOR,
                "{\"voltage\":2.2}"
        );
        CanonicalEventDto passSecond = event(
                "sample-pass-second",
                "epld01/event/button",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}"
        );

        sampledService.recordEvent("task_intro", "epld01", processing, droppedFirst);
        sampledService.recordEvent("task_intro", "epld01", processing, passSecond);

        PipelineObservabilityDto snapshot = sampledService.snapshot("task_intro", "epld01", processing);
        PipelineBlockObservabilityDto downstream = snapshot.blocks().get(1);

        assertThat(downstream.inCount()).isEqualTo(1);
        assertThat(downstream.outCount()).isEqualTo(1);
        assertThat(downstream.samples()).hasSize(1);
        assertThat(downstream.samples().get(0).dropped()).isFalse();
    }

    @Test
    void filterDeviceOwnScopeShouldDropEventsFromOtherGroups() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_DEVICE", java.util.Map.of("deviceScope", "OWN_DEVICE")))
        );

        CanonicalEventDto ownEvent = eventAt(
                "device-own",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto otherGroupEvent = eventAt(
                "device-other",
                "epld02",
                "epld02/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:01Z"),
                false
        );

        CanonicalEventDto ownOutput = service.recordEvent("task_intro", "epld01", processing, ownEvent);
        CanonicalEventDto filteredOutput = service.recordEvent("task_intro", "epld01", processing, otherGroupEvent);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(ownOutput).isNotNull();
        assertThat(filteredOutput).isNull();
        assertThat(block.outCount()).isEqualTo(1);
        assertThat(block.dropCount()).isEqualTo(1);
        assertThat(block.dropReasons()).containsEntry("device_filtered", 1L);
    }

    @Test
    void filterDeviceShouldDropInternalEventsBeforeScopeEvaluation() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_DEVICE", java.util.Map.of("deviceScope", "ALL_DEVICES")))
        );
        CanonicalEventDto internalEvent = eventAt(
                "internal",
                "epld01",
                "epld01/status/system",
                "status.system",
                EventCategory.INTERNAL,
                "{\"kind\":\"internal\"}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                true
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, internalEvent);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(output).isNull();
        assertThat(block.dropReasons()).containsEntry("internal_filtered", 1L);
    }

    @Test
    void shouldTrackNonInternalCountersSeparatelyAndMarkInternalSamples() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "NONE", java.util.Map.of()))
        );
        CanonicalEventDto internalEvent = eventAt(
                "obs-internal",
                "epld01",
                "epld01/status/system",
                "status.system",
                EventCategory.INTERNAL,
                "{\"kind\":\"internal\"}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                true
        );
        CanonicalEventDto externalEvent = eventAt(
                "obs-external",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:01Z"),
                false
        );

        service.recordEvent("task_intro", "epld01", processing, internalEvent);
        service.recordEvent("task_intro", "epld01", processing, externalEvent);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(block.inCount()).isEqualTo(2L);
        assertThat(block.outCount()).isEqualTo(2L);
        assertThat(block.nonInternalInCount()).isEqualTo(1L);
        assertThat(block.nonInternalOutCount()).isEqualTo(1L);
        assertThat(block.nonInternalDropCount()).isEqualTo(0L);
        assertThat(block.nonInternalErrorCount()).isEqualTo(0L);
        assertThat(block.samples()).extracting(PipelineSampleEventDto::internal).containsExactly(true, false);
    }

    @Test
    void filterDeviceLecturerScopeShouldRequireConfiguredDeviceId() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_DEVICE",
                        java.util.Map.of("deviceScope", "LECTURER_DEVICE", "lecturerDeviceId", "epld99")
                ))
        );
        CanonicalEventDto lecturerEvent = eventAt(
                "lecturer-pass",
                "epld99",
                "epld99/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto studentEvent = eventAt(
                "lecturer-drop",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:01Z"),
                false
        );

        CanonicalEventDto pass = service.recordEvent("task_intro", "epld01", processing, lecturerEvent);
        CanonicalEventDto drop = service.recordEvent("task_intro", "epld01", processing, studentEvent);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(pass).isNotNull();
        assertThat(drop).isNull();
        assertThat(block.dropReasons()).containsEntry("device_filtered", 1L);
    }

    @Test
    void filterDeviceOwnAndAdminScopeShouldAllowOwnAndLecturerEvents() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_DEVICE",
                        java.util.Map.of("deviceScope", "OWN_AND_ADMIN_DEVICE", "lecturerDeviceId", "epld99")
                ))
        );
        CanonicalEventDto ownEvent = eventAt(
                "own-pass",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto lecturerEvent = eventAt(
                "lecturer-pass-own-admin",
                "epld99",
                "epld99/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:01Z"),
                false
        );
        CanonicalEventDto otherEvent = eventAt(
                "other-drop-own-admin",
                "epld02",
                "epld02/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:02Z"),
                false
        );

        CanonicalEventDto ownPass = service.recordEvent("task_intro", "epld01", processing, ownEvent);
        CanonicalEventDto lecturerPass = service.recordEvent("task_intro", "epld01", processing, lecturerEvent);
        CanonicalEventDto otherDrop = service.recordEvent("task_intro", "epld01", processing, otherEvent);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(ownPass).isNotNull();
        assertThat(lecturerPass).isNotNull();
        assertThat(otherDrop).isNull();
        assertThat(block.dropReasons()).containsEntry("device_filtered", 1L);
    }

    @Test
    void filterTopicShouldResolveRawTopicAliasAndPrefixedCompatibility() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_TOPIC", java.util.Map.of("rawTopic", "epld/+/event/button/#")))
        );
        CanonicalEventDto pass = event(
                "raw-topic-pass",
                "epld01/event/button/red",
                "button.red.press",
                EventCategory.BUTTON,
                "{\"state\":true}"
        );
        CanonicalEventDto drop = event(
                "raw-topic-drop",
                "epld01/event/sensor/ldr",
                "sensor.ldr.voltage",
                EventCategory.SENSOR,
                "{\"voltage\":2.1}"
        );

        CanonicalEventDto passOutput = service.recordEvent("task_intro", "epld01", processing, pass);
        CanonicalEventDto dropOutput = service.recordEvent("task_intro", "epld01", processing, drop);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(passOutput).isNotNull();
        assertThat(dropOutput).isNull();
        assertThat(block.dropReasons()).containsEntry("topic_filtered", 1L);
    }

    @Test
    void extractValueShouldEmitBlankForStatusSystemEvents() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "EXTRACT_VALUE", java.util.Map.of()))
        );
        CanonicalEventDto input = event(
                "extract-system",
                "epld01/status/system",
                "status.system",
                EventCategory.STATUS,
                "{\"value\":\"ignored\"}"
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"\"");
    }

    @Test
    void extractValueShouldExposeStatusMqttConnectedFlag() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "EXTRACT_VALUE", java.util.Map.of()))
        );
        CanonicalEventDto input = event(
                "extract-status-mqtt",
                "epld01/status/mqtt",
                "status.mqtt",
                EventCategory.STATUS,
                "{\"params\":{\"mqtt\":{\"connected\":true}}}"
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"true\"");
    }

    @Test
    void transformPayloadShouldSupportMapConfigAndTrimLookup() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "TRANSFORM_PAYLOAD",
                        java.util.Map.of("mappings", java.util.Map.of("pressed", "ON"))
                ))
        );
        CanonicalEventDto input = event(
                "transform-map",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\" pressed \""
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);
        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"ON\"");
    }

    @Test
    void transformPayloadShouldKeepPayloadWhenNoMappingMatches() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "TRANSFORM_PAYLOAD",
                        java.util.Map.of("transformMappings", List.of(java.util.Map.of("from", "pressed", "to", "on")))
                ))
        );
        CanonicalEventDto input = event(
                "transform-no-match",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"unknown\""
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);
        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"unknown\"");
    }

    @Test
    void rateLimitShouldAllowEventsAgainAfterWindowExpires() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "FILTER_RATE_LIMIT",
                        java.util.Map.of("maxEvents", 1, "windowMs", 1_000)
                ))
        );
        CanonicalEventDto first = eventAt(
                "rate-1",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto second = eventAt(
                "rate-2",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00.500Z"),
                false
        );
        CanonicalEventDto third = eventAt(
                "rate-3",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:01.200Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);
        CanonicalEventDto thirdOut = service.recordEvent("task_intro", "epld01", processing, third);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNull();
        assertThat(thirdOut).isNotNull();
        assertThat(block.inCount()).isEqualTo(3);
        assertThat(block.outCount()).isEqualTo(2);
        assertThat(block.dropReasons()).containsEntry("rate_limited", 1L);
    }

    @Test
    void dedupShouldPassDuplicatesWhenStrategyOff() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "DEDUP", java.util.Map.of("dedupStrategy", "OFF")))
        );
        CanonicalEventDto duplicate = event("dedup-off", "{\"state\":true}");

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, duplicate);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, duplicate);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNotNull();
        assertThat(block.dropCount()).isEqualTo(0);
    }

    @Test
    void dedupEventIdStrategyShouldDropSameEventIdDespiteDifferentPayload() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "DEDUP", java.util.Map.of("dedupStrategy", "EVENT_ID")))
        );
        UUID sameId = UUID.nameUUIDFromBytes("same-event-id".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        CanonicalEventDto first = eventWithId(
                sameId,
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto second = eventWithId(
                sameId,
                "epld01",
                "epld01/event/button/black",
                "button.black.release",
                EventCategory.BUTTON,
                "{\"state\":false}",
                null,
                Instant.parse("2026-02-26T15:00:00.100Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNull();
        assertThat(block.dropReasons()).containsEntry("duplicate", 1L);
    }

    @Test
    void dedupWindowShouldAllowSameEventAfterWindowExpiry() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "DEDUP", java.util.Map.of("dedupWindowMs", 1_000)))
        );
        CanonicalEventDto first = eventAt(
                "dedup-window-1",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto second = eventAt(
                "dedup-window-2",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00.100Z"),
                false
        );
        CanonicalEventDto third = eventAt(
                "dedup-window-3",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:01.500Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);
        CanonicalEventDto thirdOut = service.recordEvent("task_intro", "epld01", processing, third);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNull();
        assertThat(thirdOut).isNotNull();
        assertThat(block.outCount()).isEqualTo(2);
        assertThat(block.dropReasons()).containsEntry("duplicate", 1L);
    }

    @Test
    void windowAggregateShouldDropNonNumericValuesForAvg() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "WINDOW_AGGREGATE", java.util.Map.of("windowAggregation", "AVG")))
        );
        CanonicalEventDto input = event(
                "window-avg-non-numeric",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}"
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(output).isNull();
        assertThat(block.dropReasons()).containsEntry("non_numeric", 1L);
    }

    @Test
    void windowAggregateShouldRespectEventTimeWithGracePolicy() throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        java.util.Map.of(
                                "windowAggregation", "COUNT",
                                "windowTimeBasis", "EVENT_TIME",
                                "windowLatePolicy", "GRACE",
                                "windowSizeMs", 1_000,
                                "windowGraceMs", 2_000
                        )
                ))
        );
        CanonicalEventDto first = eventAt(
                "window-grace-1",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                Instant.parse("2026-02-26T15:00:10Z"),
                Instant.parse("2026-02-26T15:00:10Z"),
                false
        );
        CanonicalEventDto lateButGrace = eventAt(
                "window-grace-2",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":2}",
                Instant.parse("2026-02-26T15:00:09Z"),
                Instant.parse("2026-02-26T15:00:11Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, lateButGrace);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNotNull();
        JsonNode payload = objectMapper.readTree(secondOut.payloadJson());
        assertThat(payload.path("eventCount").asInt()).isEqualTo(2);
        assertThat(payload.path("value").asInt()).isEqualTo(2);
    }

    @Test
    void windowAggregateShouldDropLateEventsWhenPolicyIgnore() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        java.util.Map.of(
                                "windowAggregation", "COUNT",
                                "windowTimeBasis", "EVENT_TIME",
                                "windowLatePolicy", "IGNORE",
                                "windowSizeMs", 1_000
                        )
                ))
        );
        CanonicalEventDto first = eventAt(
                "window-ignore-1",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                Instant.parse("2026-02-26T15:00:10Z"),
                Instant.parse("2026-02-26T15:00:10Z"),
                false
        );
        CanonicalEventDto late = eventAt(
                "window-ignore-2",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":2}",
                Instant.parse("2026-02-26T15:00:09Z"),
                Instant.parse("2026-02-26T15:00:11Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto lateOut = service.recordEvent("task_intro", "epld01", processing, late);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNotNull();
        assertThat(lateOut).isNull();
        assertThat(block.dropReasons()).containsEntry("late_event", 1L);
    }

    @Test
    void windowAggregateCountDistinctDevicesShouldEmitDistinctCount() throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        java.util.Map.of("windowAggregation", "COUNT_DISTINCT_DEVICES", "windowSizeMs", 5_000)
                ))
        );
        CanonicalEventDto first = eventAt(
                "window-distinct-1",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto second = eventAt(
                "window-distinct-2",
                "epld02",
                "epld02/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                null,
                Instant.parse("2026-02-26T15:00:01Z"),
                false
        );

        service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(secondOut).isNotNull();
        JsonNode payload = objectMapper.readTree(secondOut.payloadJson());
        assertThat(payload.path("distinctDeviceCount").asInt()).isEqualTo(2);
        assertThat(payload.path("value").asInt()).isEqualTo(2);
    }

    @Test
    void microBatchShouldFlushOnBatchSizeThreshold() throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "MICRO_BATCH",
                        java.util.Map.of("microBatchSize", 3, "microBatchMaxWaitMs", 5_000)
                ))
        );

        CanonicalEventDto firstOut = service.recordEvent(
                "task_intro",
                "epld01",
                processing,
                eventAt(
                        "micro-size-1",
                        "epld01",
                        "epld01/event/counter",
                        "counter.blue.changed",
                        EventCategory.COUNTER,
                        "{\"counter\":1}",
                        null,
                        Instant.parse("2026-02-26T15:00:00Z"),
                        false
                )
        );
        CanonicalEventDto secondOut = service.recordEvent(
                "task_intro",
                "epld01",
                processing,
                eventAt(
                        "micro-size-2",
                        "epld01",
                        "epld01/event/counter",
                        "counter.blue.changed",
                        EventCategory.COUNTER,
                        "{\"counter\":2}",
                        null,
                        Instant.parse("2026-02-26T15:00:00.100Z"),
                        false
                )
        );
        CanonicalEventDto thirdOut = service.recordEvent(
                "task_intro",
                "epld01",
                processing,
                eventAt(
                        "micro-size-3",
                        "epld01",
                        "epld01/event/counter",
                        "counter.blue.changed",
                        EventCategory.COUNTER,
                        "{\"counter\":3}",
                        null,
                        Instant.parse("2026-02-26T15:00:00.200Z"),
                        false
                )
        );
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNull();
        assertThat(secondOut).isNull();
        assertThat(thirdOut).isNotNull();
        assertThat(thirdOut.eventType()).endsWith(".micro_batch");
        JsonNode payload = objectMapper.readTree(thirdOut.payloadJson());
        assertThat(payload.path("batchEventCount").asInt()).isEqualTo(3);
        assertThat(payload.path("flushReason").asText()).isEqualTo("size");
        assertThat(block.dropReasons()).containsEntry("micro_batch_buffering", 2L);
    }

    @Test
    void microBatchShouldFlushOnElapsedMaxWait() throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "MICRO_BATCH",
                        java.util.Map.of("microBatchSize", 10, "microBatchMaxWaitMs", 500)
                ))
        );
        CanonicalEventDto firstOut = service.recordEvent(
                "task_intro",
                "epld01",
                processing,
                eventAt(
                        "micro-time-1",
                        "epld01",
                        "epld01/event/counter",
                        "counter.blue.changed",
                        EventCategory.COUNTER,
                        "{\"counter\":1}",
                        null,
                        Instant.parse("2026-02-26T15:00:00Z"),
                        false
                )
        );
        CanonicalEventDto secondOut = service.recordEvent(
                "task_intro",
                "epld01",
                processing,
                eventAt(
                        "micro-time-2",
                        "epld01",
                        "epld01/event/counter",
                        "counter.blue.changed",
                        EventCategory.COUNTER,
                        "{\"counter\":2}",
                        null,
                        Instant.parse("2026-02-26T15:00:01Z"),
                        false
                )
        );

        assertThat(firstOut).isNull();
        assertThat(secondOut).isNotNull();
        JsonNode payload = objectMapper.readTree(secondOut.payloadJson());
        assertThat(payload.path("batchEventCount").asInt()).isEqualTo(2);
        assertThat(payload.path("flushReason").asText()).isEqualTo("time");
    }

    @Test
    void filterTopicShouldSupportTopicPatternAliasWithMultiLevelWildcard() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_TOPIC", java.util.Map.of("topicPattern", "epld01/event/#")))
        );
        CanonicalEventDto matching = event(
                "topic-pattern-match",
                "epld01/event/sensor/temperature",
                "sensor.temperature.changed",
                EventCategory.SENSOR,
                "{\"temperature\":22.3}"
        );
        CanonicalEventDto nonMatching = event(
                "topic-pattern-miss",
                "epld01/status/heartbeat",
                "device.online",
                EventCategory.STATUS,
                "{\"online\":true}"
        );

        CanonicalEventDto pass = service.recordEvent("task_intro", "epld01", processing, matching);
        CanonicalEventDto drop = service.recordEvent("task_intro", "epld01", processing, nonMatching);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(pass).isNotNull();
        assertThat(drop).isNull();
        assertThat(block.dropReasons()).containsEntry("topic_filtered", 1L);
    }

    @Test
    void transformPayloadShouldParseMappingsFromJsonStringWithAliasKeys() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "TRANSFORM_PAYLOAD",
                        java.util.Map.of(
                                "transformMappings",
                                "[{\"source\":\"pressed\",\"target\":\"ON\"},{\"match\":\"released\",\"replace\":\"OFF\"}]"
                        )
                ))
        );
        CanonicalEventDto input = event(
                "transform-json-mapping",
                "epld01/event/button/red",
                "button.red.release",
                EventCategory.BUTTON,
                "\"released\""
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        assertThat(output.payloadJson()).isEqualTo("\"OFF\"");
    }

    @Test
    void dedupPayloadOnlyKeyShouldDropAcrossDifferentEventsWithSamePayload() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "DEDUP",
                        java.util.Map.of("dedupKey", "PAYLOAD_ONLY", "dedupWindowMs", 5_000)
                ))
        );
        CanonicalEventDto first = eventAt(
                "dedup-payload-only-1",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto second = eventAt(
                "dedup-payload-only-2",
                "epld02",
                "epld02/event/button/red",
                "button.red.release",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00.200Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);
        PipelineBlockObservabilityDto block = service.snapshot("task_intro", "epld01", processing).blocks().get(0);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNull();
        assertThat(block.dropReasons()).containsEntry("duplicate", 1L);
    }

    @Test
    void dedupTopicPayloadKeyShouldAllowSamePayloadOnDifferentTopics() {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "DEDUP",
                        java.util.Map.of("dedupKey", "TOPIC_PAYLOAD", "dedupWindowMs", 5_000)
                ))
        );
        CanonicalEventDto first = eventAt(
                "dedup-topic-payload-1",
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto second = eventAt(
                "dedup-topic-payload-2",
                "epld01",
                "epld01/event/button/red",
                "button.red.press",
                EventCategory.BUTTON,
                "{\"state\":true}",
                null,
                Instant.parse("2026-02-26T15:00:00.200Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut).isNotNull();
    }

    @Test
    void windowAggregateShouldComputeMinAndMaxValues() throws Exception {
        PipelineProcessingSection minProcessing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "WINDOW_AGGREGATE", java.util.Map.of("windowAggregation", "MIN")))
        );
        PipelineProcessingSection maxProcessing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "WINDOW_AGGREGATE", java.util.Map.of("windowAggregation", "MAX")))
        );
        CanonicalEventDto low = eventAt(
                "window-min-max-low",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1.5}",
                null,
                Instant.parse("2026-02-26T15:00:00Z"),
                false
        );
        CanonicalEventDto high = eventAt(
                "window-min-max-high",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":3.0}",
                null,
                Instant.parse("2026-02-26T15:00:00.200Z"),
                false
        );

        service.recordEvent("task_intro", "epld01", minProcessing, low);
        CanonicalEventDto minOut = service.recordEvent("task_intro", "epld01", minProcessing, high);

        service.recordEvent("task_intro", "epld02", maxProcessing, low);
        CanonicalEventDto maxOut = service.recordEvent("task_intro", "epld02", maxProcessing, high);

        assertThat(minOut).isNotNull();
        assertThat(maxOut).isNotNull();
        assertThat(objectMapper.readTree(minOut.payloadJson()).path("value").asDouble()).isEqualTo(1.5d);
        assertThat(objectMapper.readTree(maxOut.payloadJson()).path("value").asDouble()).isEqualTo(3.0d);
    }

    @Test
    void windowAggregateEventTimeShouldFallbackToIngestTimestampWhenDeviceTimeMissing() throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        java.util.Map.of("windowAggregation", "COUNT", "windowTimeBasis", "EVENT_TIME", "windowSizeMs", 1_000)
                ))
        );
        CanonicalEventDto input = eventAt(
                "window-event-time-fallback",
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                null,
                Instant.parse("2026-02-26T15:00:03.456Z"),
                false
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        JsonNode payload = objectMapper.readTree(output.payloadJson());
        assertThat(payload.path("timeBasis").asText()).isEqualTo("EVENT_TIME");
        assertThat(payload.path("windowStartTs").asText()).isEqualTo("2026-02-26T15:00:03Z");
        assertThat(payload.path("windowEndTs").asText()).isEqualTo("2026-02-26T15:00:04Z");
    }

    @Test
    void microBatchShouldWrapScalarPayloadIntoObjectOnFlush() throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "MICRO_BATCH",
                        java.util.Map.of("microBatchSize", 1, "microBatchMaxWaitMs", 60_000)
                ))
        );
        CanonicalEventDto input = event(
                "micro-wrap-scalar",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "\"pressed\""
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);

        assertThat(output).isNotNull();
        JsonNode payload = objectMapper.readTree(output.payloadJson());
        assertThat(payload.path("value").asText()).isEqualTo("pressed");
        assertThat(payload.path("batchEventCount").asInt()).isEqualTo(1);
        assertThat(payload.path("flushReason").asText()).isEqualTo("size");
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

    private CanonicalEventDto eventAt(
            String suffix,
            String deviceId,
            String topic,
            String eventType,
            EventCategory category,
            String payloadJson,
            Instant deviceTs,
            Instant ingestTs,
            boolean isInternal
    ) {
        return eventWithId(
                UUID.nameUUIDFromBytes(("event-" + suffix).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                deviceId,
                topic,
                eventType,
                category,
                payloadJson,
                deviceTs,
                ingestTs,
                isInternal
        );
    }

    private CanonicalEventDto eventWithId(
            UUID id,
            String deviceId,
            String topic,
            String eventType,
            EventCategory category,
            String payloadJson,
            Instant deviceTs,
            Instant ingestTs,
            boolean isInternal
    ) {
        return new CanonicalEventDto(
                id,
                deviceId,
                topic,
                eventType,
                category,
                payloadJson,
                deviceTs,
                ingestTs,
                true,
                null,
                isInternal,
                "{}",
                deviceId,
                null
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
