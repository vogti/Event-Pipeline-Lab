package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.common.EventCategory;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class PipelineObservabilityService {

    private static final Duration DEDUP_TTL = Duration.ofSeconds(10);
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

    public synchronized void recordEvent(
            String taskId,
            String groupKey,
            PipelineProcessingSection processing,
            CanonicalEventDto event
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return;
        }

        GroupState groupState = stateFor(taskId, groupKey);
        groupState.observedEvents += 1L;
        groupState.lastUpdatedAt = Instant.now(clock);

        RuntimeEvent runtimeEvent = RuntimeEvent.from(event, objectMapper);
        boolean sampled = shouldSample(groupState.observedEvents);

        for (int index = 0; index < processing.slotCount(); index++) {
            String blockType = blockTypeAt(processing, index);
            BlockState blockState = blockState(groupState, index, blockType);

            blockState.inCount += 1L;
            long startedNs = System.nanoTime();

            RuntimeEvent inputCopy = runtimeEvent.copy(objectMapper);
            BlockResult result;
            try {
                result = applyBlock(taskId, groupKey, blockState, runtimeEvent, blockType);
            } catch (Exception ex) {
                blockState.errorCount += 1L;
                blockState.dropCount += 1L;
                incrementDropReason(blockState, "error");
                double latencyMs = latencyMs(startedNs, blockType);
                appendLatency(blockState, latencyMs);
                if (sampled) {
                    appendSample(blockState, sampleFor(inputCopy, null, true, "error", index, blockType));
                }
                break;
            }

            double latencyMs = latencyMs(startedNs, blockType);
            appendLatency(blockState, latencyMs);
            blockState.backlogDepth = Math.max(result.backlogDepth, 0);

            if (result.dropped) {
                blockState.dropCount += 1L;
                incrementDropReason(blockState, result.dropReason);
                if (sampled) {
                    appendSample(
                            blockState,
                            sampleFor(inputCopy, null, true, result.dropReason, index, blockType)
                    );
                }
                break;
            }

            blockState.outCount += 1L;
            runtimeEvent = result.output == null ? runtimeEvent : result.output;
            if (sampled) {
                appendSample(
                        blockState,
                        sampleFor(inputCopy, runtimeEvent.copy(objectMapper), false, null, index, blockType)
                );
            }
        }
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
                    stateTtlSeconds(blockType),
                    stateMemoryBytes(state, blockType),
                    state.inCount,
                    state.outCount,
                    state.dropCount,
                    state.errorCount,
                    p50,
                    p95,
                    state.backlogDepth,
                    Map.copyOf(state.dropReasons),
                    List.copyOf(state.samples)
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
            String blockType
    ) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        RuntimeEvent next = event.copy(objectMapper);

        return switch (normalized) {
            case PipelineBlockLibrary.NONE -> BlockResult.pass(transformPassThrough(next), state.backlogDepth);
            case "FILTER_DEVICE_TOPIC" -> {
                if (event.isInternal) {
                    yield BlockResult.drop("internal_filtered", state.backlogDepth);
                }
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "FILTER_RATE_LIMIT" -> {
                state.rateLimiterCursor = (state.rateLimiterCursor + 1) % 5;
                if (state.rateLimiterCursor != 0) {
                    yield BlockResult.drop("rate_limited", state.backlogDepth);
                }
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "PARSE_VALIDATE" -> {
                if (!event.valid) {
                    yield BlockResult.drop("invalid", state.backlogDepth);
                }
                next.payload.put("validated", true);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "DEDUP" -> {
                pruneDedup(state, event.ingestTs == null ? Instant.now(clock) : event.ingestTs);
                String dedupKey = event.deviceId + "|" + event.eventType + "|" + event.payload.toString().hashCode();
                if (state.dedupSeenAt.containsKey(dedupKey)) {
                    yield BlockResult.drop("duplicate", state.backlogDepth);
                }
                state.dedupSeenAt.put(dedupKey, Instant.now(clock));
                trimDedup(state);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "WINDOW_AGGREGATE" -> {
                state.windowCount += 1;
                state.backlogDepth = state.windowCount % 10;
                next.eventType = event.eventType + ".windowed";
                next.payload.put("windowCount", state.windowCount);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "MICRO_BATCH" -> {
                state.microBatchCount += 1;
                state.backlogDepth = state.microBatchCount % 5;
                next.eventType = event.eventType + ".batched";
                next.payload.put("microBatchPending", state.backlogDepth);
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "ROUTE" -> {
                next.eventType = event.eventType + ".routed";
                next.payload.put("route", routeForCategory(event.category));
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "RETRY_DLQ" -> {
                int bucket = Math.abs((event.traceId + "|" + state.inCount).hashCode()) % 20;
                if (bucket == 0) {
                    state.errorCount += 1L;
                    yield BlockResult.drop("dlq", state.backlogDepth);
                }
                yield BlockResult.pass(next, state.backlogDepth);
            }
            case "ENRICH_METADATA" -> {
                next.payload.put("groupKey", groupKey);
                next.payload.put("taskId", taskId);
                next.payload.put("traceId", event.traceId);
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

    private void pruneDedup(BlockState state, Instant now) {
        if (state.dedupSeenAt.isEmpty()) {
            return;
        }
        Instant threshold = now.minus(DEDUP_TTL);
        state.dedupSeenAt.entrySet().removeIf(entry -> entry.getValue().isBefore(threshold));
    }

    private void trimDedup(BlockState state) {
        while (state.dedupSeenAt.size() > 300) {
            String eldest = state.dedupSeenAt.keySet().iterator().next();
            state.dedupSeenAt.remove(eldest);
        }
    }

    private void resetStateStoreForBlock(BlockState state, String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        switch (normalized) {
            case "DEDUP" -> state.dedupSeenAt.clear();
            case "WINDOW_AGGREGATE" -> {
                state.windowCount = 0;
                state.backlogDepth = 0;
            }
            case "MICRO_BATCH" -> {
                state.microBatchCount = 0;
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
            case "WINDOW_AGGREGATE" -> state.windowCount;
            case "MICRO_BATCH" -> state.microBatchCount;
            default -> 0L;
        };
    }

    private Long stateTtlSeconds(String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "DEDUP" -> DEDUP_TTL.toSeconds();
            default -> null;
        };
    }

    private long stateMemoryBytes(BlockState state, String blockType) {
        String normalized = blockType == null ? PipelineBlockLibrary.NONE : blockType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "DEDUP" -> state.dedupSeenAt.size() * 96L;
            case "WINDOW_AGGREGATE" -> 128L + (state.windowCount * 24L);
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

    private String routeForCategory(EventCategory category) {
        if (category == null) {
            return "sink.default";
        }
        return switch (category) {
            case BUTTON, COUNTER, SENSOR -> "sink.signal";
            case STATUS -> "sink.monitoring";
            case COMMAND, ACK -> "sink.control";
            case INTERNAL -> "sink.quarantine";
        };
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
            case "FILTER_RATE_LIMIT", "PARSE_VALIDATE" -> 0.20;
            case "DEDUP" -> 0.35;
            case "WINDOW_AGGREGATE", "MICRO_BATCH" -> 0.45;
            case "RETRY_DLQ" -> 0.30;
            case "ENRICH_METADATA" -> 0.25;
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
        private int backlogDepth;
        private int rateLimiterCursor;
        private int windowCount;
        private int microBatchCount;
        private final LinkedHashMap<String, Long> dropReasons = new LinkedHashMap<>();
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
        private final String deviceId;
        private final String topic;
        private String eventType;
        private final EventCategory category;
        private final Instant ingestTs;
        private final Instant deviceTs;
        private final boolean valid;
        private final boolean isInternal;
        private final ObjectNode payload;

        private RuntimeEvent(
                String traceId,
                String deviceId,
                String topic,
                String eventType,
                EventCategory category,
                Instant ingestTs,
                Instant deviceTs,
                boolean valid,
                boolean isInternal,
                ObjectNode payload
        ) {
            this.traceId = traceId;
            this.deviceId = deviceId;
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
                    event.deviceId(),
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
            JsonNode cloned = payload.deepCopy();
            ObjectNode payloadCopy = cloned instanceof ObjectNode objectNode
                    ? objectNode
                    : objectMapper.createObjectNode().set("payload", cloned);
            return new RuntimeEvent(
                    traceId,
                    deviceId,
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

        private static ObjectNode parsePayload(String payloadJson, ObjectMapper objectMapper) {
            if (payloadJson == null || payloadJson.isBlank()) {
                return objectMapper.createObjectNode();
            }
            try {
                JsonNode node = objectMapper.readTree(payloadJson);
                if (node instanceof ObjectNode objectNode) {
                    return objectNode;
                }
                ObjectNode wrapped = objectMapper.createObjectNode();
                wrapped.set("value", node);
                return wrapped;
            } catch (Exception ex) {
                ObjectNode fallback = objectMapper.createObjectNode();
                fallback.put("raw", payloadJson);
                return fallback;
            }
        }
    }
}
