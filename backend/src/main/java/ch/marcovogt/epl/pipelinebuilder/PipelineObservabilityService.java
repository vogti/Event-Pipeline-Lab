package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.common.EventCategory;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class PipelineObservabilityService {

    private static final int DEFAULT_RATE_LIMIT_MAX_EVENTS = 20;
    private static final long DEFAULT_RATE_LIMIT_WINDOW_MS = 1_000L;
    private static final String DEFAULT_DEDUP_STRATEGY = "TIME_WINDOW";
    private static final String DEFAULT_DEDUP_KEY = "DEVICE_EVENT_PAYLOAD";
    private static final long DEFAULT_DEDUP_WINDOW_MS = 1_000L;
    private static final String DEFAULT_WINDOW_AGGREGATION = "COUNT";
    private static final String DEFAULT_WINDOW_TIME_BASIS = "INGEST_TIME";
    private static final String DEFAULT_WINDOW_LATE_POLICY = "IGNORE";
    private static final long DEFAULT_WINDOW_SIZE_MS = 5_000L;
    private static final long DEFAULT_WINDOW_GRACE_MS = 2_000L;
    private static final int DEFAULT_MICRO_BATCH_SIZE = 10;
    private static final long DEFAULT_MICRO_BATCH_MAX_WAIT_MS = 500L;
    private static final int MAX_DEDUP_STORE_SIZE = 5_000;
    private static final String MODE_EPHEMERAL = "EPHEMERAL";
    private static final String MODE_PERSISTED = "PERSISTED";

    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final int sampleEvery;
    private final int maxSamplesPerBlock;
    private final int latencyWindowSize;
    private final int maxGroupStates;
    private final LinkedHashMap<String, GroupState> stateByKey;

    @Autowired
    public PipelineObservabilityService(
            ObjectMapper objectMapper,
            @Value("${epl.pipeline.observability.sample-every:10}") int sampleEvery,
            @Value("${epl.pipeline.observability.max-samples-per-block:120}") int maxSamplesPerBlock,
            @Value("${epl.pipeline.observability.latency-window-size:512}") int latencyWindowSize,
            @Value("${epl.pipeline.observability.max-groups:64}") int maxGroupStates
    ) {
        this(
                objectMapper,
                Clock.systemUTC(),
                sampleEvery,
                maxSamplesPerBlock,
                latencyWindowSize,
                maxGroupStates
        );
    }

    PipelineObservabilityService(
            ObjectMapper objectMapper,
            Clock clock,
            int sampleEvery,
            int maxSamplesPerBlock,
            int latencyWindowSize,
            int maxGroupStates
    ) {
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.sampleEvery = Math.max(1, Math.min(sampleEvery, 1000));
        this.maxSamplesPerBlock = Math.max(10, Math.min(maxSamplesPerBlock, 2000));
        this.latencyWindowSize = Math.max(50, Math.min(latencyWindowSize, 5000));
        this.maxGroupStates = Math.max(4, Math.min(maxGroupStates, 1000));
        this.stateByKey = new LinkedHashMap<>(32, 0.75f, true);
    }

    public synchronized CanonicalEventDto recordEvent(
            String taskId,
            String groupKey,
            PipelineProcessingSection processing,
            CanonicalEventDto event
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return null;
        }

        GroupState groupState = stateFor(taskId, groupKey);
        groupState.observedEvents += 1L;
        groupState.lastUpdatedAt = Instant.now(clock);

        RuntimeEvent runtimeEvent = RuntimeEvent.from(event, objectMapper);
        boolean dropped = false;

        for (int index = 0; index < processing.slotCount(); index++) {
            String blockType = blockTypeAt(processing, index);
            Map<String, Object> blockConfig = slotConfigAt(processing, index);
            BlockState blockState = blockState(groupState, index, blockType);
            boolean inputInternal = runtimeEvent.isInternal;

            blockState.inCount += 1L;
            if (!inputInternal) {
                blockState.nonInternalInCount += 1L;
            }
            boolean sampled = shouldSample(blockState.inCount);
            long startedNs = System.nanoTime();

            RuntimeEvent inputCopy = runtimeEvent.copy(objectMapper);
            BlockResult result;
            try {
                result = applyBlock(taskId, groupKey, blockState, runtimeEvent, blockType, blockConfig);
            } catch (Exception ex) {
                blockState.errorCount += 1L;
                blockState.dropCount += 1L;
                if (!inputInternal) {
                    blockState.nonInternalErrorCount += 1L;
                    blockState.nonInternalDropCount += 1L;
                }
                incrementDropReason(blockState, "error");
                double latencyMs = latencyMs(startedNs, blockType);
                appendLatency(blockState, latencyMs);
                if (sampled) {
                    appendSample(blockState, sampleFor(inputCopy, null, true, "error", index, blockType));
                }
                dropped = true;
                break;
            }

            double latencyMs = latencyMs(startedNs, blockType);
            appendLatency(blockState, latencyMs);
            blockState.backlogDepth = Math.max(result.backlogDepth, 0);

            if (result.dropped) {
                blockState.dropCount += 1L;
                if (!inputInternal) {
                    blockState.nonInternalDropCount += 1L;
                }
                incrementDropReason(blockState, result.dropReason);
                if (sampled) {
                    appendSample(
                            blockState,
                            sampleFor(inputCopy, null, true, result.dropReason, index, blockType)
                    );
                }
                dropped = true;
                break;
            }

            RuntimeEvent emittedEvent = result.output == null ? runtimeEvent : result.output;
            blockState.outCount += 1L;
            if (!emittedEvent.isInternal) {
                blockState.nonInternalOutCount += 1L;
            }
            runtimeEvent = emittedEvent;
            if (sampled) {
                appendSample(
                        blockState,
                    sampleFor(inputCopy, runtimeEvent.copy(objectMapper), false, null, index, blockType)
                );
            }
        }

        if (dropped) {
            return null;
        }

        return new CanonicalEventDto(
                event.id(),
                runtimeEvent.deviceId,
                runtimeEvent.source,
                runtimeEvent.topic,
                runtimeEvent.eventType,
                runtimeEvent.category,
                safeJson(runtimeEvent.payload),
                runtimeEvent.deviceTs,
                runtimeEvent.ingestTs,
                runtimeEvent.valid,
                event.validationErrors(),
                runtimeEvent.isInternal,
                event.scenarioFlags(),
                event.groupKey(),
                event.sequenceNo()
        );
    }

    public synchronized PipelineObservabilityDto snapshot(
            String taskId,
            String groupKey,
            PipelineProcessingSection processing
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return new PipelineObservabilityDto(
                    sampleEvery,
                    maxSamplesPerBlock,
                    0L,
                    MODE_EPHEMERAL,
                    0L,
                    null,
                    null,
                    List.of()
            );
        }

        GroupState groupState = stateFor(taskId, groupKey);
        List<PipelineBlockObservabilityDto> blocks = new ArrayList<>();

        for (int index = 0; index < processing.slotCount(); index++) {
            String blockType = blockTypeAt(processing, index);
            BlockState state = blockState(groupState, index, blockType);
            List<Double> latencies = new ArrayList<>(state.latenciesMs);
            latencies.sort(Comparator.naturalOrder());
            double p50 = percentile(latencies, 50);
            double p95 = percentile(latencies, 95);

            blocks.add(new PipelineBlockObservabilityDto(
                    index,
                    blockType,
                    stateType(blockType),
                    stateEntryCount(state, blockType),
                    stateTtlSeconds(state, blockType),
                    stateMemoryBytes(state, blockType),
                    state.inCount,
                    state.outCount,
                    state.dropCount,
                    state.errorCount,
                    p50,
                    p95,
                    state.backlogDepth,
                    Map.copyOf(state.dropReasons),
                    List.copyOf(state.samples),
                    state.nonInternalInCount,
                    state.nonInternalOutCount,
                    state.nonInternalDropCount,
                    state.nonInternalErrorCount
            ));
        }

        return new PipelineObservabilityDto(
                sampleEvery,
                maxSamplesPerBlock,
                groupState.observedEvents,
                groupState.persistenceMode,
                groupState.restartCount,
                groupState.lastRestartAt,
                groupState.lastRestartMode,
                blocks
        );
    }

    public synchronized void reset(String taskId, String groupKey) {
        String key = stateKey(taskId, groupKey);
        stateByKey.remove(key);
    }

    public synchronized void resetStateStores(
            String taskId,
            String groupKey,
            PipelineProcessingSection processing
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return;
        }
        GroupState state = stateFor(taskId, groupKey);
        for (int index = 0; index < processing.slotCount(); index++) {
            String blockType = blockTypeAt(processing, index);
            BlockState blockState = blockState(state, index, blockType);
            resetStateStoreForBlock(blockState, blockType);
        }
        state.lastUpdatedAt = Instant.now(clock);
    }

    public synchronized void restart(
            String taskId,
            String groupKey,
            PipelineProcessingSection processing,
            boolean retainState
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return;
        }
        GroupState state = stateFor(taskId, groupKey);
        long nextRestartCount = state.restartCount + 1L;
        state.restartCount = nextRestartCount;
        state.lastRestartAt = Instant.now(clock);
        state.lastRestartMode = retainState ? "RETAINED" : "LOST";
        state.persistenceMode = retainState ? MODE_PERSISTED : MODE_EPHEMERAL;

        if (!retainState) {
            reset(taskId, groupKey);
            state = stateFor(taskId, groupKey);
            state.persistenceMode = MODE_EPHEMERAL;
            state.restartCount = nextRestartCount;
            state.lastRestartAt = Instant.now(clock);
            state.lastRestartMode = "LOST";
            return;
        }

        // Ensure block identities are aligned to current pipeline shape after restart.
        for (int index = 0; index < processing.slotCount(); index++) {
            String blockType = blockTypeAt(processing, index);
            blockState(state, index, blockType);
        }
    }

    private GroupState stateFor(String taskId, String groupKey) {
        String key = stateKey(taskId, groupKey);
        GroupState state = stateByKey.get(key);
        if (state != null) {
            return state;
        }
        GroupState created = new GroupState();
        stateByKey.put(key, created);
        evictIfNeeded();
        return created;
    }

    private BlockState blockState(GroupState groupState, int slotIndex, String blockType) {
        BlockState existing = groupState.blocksBySlotIndex.get(slotIndex);
        if (existing != null && Objects.equals(existing.blockType, blockType)) {
            return existing;
        }
        BlockState created = new BlockState(blockType);
        groupState.blocksBySlotIndex.put(slotIndex, created);
        return created;
    }

    private RuntimeEvent transformPassThrough(RuntimeEvent event) {
        return event;
    }

    private BlockResult applyBlock(
            String taskId,
            String groupKey,
            BlockState state,
            RuntimeEvent event,
            String blockType,
            Map<String, Object> blockConfig
    ) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        RuntimeEvent next = event.copy(objectMapper);

        return switch (normalized) {
            case PipelineBlockLibrary.NONE -> BlockResult.pass(transformPassThrough(next), state.backlogDepth);
            case "FILTER_DEVICE_TOPIC", "FILTER_DEVICE" -> {
                if (event.isInternal) {
                    yield BlockResult.drop("internal_filtered", state.backlogDepth);
                }
                String deviceScope = configString(blockConfig, "deviceScope");
                if (deviceScope.isBlank()) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                String normalizedScope = deviceScope.trim().toUpperCase(Locale.ROOT);
                if ("ALL_DEVICES".equals(normalizedScope)) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                String eventGroup = DeviceIdMapping.groupKeyForDevice(event.deviceId).orElse(event.deviceId);
                if ("OWN_DEVICE".equals(normalizedScope)
                        || "GROUP_DEVICES".equals(normalizedScope)) {
                    if (groupKey.equalsIgnoreCase(eventGroup)) {
                        yield BlockResult.pass(next, state.backlogDepth);
                    }
                    yield BlockResult.drop("device_filtered", state.backlogDepth);
                }
                if ("LECTURER_DEVICE".equals(normalizedScope) || "SINGLE_DEVICE".equals(normalizedScope)) {
                    String requiredDeviceId = firstNonBlank(
                            configString(blockConfig, "lecturerDeviceId"),
                            configString(blockConfig, "deviceId")
                    );
                    if (requiredDeviceId.isBlank()) {
                        yield BlockResult.pass(next, state.backlogDepth);
                    }
                    if (requiredDeviceId.equalsIgnoreCase(event.deviceId)) {
                        yield BlockResult.pass(next, state.backlogDepth);
                    }
                    yield BlockResult.drop("device_filtered", state.backlogDepth);
                }
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "FILTER_TOPIC" -> {
                String configuredTopicFilter = firstNonBlank(
                        configString(blockConfig, "topicFilter"),
                        configString(blockConfig, "topic"),
                        configString(blockConfig, "topicPattern"),
                        configString(blockConfig, "rawTopic")
                );
                if (configuredTopicFilter.isBlank()) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                if (mqttTopicMatches(configuredTopicFilter, event.topic)) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                yield BlockResult.drop("topic_filtered", state.backlogDepth);
            }
            case "EXTRACT_VALUE" -> {
                String extractedValue = EventValueExtractor.extractValue(
                        event.category,
                        event.eventType,
                        event.topic,
                        event.payload,
                        objectMapper
                );
                next.payload = objectMapper.getNodeFactory().textNode(extractedValue);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "TRANSFORM_PAYLOAD" -> {
                Map<String, String> mappings = parsePayloadTransformMappings(blockConfig);
                if (mappings.isEmpty()) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                String payloadText = payloadAsString(next.payload);
                String mapped = mappings.containsKey(payloadText)
                        ? mappings.get(payloadText)
                        : mappings.get(payloadText.trim());
                if (mapped == null) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                next.payload = objectMapper.getNodeFactory().textNode(mapped);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "FILTER_RATE_LIMIT" -> {
                int maxEvents = configInt(
                        blockConfig,
                        List.of("rateLimitMaxEvents", "maxEvents", "eventsPerWindow"),
                        DEFAULT_RATE_LIMIT_MAX_EVENTS,
                        1,
                        10_000
                );
                long windowMs = configLong(
                        blockConfig,
                        List.of("rateLimitWindowMs", "windowMs"),
                        DEFAULT_RATE_LIMIT_WINDOW_MS,
                        50,
                        600_000
                );
                Instant now = event.ingestTs == null ? Instant.now(clock) : event.ingestTs;
                pruneRateLimit(state, now, windowMs);
                if (state.rateLimitAcceptedAt.size() >= maxEvents) {
                    state.backlogDepth = Math.max(0, state.rateLimitAcceptedAt.size() - maxEvents + 1);
                    yield BlockResult.drop("rate_limited", state.backlogDepth);
                }
                state.rateLimitAcceptedAt.addLast(now);
                state.backlogDepth = Math.max(0, state.rateLimitAcceptedAt.size() - maxEvents);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "DEDUP" -> {
                String strategy = configEnum(
                        blockConfig,
                        List.of("dedupStrategy", "strategy"),
                        Set.of("OFF", "TIME_WINDOW", "EVENT_ID"),
                        DEFAULT_DEDUP_STRATEGY
                );
                if ("OFF".equals(strategy)) {
                    state.dedupSeenAt.clear();
                    state.backlogDepth = 0;
                    yield BlockResult.pass(next, state.backlogDepth);
                }

                long windowMs = configLong(
                        blockConfig,
                        List.of("dedupWindowMs", "windowMs"),
                        DEFAULT_DEDUP_WINDOW_MS,
                        50,
                        600_000
                );
                Instant now = event.ingestTs == null ? Instant.now(clock) : event.ingestTs;
                state.dedupWindowMs = windowMs;
                pruneDedup(state, now, windowMs);

                String dedupKey = dedupKey(event, blockConfig, strategy);
                if (dedupKey.isBlank()) {
                    yield BlockResult.pass(next, state.backlogDepth);
                }
                if (state.dedupSeenAt.containsKey(dedupKey)) {
                    yield BlockResult.drop("duplicate", state.backlogDepth);
                }
                state.dedupSeenAt.put(dedupKey, now);
                trimDedup(state);
                state.backlogDepth = state.dedupSeenAt.size();
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "WINDOW_AGGREGATE" -> {
                long windowSizeMs = configLong(
                        blockConfig,
                        List.of("windowSizeMs", "sizeMs"),
                        DEFAULT_WINDOW_SIZE_MS,
                        500,
                        600_000
                );
                String aggregation = configEnum(
                        blockConfig,
                        List.of("windowAggregation", "aggregation"),
                        Set.of("COUNT", "COUNT_DISTINCT_DEVICES", "AVG", "MIN", "MAX"),
                        DEFAULT_WINDOW_AGGREGATION
                );
                String timeBasis = configEnum(
                        blockConfig,
                        List.of("windowTimeBasis", "timeBasis"),
                        Set.of("INGEST_TIME", "EVENT_TIME"),
                        DEFAULT_WINDOW_TIME_BASIS
                );
                String latePolicy = configEnum(
                        blockConfig,
                        List.of("windowLatePolicy", "latePolicy"),
                        Set.of("IGNORE", "GRACE"),
                        DEFAULT_WINDOW_LATE_POLICY
                );
                long graceMs = configLong(
                        blockConfig,
                        List.of("windowGraceMs", "graceMs"),
                        DEFAULT_WINDOW_GRACE_MS,
                        0,
                        120_000
                );

                Instant timestamp = resolveWindowTimestamp(event, timeBasis);
                long timestampMs = timestamp.toEpochMilli();
                long windowStartMs = (timestampMs / windowSizeMs) * windowSizeMs;

                if (state.windowStartEpochMs == Long.MIN_VALUE || windowStartMs > state.windowStartEpochMs) {
                    resetWindowAggregateState(state, windowStartMs);
                } else if (windowStartMs < state.windowStartEpochMs) {
                    long latenessMs = state.windowStartEpochMs - windowStartMs;
                    if ("IGNORE".equals(latePolicy) || latenessMs > graceMs) {
                        yield BlockResult.drop("late_event", state.backlogDepth);
                    }
                }

                String extractedValue = EventValueExtractor.extractValue(
                        event.category,
                        event.eventType,
                        event.topic,
                        event.payload,
                        objectMapper
                );
                Double numericValue = parseDoubleOrNull(extractedValue);
                if (("AVG".equals(aggregation) || "MIN".equals(aggregation) || "MAX".equals(aggregation))
                        && numericValue == null) {
                    yield BlockResult.drop("non_numeric", state.backlogDepth);
                }

                state.windowCount += 1;
                if (numericValue != null) {
                    state.windowValueSum += numericValue;
                    if (state.windowValueMin == null || numericValue < state.windowValueMin) {
                        state.windowValueMin = numericValue;
                    }
                    if (state.windowValueMax == null || numericValue > state.windowValueMax) {
                        state.windowValueMax = numericValue;
                    }
                }
                state.windowDistinctDevices.add(event.deviceId);
                state.backlogDepth = state.windowCount;
                state.windowSizeMs = windowSizeMs;

                ObjectNode payload = objectMapper.createObjectNode();
                payload.put("aggregation", aggregation);
                payload.put("timeBasis", timeBasis);
                payload.put("windowStartTs", Instant.ofEpochMilli(state.windowStartEpochMs).toString());
                payload.put("windowEndTs", Instant.ofEpochMilli(state.windowStartEpochMs + windowSizeMs).toString());
                payload.put("windowSizeMs", windowSizeMs);
                payload.put("eventCount", state.windowCount);
                if (!state.windowDistinctDevices.isEmpty()) {
                    payload.put("distinctDeviceCount", state.windowDistinctDevices.size());
                }
                JsonNode aggregateValue = aggregateValueNode(aggregation, state);
                payload.set("value", aggregateValue);

                next.eventType = event.eventType + ".window.aggregate";
                next.payload = payload;
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "MICRO_BATCH" -> {
                int batchSize = configInt(
                        blockConfig,
                        List.of("microBatchSize", "batchSize"),
                        DEFAULT_MICRO_BATCH_SIZE,
                        1,
                        500
                );
                long maxWaitMs = configLong(
                        blockConfig,
                        List.of("microBatchMaxWaitMs", "maxWaitMs"),
                        DEFAULT_MICRO_BATCH_MAX_WAIT_MS,
                        50,
                        60_000
                );
                Instant now = event.ingestTs == null ? Instant.now(clock) : event.ingestTs;
                state.microBatchMaxWaitMs = maxWaitMs;
                if (state.microBatchStartedAt == null || state.microBatchCount <= 0) {
                    state.microBatchStartedAt = now;
                    state.microBatchCount = 0;
                }
                state.microBatchCount += 1;
                state.backlogDepth = state.microBatchCount;

                boolean flushBySize = state.microBatchCount >= batchSize;
                boolean flushByTime = !flushBySize
                        && Duration.between(state.microBatchStartedAt, now).toMillis() >= maxWaitMs;
                if (!flushBySize && !flushByTime) {
                    yield BlockResult.drop("micro_batch_buffering", state.backlogDepth);
                }

                int emittedCount = state.microBatchCount;
                String flushReason = flushBySize ? "size" : "time";
                state.microBatchCount = 0;
                state.microBatchStartedAt = null;
                state.backlogDepth = 0;

                ObjectNode payload = mutablePayloadObject(next);
                payload.put("batchEventCount", emittedCount);
                payload.put("batchSize", batchSize);
                payload.put("maxWaitMs", maxWaitMs);
                payload.put("flushReason", flushReason);
                next.eventType = event.eventType + ".micro_batch";
                yield BlockResult.pass(next, state.backlogDepth);
            }
            default -> BlockResult.pass(next, state.backlogDepth);
        };
    }

    private void appendLatency(BlockState state, double latencyMs) {
        state.latenciesMs.addLast(latencyMs);
        while (state.latenciesMs.size() > latencyWindowSize) {
            state.latenciesMs.removeFirst();
        }
    }

    private void appendSample(BlockState state, PipelineSampleEventDto sample) {
        state.samples.addLast(sample);
        while (state.samples.size() > maxSamplesPerBlock) {
            state.samples.removeFirst();
        }
    }

    private void incrementDropReason(BlockState state, String reason) {
        String key = reason == null || reason.isBlank() ? "dropped" : reason;
        state.dropReasons.merge(key, 1L, Long::sum);
    }

    private void pruneRateLimit(BlockState state, Instant now, long windowMs) {
        if (state.rateLimitAcceptedAt.isEmpty()) {
            return;
        }
        Instant threshold = now.minusMillis(windowMs);
        while (!state.rateLimitAcceptedAt.isEmpty()
                && state.rateLimitAcceptedAt.peekFirst().isBefore(threshold)) {
            state.rateLimitAcceptedAt.removeFirst();
        }
    }

    private void pruneDedup(BlockState state, Instant now, long windowMs) {
        if (state.dedupSeenAt.isEmpty()) {
            return;
        }
        Instant threshold = now.minusMillis(windowMs);
        state.dedupSeenAt.entrySet().removeIf(entry -> entry.getValue().isBefore(threshold));
    }

    private void trimDedup(BlockState state) {
        while (state.dedupSeenAt.size() > MAX_DEDUP_STORE_SIZE) {
            String eldest = state.dedupSeenAt.keySet().iterator().next();
            state.dedupSeenAt.remove(eldest);
        }
    }

    private String dedupKey(RuntimeEvent event, Map<String, Object> blockConfig, String strategy) {
        if ("EVENT_ID".equals(strategy)) {
            return event.sourceEventId == null ? "" : event.sourceEventId;
        }
        String keyMode = configEnum(
                blockConfig,
                List.of("dedupKey", "key"),
                Set.of("EVENT_ID", "DEVICE_EVENT_PAYLOAD", "DEVICE_EVENT", "TOPIC_PAYLOAD", "PAYLOAD_ONLY"),
                DEFAULT_DEDUP_KEY
        );
        String payloadFingerprint = payloadAsString(event.payload);
        return switch (keyMode) {
            case "EVENT_ID" -> event.sourceEventId == null ? "" : event.sourceEventId;
            case "DEVICE_EVENT" -> event.deviceId + "|" + event.eventType;
            case "TOPIC_PAYLOAD" -> event.topic + "|" + payloadFingerprint;
            case "PAYLOAD_ONLY" -> payloadFingerprint;
            default -> event.deviceId + "|" + event.eventType + "|" + payloadFingerprint;
        };
    }

    private Instant resolveWindowTimestamp(RuntimeEvent event, String timeBasis) {
        if ("EVENT_TIME".equals(timeBasis) && event.deviceTs != null) {
            return event.deviceTs;
        }
        return event.ingestTs == null ? Instant.now(clock) : event.ingestTs;
    }

    private JsonNode aggregateValueNode(String aggregation, BlockState state) {
        return switch (aggregation) {
            case "COUNT" -> objectMapper.getNodeFactory().numberNode(state.windowCount);
            case "COUNT_DISTINCT_DEVICES" -> objectMapper.getNodeFactory().numberNode(state.windowDistinctDevices.size());
            case "AVG" -> objectMapper.getNodeFactory().numberNode(
                    state.windowCount == 0 ? 0.0d : state.windowValueSum / state.windowCount
            );
            case "MIN" -> state.windowValueMin == null
                    ? objectMapper.getNodeFactory().nullNode()
                    : objectMapper.getNodeFactory().numberNode(state.windowValueMin);
            case "MAX" -> state.windowValueMax == null
                    ? objectMapper.getNodeFactory().nullNode()
                    : objectMapper.getNodeFactory().numberNode(state.windowValueMax);
            default -> objectMapper.getNodeFactory().numberNode(state.windowCount);
        };
    }

    private Double parseDoubleOrNull(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Double.parseDouble(value.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private void resetWindowAggregateState(BlockState state, long windowStartMs) {
        state.windowStartEpochMs = windowStartMs;
        state.windowCount = 0;
        state.windowValueSum = 0.0d;
        state.windowValueMin = null;
        state.windowValueMax = null;
        state.windowDistinctDevices.clear();
        state.backlogDepth = 0;
    }

    private void resetStateStoreForBlock(BlockState state, String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        switch (normalized) {
            case "FILTER_RATE_LIMIT" -> {
                state.rateLimitAcceptedAt.clear();
                state.backlogDepth = 0;
            }
            case "DEDUP" -> {
                state.dedupSeenAt.clear();
                state.backlogDepth = 0;
            }
            case "WINDOW_AGGREGATE" -> {
                resetWindowAggregateState(state, Long.MIN_VALUE);
            }
            case "MICRO_BATCH" -> {
                state.microBatchCount = 0;
                state.microBatchStartedAt = null;
                state.backlogDepth = 0;
            }
            default -> {
                // no state store for this block
            }
        }
    }

    private String stateType(String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "DEDUP" -> "DEDUP_STORE";
            case "WINDOW_AGGREGATE" -> "WINDOW_STORE";
            case "MICRO_BATCH" -> "MICRO_BATCH_BUFFER";
            default -> "NONE";
        };
    }

    private long stateEntryCount(BlockState state, String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "DEDUP" -> state.dedupSeenAt.size();
            case "WINDOW_AGGREGATE" -> state.windowStartEpochMs == Long.MIN_VALUE ? 0L : state.windowCount;
            case "MICRO_BATCH" -> state.microBatchCount;
            default -> 0L;
        };
    }

    private Long stateTtlSeconds(BlockState state, String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "DEDUP" -> Math.max(1L, state.dedupWindowMs / 1_000L);
            case "WINDOW_AGGREGATE" -> Math.max(1L, state.windowSizeMs / 1_000L);
            case "MICRO_BATCH" -> Math.max(1L, state.microBatchMaxWaitMs / 1_000L);
            default -> null;
        };
    }

    private long stateMemoryBytes(BlockState state, String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "DEDUP" -> state.dedupSeenAt.size() * 96L;
            case "WINDOW_AGGREGATE" -> 160L + (state.windowDistinctDevices.size() * 48L);
            case "MICRO_BATCH" -> 128L + (state.microBatchCount * 24L);
            default -> 0L;
        };
    }

    private String blockTypeAt(PipelineProcessingSection processing, int slotIndex) {
        if (processing == null || processing.slots() == null) {
            return PipelineBlockLibrary.NONE;
        }
        return processing.slots().stream()
                .filter(slot -> slot.index() == slotIndex)
                .map(PipelineSlot::blockType)
                .findFirst()
                .orElse(PipelineBlockLibrary.NONE);
    }

    private Map<String, Object> slotConfigAt(PipelineProcessingSection processing, int slotIndex) {
        if (processing == null || processing.slots() == null) {
            return Map.of();
        }
        return processing.slots().stream()
                .filter(slot -> slot.index() == slotIndex)
                .map(PipelineSlot::config)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(Map.of());
    }

    private String configString(Map<String, Object> config, String key) {
        if (config == null || config.isEmpty() || key == null || key.isBlank()) {
            return "";
        }
        Object raw = config.get(key);
        return raw == null ? "" : String.valueOf(raw).trim();
    }

    private String configString(Map<String, Object> config, List<String> keys) {
        if (keys == null || keys.isEmpty()) {
            return "";
        }
        for (String key : keys) {
            String value = configString(config, key);
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String configEnum(
            Map<String, Object> config,
            List<String> keys,
            Set<String> allowed,
            String fallback
    ) {
        String raw = configString(config, keys).toUpperCase(Locale.ROOT);
        if (allowed.contains(raw)) {
            return raw;
        }
        return fallback;
    }

    private int configInt(
            Map<String, Object> config,
            List<String> keys,
            int fallback,
            int min,
            int max
    ) {
        long parsed = configLong(config, keys, fallback, min, max);
        return (int) parsed;
    }

    private long configLong(
            Map<String, Object> config,
            List<String> keys,
            long fallback,
            long min,
            long max
    ) {
        if (min > max) {
            return fallback;
        }
        String raw = configString(config, keys);
        if (raw.isBlank()) {
            return clampLong(fallback, min, max);
        }
        try {
            long parsed = Long.parseLong(raw);
            return clampLong(parsed, min, max);
        } catch (NumberFormatException ex) {
            return clampLong(fallback, min, max);
        }
    }

    private long clampLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private String firstNonBlank(String... candidates) {
        if (candidates == null || candidates.length == 0) {
            return "";
        }
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "";
    }

    private String payloadAsString(JsonNode payload) {
        if (payload == null || payload.isNull()) {
            return "";
        }
        if (payload.isTextual() || payload.isNumber() || payload.isBoolean()) {
            return payload.asText();
        }
        return safeJson(payload);
    }

    private Map<String, String> parsePayloadTransformMappings(Map<String, Object> config) {
        if (config == null || config.isEmpty()) {
            return Map.of();
        }
        Object rawMappings = config.get("transformMappings");
        if (rawMappings == null) {
            rawMappings = config.get("mappings");
        }
        if (rawMappings == null) {
            return Map.of();
        }
        LinkedHashMap<String, String> mappings = new LinkedHashMap<>();
        appendMappings(mappings, rawMappings);
        if (mappings.isEmpty()) {
            return Map.of();
        }
        return Map.copyOf(mappings);
    }

    private void appendMappings(Map<String, String> target, Object rawMappings) {
        if (target == null || rawMappings == null) {
            return;
        }
        if (rawMappings instanceof Map<?, ?> mappingMap) {
            for (Map.Entry<?, ?> entry : mappingMap.entrySet()) {
                String from = entry.getKey() == null ? "" : String.valueOf(entry.getKey()).trim();
                if (from.isBlank()) {
                    continue;
                }
                String to = entry.getValue() == null ? "" : String.valueOf(entry.getValue());
                target.put(from, to);
            }
            return;
        }
        if (rawMappings instanceof Iterable<?> iterable) {
            for (Object entry : iterable) {
                if (!(entry instanceof Map<?, ?> mapEntry)) {
                    continue;
                }
                String from = firstNonBlank(
                        mappingValue(mapEntry, "from"),
                        mappingValue(mapEntry, "source"),
                        mappingValue(mapEntry, "in"),
                        mappingValue(mapEntry, "match")
                );
                if (from.isBlank()) {
                    continue;
                }
                String to = firstNonBlank(
                        mappingValue(mapEntry, "to"),
                        mappingValue(mapEntry, "target"),
                        mappingValue(mapEntry, "out"),
                        mappingValue(mapEntry, "replace"),
                        mappingValue(mapEntry, "value")
                );
                target.put(from, to);
            }
            return;
        }
        if (rawMappings instanceof String mappingsJson && !mappingsJson.isBlank()) {
            try {
                Object parsed = objectMapper.readValue(mappingsJson, Object.class);
                appendMappings(target, parsed);
            } catch (Exception ignored) {
                // keep empty
            }
        }
    }

    private String mappingValue(Map<?, ?> source, String key) {
        if (source == null || key == null || key.isBlank()) {
            return "";
        }
        Object raw = source.get(key);
        return raw == null ? "" : String.valueOf(raw);
    }

    private ObjectNode mutablePayloadObject(RuntimeEvent event) {
        if (event.payload instanceof ObjectNode payloadObject) {
            return payloadObject;
        }
        ObjectNode wrapped = objectMapper.createObjectNode();
        if (event.payload != null && !event.payload.isNull()) {
            wrapped.set("value", event.payload);
        }
        event.payload = wrapped;
        return wrapped;
    }

    private boolean mqttTopicMatches(String topicFilter, String topic) {
        if (topicFilter == null || topicFilter.isBlank()) {
            return true;
        }
        if (topic == null || topic.isBlank()) {
            return false;
        }
        String filter = topicFilter.trim();
        String candidateTopic = topic.trim();
        if (mqttTopicMatchesStrict(filter, candidateTopic)) {
            return true;
        }

        // Backward-compatibility between "epld/<deviceId>/..." and "<deviceId>/..." topic shapes.
        if (candidateTopic.startsWith("epld/")) {
            String strippedTopic = candidateTopic.substring("epld/".length());
            if (!strippedTopic.isBlank() && mqttTopicMatchesStrict(filter, strippedTopic)) {
                return true;
            }
        }
        if (filter.startsWith("epld/")) {
            String strippedFilter = filter.substring("epld/".length());
            if (!strippedFilter.isBlank() && mqttTopicMatchesStrict(strippedFilter, candidateTopic)) {
                return true;
            }
        }
        return false;
    }

    private boolean mqttTopicMatchesStrict(String filter, String topic) {
        if ("#".equals(filter)) {
            return true;
        }

        String[] filterLevels = filter.split("/", -1);
        String[] topicLevels = topic.split("/", -1);

        int fi = 0;
        int ti = 0;
        while (fi < filterLevels.length && ti < topicLevels.length) {
            String filterLevel = filterLevels[fi];
            if ("#".equals(filterLevel)) {
                return fi == filterLevels.length - 1;
            }
            if ("+".equals(filterLevel)) {
                fi++;
                ti++;
                continue;
            }
            if (!filterLevel.equals(topicLevels[ti])) {
                return false;
            }
            fi++;
            ti++;
        }

        if (fi == filterLevels.length && ti == topicLevels.length) {
            return true;
        }
        return fi == filterLevels.length - 1 && "#".equals(filterLevels[fi]);
    }

    private PipelineSampleEventDto sampleFor(
            RuntimeEvent input,
            RuntimeEvent output,
            boolean dropped,
            String dropReason,
            int slotIndex,
            String blockType
    ) {
        String traceId = output == null ? input.traceId : output.traceId;
        String inputPayload = safeJson(input.payload);
        String outputPayload = output == null ? null : safeJson(output.payload);
        return new PipelineSampleEventDto(
                traceId,
                Instant.now(clock),
                input.ingestTs,
                input.deviceTs,
                input.deviceId,
                input.topic,
                input.eventType + "@slot" + slotIndex + ":" + blockType,
                output == null ? null : output.eventType,
                input.isInternal,
                dropped,
                dropReason,
                truncatePayload(inputPayload),
                truncatePayload(outputPayload)
        );
    }

    private String truncatePayload(String value) {
        if (value == null) {
            return null;
        }
        if (value.length() <= 4000) {
            return value;
        }
        return value.substring(0, 4000);
    }

    private boolean shouldSample(long observedEvents) {
        return observedEvents <= 1 || observedEvents % sampleEvery == 0;
    }

    private double latencyMs(long startedNs, String blockType) {
        long elapsedNs = System.nanoTime() - startedNs;
        double baseline = switch (blockType == null ? "" : blockType.toUpperCase(Locale.ROOT)) {
            case "FILTER_DEVICE", "FILTER_DEVICE_TOPIC", "FILTER_TOPIC", "EXTRACT_VALUE", "TRANSFORM_PAYLOAD",
                    "FILTER_RATE_LIMIT" -> 0.20;
            case "DEDUP" -> 0.35;
            case "WINDOW_AGGREGATE", "MICRO_BATCH" -> 0.45;
            default -> 0.10;
        };
        double calculated = elapsedNs / 1_000_000.0d + baseline;
        return Math.round(calculated * 1000.0d) / 1000.0d;
    }

    private double percentile(List<Double> sorted, int percentile) {
        if (sorted.isEmpty()) {
            return 0.0d;
        }
        int clamped = Math.max(0, Math.min(percentile, 100));
        int idx = (int) Math.ceil((clamped / 100.0d) * sorted.size()) - 1;
        idx = Math.max(0, Math.min(idx, sorted.size() - 1));
        return sorted.get(idx);
    }

    private String safeJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException ex) {
            return "{}";
        }
    }

    private void evictIfNeeded() {
        while (stateByKey.size() > maxGroupStates) {
            String eldest = stateByKey.keySet().iterator().next();
            stateByKey.remove(eldest);
        }
    }

    private String stateKey(String taskId, String groupKey) {
        return taskId + "|" + groupKey;
    }

    private static final class GroupState {
        private long observedEvents;
        private Instant lastUpdatedAt;
        private String persistenceMode = MODE_EPHEMERAL;
        private long restartCount;
        private Instant lastRestartAt;
        private String lastRestartMode;
        private final Map<Integer, BlockState> blocksBySlotIndex = new LinkedHashMap<>();
    }

    private static final class BlockState {
        private final String blockType;
        private long inCount;
        private long outCount;
        private long dropCount;
        private long errorCount;
        private long nonInternalInCount;
        private long nonInternalOutCount;
        private long nonInternalDropCount;
        private long nonInternalErrorCount;
        private int backlogDepth;
        private long dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS;
        private long windowSizeMs = DEFAULT_WINDOW_SIZE_MS;
        private long microBatchMaxWaitMs = DEFAULT_MICRO_BATCH_MAX_WAIT_MS;
        private int windowCount;
        private long windowStartEpochMs = Long.MIN_VALUE;
        private double windowValueSum;
        private Double windowValueMin;
        private Double windowValueMax;
        private final Set<String> windowDistinctDevices = new HashSet<>();
        private int microBatchCount;
        private Instant microBatchStartedAt;
        private final LinkedHashMap<String, Long> dropReasons = new LinkedHashMap<>();
        private final Deque<Instant> rateLimitAcceptedAt = new ArrayDeque<>();
        private final LinkedHashMap<String, Instant> dedupSeenAt = new LinkedHashMap<>();
        private final Deque<Double> latenciesMs = new ArrayDeque<>();
        private final Deque<PipelineSampleEventDto> samples = new ArrayDeque<>();

        private BlockState(String blockType) {
            this.blockType = blockType == null ? PipelineBlockLibrary.NONE : blockType;
        }
    }

    private record BlockResult(
            RuntimeEvent output,
            boolean dropped,
            String dropReason,
            int backlogDepth
    ) {
        static BlockResult pass(RuntimeEvent output, int backlogDepth) {
            return new BlockResult(output, false, null, backlogDepth);
        }

        static BlockResult drop(String reason, int backlogDepth) {
            return new BlockResult(null, true, reason, backlogDepth);
        }
    }

    private static final class RuntimeEvent {
        private final String traceId;
        private final String sourceEventId;
        private final String deviceId;
        private final String source;
        private final String topic;
        private String eventType;
        private final EventCategory category;
        private final Instant ingestTs;
        private final Instant deviceTs;
        private final boolean valid;
        private final boolean isInternal;
        private JsonNode payload;

        private RuntimeEvent(
                String traceId,
                String sourceEventId,
                String deviceId,
                String source,
                String topic,
                String eventType,
                EventCategory category,
                Instant ingestTs,
                Instant deviceTs,
                boolean valid,
                boolean isInternal,
                JsonNode payload
        ) {
            this.traceId = traceId;
            this.sourceEventId = sourceEventId;
            this.deviceId = deviceId;
            this.source = source;
            this.topic = topic;
            this.eventType = eventType;
            this.category = category;
            this.ingestTs = ingestTs;
            this.deviceTs = deviceTs;
            this.valid = valid;
            this.isInternal = isInternal;
            this.payload = payload;
        }

        static RuntimeEvent from(CanonicalEventDto event, ObjectMapper objectMapper) {
            return new RuntimeEvent(
                    UUID.randomUUID().toString(),
                    event.id() == null ? null : event.id().toString(),
                    event.deviceId(),
                    event.source(),
                    event.topic(),
                    event.eventType(),
                    event.category(),
                    event.ingestTs(),
                    event.deviceTs(),
                    event.valid(),
                    event.isInternal(),
                    parsePayload(event.payloadJson(), objectMapper)
            );
        }

        RuntimeEvent copy(ObjectMapper objectMapper) {
            JsonNode payloadCopy = payload == null ? objectMapper.getNodeFactory().nullNode() : payload.deepCopy();
            return new RuntimeEvent(
                    traceId,
                    sourceEventId,
                    deviceId,
                    source,
                    topic,
                    eventType,
                    category,
                    ingestTs,
                    deviceTs,
                    valid,
                    isInternal,
                    payloadCopy
            );
        }

        private static JsonNode parsePayload(String payloadJson, ObjectMapper objectMapper) {
            if (payloadJson == null || payloadJson.isBlank()) {
                return objectMapper.createObjectNode();
            }
            try {
                return objectMapper.readTree(payloadJson);
            } catch (Exception ex) {
                return objectMapper.getNodeFactory().textNode(payloadJson);
            }
        }
    }
}
