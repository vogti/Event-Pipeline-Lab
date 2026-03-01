package ch.marcovogt.epl.pipelinebuilder;

import static org.assertj.core.api.Assertions.assertThat;

import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class PipelineObservabilityServiceConfigBoundsTest {

    private ObjectMapper objectMapper;
    private PipelineObservabilityService service;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        service = new PipelineObservabilityService(
                objectMapper,
                Clock.fixed(Instant.parse("2026-02-26T15:00:00Z"), ZoneOffset.UTC),
                1,
                50,
                128,
                64
        );
    }

    @ParameterizedTest(name = "rate-limit maxEvents raw={0} -> secondDropped={1}")
    @MethodSource("rateLimitMaxEventsCases")
    void rateLimitShouldClampOrFallbackMaxEvents(Object rawMaxEvents, boolean expectSecondDropped) {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_RATE_LIMIT", config("maxEvents", rawMaxEvents, "windowMs", 1000)))
        );

        CanonicalEventDto first = buttonEvent("rl-max-1", Instant.parse("2026-02-26T15:00:00Z"), "{\"state\":true}");
        CanonicalEventDto second = buttonEvent("rl-max-2", Instant.parse("2026-02-26T15:00:00.100Z"), "{\"state\":true}");

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut == null).isEqualTo(expectSecondDropped);
    }

    private static Stream<Arguments> rateLimitMaxEventsCases() {
        return Stream.of(
                Arguments.of(0, true),
                Arguments.of(-2, true),
                Arguments.of("0", true),
                Arguments.of("bad", false),
                Arguments.of(2, false)
        );
    }

    @ParameterizedTest(name = "rate-limit windowMs raw={0} -> secondDropped={1}")
    @MethodSource("rateLimitWindowCases")
    void rateLimitShouldClampOrFallbackWindowMs(Object rawWindowMs, boolean expectSecondDropped) {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "FILTER_RATE_LIMIT", config("maxEvents", 1, "windowMs", rawWindowMs)))
        );

        CanonicalEventDto first = buttonEvent("rl-window-1", Instant.parse("2026-02-26T15:00:00Z"), "{\"state\":true}");
        CanonicalEventDto second = buttonEvent("rl-window-2", Instant.parse("2026-02-26T15:00:00.060Z"), "{\"state\":true}");

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut == null).isEqualTo(expectSecondDropped);
    }

    private static Stream<Arguments> rateLimitWindowCases() {
        return Stream.of(
                Arguments.of(0, false),
                Arguments.of(-50, false),
                Arguments.of(50, false),
                Arguments.of("bad", true),
                Arguments.of(1000, true)
        );
    }

    @ParameterizedTest(name = "dedup windowMs raw={0} -> secondDropped={1}")
    @MethodSource("dedupWindowCases")
    void dedupShouldClampOrFallbackWindowMs(Object rawWindowMs, boolean expectSecondDropped) {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "DEDUP", config("dedupWindowMs", rawWindowMs)))
        );

        CanonicalEventDto first = buttonEvent("dedup-window-1", Instant.parse("2026-02-26T15:00:00Z"), "{\"state\":true}");
        CanonicalEventDto second = buttonEvent("dedup-window-2", Instant.parse("2026-02-26T15:00:00.060Z"), "{\"state\":true}");

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut == null).isEqualTo(expectSecondDropped);
    }

    private static Stream<Arguments> dedupWindowCases() {
        return Stream.of(
                Arguments.of(0, false),
                Arguments.of(-1, false),
                Arguments.of(50, false),
                Arguments.of("bad", true),
                Arguments.of(1000, true)
        );
    }

    @ParameterizedTest(name = "dedup strategy raw={0}, secondState={1} -> secondDropped={2}")
    @MethodSource("dedupStrategyCases")
    void dedupShouldFallbackInvalidStrategyAndRespectConfiguredModes(
            String rawStrategy,
            boolean secondState,
            boolean expectSecondDropped
    ) {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(0, "DEDUP", config("dedupStrategy", rawStrategy)))
        );

        UUID sharedEventId = UUID.nameUUIDFromBytes("shared-dedup-event".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        CanonicalEventDto first = eventWithId(
                sharedEventId,
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
                sharedEventId,
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                "{\"state\":" + secondState + "}",
                null,
                Instant.parse("2026-02-26T15:00:00.100Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut == null).isEqualTo(expectSecondDropped);
    }

    private static Stream<Arguments> dedupStrategyCases() {
        return Stream.of(
                Arguments.of("EVENT_ID", false, true),
                Arguments.of("OFF", false, false),
                Arguments.of("not-a-strategy", true, true)
        );
    }

    @ParameterizedTest(name = "dedup key={0}, secondTopic={1}, secondEventType={2}, secondPayload={3} -> secondDropped={4}")
    @MethodSource("dedupKeyCases")
    void dedupShouldRespectConfiguredKeyModes(
            String dedupKey,
            String secondTopic,
            String secondEventType,
            String secondPayloadJson,
            boolean expectSecondDropped
    ) {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "DEDUP",
                        config("dedupStrategy", "TIME_WINDOW", "dedupWindowMs", 5_000, "dedupKey", dedupKey)
                ))
        );
        CanonicalEventDto first = eventWithId(
                UUID.nameUUIDFromBytes("dedup-key-first".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
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
                UUID.nameUUIDFromBytes("dedup-key-second".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld02",
                secondTopic,
                secondEventType,
                EventCategory.BUTTON,
                secondPayloadJson,
                null,
                Instant.parse("2026-02-26T15:00:00.100Z"),
                false
        );

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut == null).isEqualTo(expectSecondDropped);
    }

    private static Stream<Arguments> dedupKeyCases() {
        return Stream.of(
                Arguments.of("PAYLOAD_ONLY", "epld02/event/button/red", "button.red.release", "{\"state\":true}", true),
                Arguments.of("TOPIC_PAYLOAD", "epld02/event/button/red", "button.red.release", "{\"state\":true}", false),
                Arguments.of("DEVICE_EVENT", "epld02/event/button/red", "button.black.press", "{\"state\":false}", false),
                Arguments.of("invalid-key", "epld02/event/button/red", "button.red.release", "{\"state\":true}", false)
        );
    }

    @ParameterizedTest(name = "window size raw={0} -> effective={1}")
    @MethodSource("windowSizeCases")
    void windowAggregateShouldClampOrFallbackWindowSize(Object rawWindowSizeMs, long expectedWindowSizeMs) throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        config("windowAggregation", "COUNT", "windowSizeMs", rawWindowSizeMs)
                ))
        );
        CanonicalEventDto input = counterEvent("window-size", Instant.parse("2026-02-26T15:00:00Z"), "{\"counter\":1}");

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);
        assertThat(output).isNotNull();

        JsonNode payload = objectMapper.readTree(output.payloadJson());
        assertThat(payload.path("windowSizeMs").asLong()).isEqualTo(expectedWindowSizeMs);
    }

    private static Stream<Arguments> windowSizeCases() {
        return Stream.of(
                Arguments.of(0, 500L),
                Arguments.of(700_000, 600_000L),
                Arguments.of("bad", 5_000L),
                Arguments.of(5_000, 5_000L)
        );
    }

    @ParameterizedTest(name = "window late policy raw={0} -> secondDropped={1}")
    @MethodSource("windowLatePolicyCases")
    void windowAggregateShouldFallbackLatePolicy(String rawLatePolicy, boolean expectSecondDropped) {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        config(
                                "windowAggregation", "COUNT",
                                "windowTimeBasis", "EVENT_TIME",
                                "windowLatePolicy", rawLatePolicy,
                                "windowSizeMs", 1_000,
                                "windowGraceMs", 2_000
                        )
                ))
        );
        CanonicalEventDto first = eventWithId(
                UUID.nameUUIDFromBytes("window-late-1".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                Instant.parse("2026-02-26T15:00:10Z"),
                Instant.parse("2026-02-26T15:00:10Z"),
                false
        );
        CanonicalEventDto late = eventWithId(
                UUID.nameUUIDFromBytes("window-late-2".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
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
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, late);

        assertThat(firstOut).isNotNull();
        assertThat(secondOut == null).isEqualTo(expectSecondDropped);
    }

    private static Stream<Arguments> windowLatePolicyCases() {
        return Stream.of(
                Arguments.of("GRACE", false),
                Arguments.of("IGNORE", true),
                Arguments.of("n/a", true)
        );
    }

    @ParameterizedTest(name = "window time basis raw={0} -> normalized={1}")
    @MethodSource("windowTimeBasisCases")
    void windowAggregateShouldFallbackTimeBasis(String rawTimeBasis, String expectedTimeBasis) throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "WINDOW_AGGREGATE",
                        config("windowAggregation", "COUNT", "windowTimeBasis", rawTimeBasis, "windowSizeMs", 1_000)
                ))
        );
        CanonicalEventDto input = eventWithId(
                UUID.nameUUIDFromBytes(("window-time-basis-" + rawTimeBasis).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                "{\"counter\":1}",
                Instant.parse("2026-02-26T15:00:00Z"),
                Instant.parse("2026-02-26T15:00:03Z"),
                false
        );

        CanonicalEventDto output = service.recordEvent("task_intro", "epld01", processing, input);
        assertThat(output).isNotNull();
        JsonNode payload = objectMapper.readTree(output.payloadJson());
        assertThat(payload.path("timeBasis").asText()).isEqualTo(expectedTimeBasis);
    }

    private static Stream<Arguments> windowTimeBasisCases() {
        return Stream.of(
                Arguments.of("EVENT_TIME", "EVENT_TIME"),
                Arguments.of("INGEST_TIME", "INGEST_TIME"),
                Arguments.of("invalid", "INGEST_TIME")
        );
    }

    @ParameterizedTest(name = "micro-batch size raw={0} -> immediateFlush={1}")
    @MethodSource("microBatchSizeCases")
    void microBatchShouldClampOrFallbackBatchSize(Object rawBatchSize, boolean expectImmediateFlush) throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "MICRO_BATCH",
                        config("microBatchSize", rawBatchSize, "microBatchMaxWaitMs", 60_000)
                ))
        );
        CanonicalEventDto first = counterEvent("mb-size-1", Instant.parse("2026-02-26T15:00:00Z"), "{\"counter\":1}");

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);

        assertThat(firstOut == null).isEqualTo(!expectImmediateFlush);
        if (expectImmediateFlush) {
            JsonNode payload = objectMapper.readTree(firstOut.payloadJson());
            assertThat(payload.path("batchEventCount").asInt()).isEqualTo(1);
            assertThat(payload.path("flushReason").asText()).isEqualTo("size");
        }
    }

    private static Stream<Arguments> microBatchSizeCases() {
        return Stream.of(
                Arguments.of(0, true),
                Arguments.of(-10, true),
                Arguments.of("bad", false),
                Arguments.of(2, false)
        );
    }

    @ParameterizedTest(name = "micro-batch maxWait raw={0} -> secondFlushByTime={1}")
    @MethodSource("microBatchMaxWaitCases")
    void microBatchShouldClampOrFallbackMaxWait(Object rawMaxWaitMs, boolean expectSecondFlushByTime) throws Exception {
        PipelineProcessingSection processing = new PipelineProcessingSection(
                "CONSTRAINED",
                1,
                List.of(new PipelineSlot(
                        0,
                        "MICRO_BATCH",
                        config("microBatchSize", 10, "microBatchMaxWaitMs", rawMaxWaitMs)
                ))
        );
        CanonicalEventDto first = counterEvent("mb-time-1", Instant.parse("2026-02-26T15:00:00Z"), "{\"counter\":1}");
        CanonicalEventDto second = counterEvent("mb-time-2", Instant.parse("2026-02-26T15:00:00.060Z"), "{\"counter\":2}");

        CanonicalEventDto firstOut = service.recordEvent("task_intro", "epld01", processing, first);
        CanonicalEventDto secondOut = service.recordEvent("task_intro", "epld01", processing, second);

        assertThat(firstOut).isNull();
        assertThat(secondOut == null).isEqualTo(!expectSecondFlushByTime);
        if (expectSecondFlushByTime) {
            JsonNode payload = objectMapper.readTree(secondOut.payloadJson());
            assertThat(payload.path("flushReason").asText()).isEqualTo("time");
        }
    }

    private static Stream<Arguments> microBatchMaxWaitCases() {
        return Stream.of(
                Arguments.of(0, true),
                Arguments.of(-1, true),
                Arguments.of("bad", false),
                Arguments.of(500, false),
                Arguments.of(60, true)
        );
    }

    private static Map<String, Object> config(Object... pairs) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index + 1 < pairs.length; index += 2) {
            result.put(String.valueOf(pairs[index]), pairs[index + 1]);
        }
        return Map.copyOf(result);
    }

    private CanonicalEventDto buttonEvent(String suffix, Instant ingestTs, String payloadJson) {
        return eventWithId(
                UUID.nameUUIDFromBytes(("evt-btn-" + suffix).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                "epld01/event/button/black",
                "button.black.press",
                EventCategory.BUTTON,
                payloadJson,
                null,
                ingestTs,
                false
        );
    }

    private CanonicalEventDto counterEvent(String suffix, Instant ingestTs, String payloadJson) {
        return eventWithId(
                UUID.nameUUIDFromBytes(("evt-counter-" + suffix).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                "epld01",
                "epld01/event/counter",
                "counter.blue.changed",
                EventCategory.COUNTER,
                payloadJson,
                null,
                ingestTs,
                false
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
}
