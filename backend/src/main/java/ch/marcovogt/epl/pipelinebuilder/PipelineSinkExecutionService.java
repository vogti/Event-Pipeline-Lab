package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

@Service
public class PipelineSinkExecutionService {

    private static final Logger log = LoggerFactory.getLogger(PipelineSinkExecutionService.class);

    private final ObjectProvider<MqttCommandPublisher> mqttCommandPublisherProvider;
    private final Clock clock;
    private final int maxRuntimeEntries;
    private final LinkedHashMap<String, SinkRuntimeState> runtimeByKey;

    public PipelineSinkExecutionService(
            ObjectProvider<MqttCommandPublisher> mqttCommandPublisherProvider,
            @Value("${epl.pipeline.sink.max-runtime-entries:1024}") int maxRuntimeEntries
    ) {
        this.mqttCommandPublisherProvider = mqttCommandPublisherProvider;
        this.clock = Clock.systemUTC();
        this.maxRuntimeEntries = Math.max(64, Math.min(20_000, maxRuntimeEntries));
        this.runtimeByKey = new LinkedHashMap<>(64, 0.75f, true);
    }

    public synchronized PipelineSinkRuntimeSection snapshot(
            String taskId,
            String groupKey,
            PipelineSinkSection sinkSection
    ) {
        List<PipelineSinkNode> sinks = sinkSection == null || sinkSection.nodes() == null
                ? List.of()
                : sinkSection.nodes();
        return snapshotForNodes(taskId, groupKey, sinks);
    }

    public synchronized PipelineSinkRuntimeSection processProjectedEvent(
            String taskId,
            String groupKey,
            PipelineSinkSection sinkSection,
            CanonicalEventDto event
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return emptySection();
        }

        List<PipelineSinkNode> sinks = sinkSection == null || sinkSection.nodes() == null
                ? List.of()
                : sinkSection.nodes();
        Instant now = Instant.now(clock);

        for (PipelineSinkNode sink : sinks) {
            if (sink == null) {
                continue;
            }
            String sinkId = normalizeSinkId(sink);
            String sinkType = PipelineSinkLibrary.normalizeType(sink.type());

            SinkRuntimeState state = stateFor(taskId, groupKey, sinkId);
            state.receivedCount += 1L;
            state.lastReceivedAt = now;

            if (PipelineSinkLibrary.SEND_EVENT.equals(sinkType)) {
                publishSendEventSink(sink, event);
            }
        }

        return snapshotForNodes(taskId, groupKey, sinks);
    }

    public synchronized PipelineSinkRuntimeSection resetSinkCounter(
            String taskId,
            String groupKey,
            PipelineSinkSection sinkSection,
            String sinkId
    ) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return emptySection();
        }
        if (sinkId == null || sinkId.isBlank()) {
            return snapshot(taskId, groupKey, sinkSection);
        }

        String normalizedSinkId = sinkId.trim();
        runtimeByKey.remove(stateKey(taskId, groupKey, normalizedSinkId));
        return snapshot(taskId, groupKey, sinkSection);
    }

    public synchronized void resetAllForGroup(String taskId, String groupKey) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank()) {
            return;
        }
        String prefix = taskId + "|" + groupKey + "|";
        runtimeByKey.keySet().removeIf(key -> key.startsWith(prefix));
    }

    private void publishSendEventSink(PipelineSinkNode sink, CanonicalEventDto inputEvent) {
        SendEventConfig config = parseSendEventConfig(sink.config());
        String targetTopic = resolveSendEventTopic(config.topic(), inputEvent);
        if (targetTopic.isBlank()) {
            return;
        }
        String outgoingPayload = inputEvent != null ? inputEvent.payloadJson() : config.payload();
        if (outgoingPayload == null || outgoingPayload.isBlank()) {
            return;
        }
        if (inputEvent != null && targetTopic.equals(inputEvent.topic())) {
            log.debug("Skipped SEND_EVENT sink publish to prevent topic echo loop on {}", targetTopic);
            return;
        }
        MqttCommandPublisher mqttCommandPublisher = mqttCommandPublisherProvider.getIfAvailable();
        if (mqttCommandPublisher == null) {
            log.warn("SEND_EVENT sink publish skipped because MQTT publisher is unavailable");
            return;
        }
        try {
            mqttCommandPublisher.publishCustom(targetTopic, outgoingPayload, config.qos(), config.retained());
        } catch (RuntimeException ex) {
            log.warn(
                    "SEND_EVENT sink publish failed sinkId={} topic={} reason={}",
                    normalizeSinkId(sink),
                    targetTopic,
                    ex.getMessage()
            );
        }
    }

    private String resolveSendEventTopic(String configuredTopic, CanonicalEventDto inputEvent) {
        if (configuredTopic == null || configuredTopic.isBlank()) {
            return "";
        }
        String resolved = configuredTopic.trim();
        if (inputEvent == null || inputEvent.deviceId() == null || inputEvent.deviceId().isBlank()) {
            return resolved;
        }

        String deviceId = inputEvent.deviceId().trim();
        resolved = resolved
                .replace("${deviceId}", deviceId)
                .replace("{deviceId}", deviceId);

        if ("DEVICE".equalsIgnoreCase(resolved) || "OWN_DEVICE".equalsIgnoreCase(resolved)) {
            return deviceId;
        }
        if (startsWithIgnoreCase(resolved, "DEVICE/")) {
            return deviceId + resolved.substring("DEVICE".length());
        }
        if (startsWithIgnoreCase(resolved, "OWN_DEVICE/")) {
            return deviceId + resolved.substring("OWN_DEVICE".length());
        }
        return resolved;
    }

    private boolean startsWithIgnoreCase(String value, String prefix) {
        return value.regionMatches(true, 0, prefix, 0, prefix.length());
    }

    private SendEventConfig parseSendEventConfig(Map<String, Object> config) {
        if (config == null || config.isEmpty()) {
            return new SendEventConfig("", "", 1, false);
        }

        String topic = readString(config, "topic");
        if (topic.isBlank()) {
            topic = readString(config, "rawTopic");
        }
        String payload = readString(config, "payload");
        if (payload.isBlank()) {
            payload = readString(config, "rawPayload");
        }
        int qos = readQos(config, 1);
        boolean retained = readBoolean(config, "retained", false);

        return new SendEventConfig(topic, payload, qos, retained);
    }

    private String readString(Map<String, Object> source, String key) {
        Object raw = source.get(key);
        if (raw == null) {
            return "";
        }
        return String.valueOf(raw).trim();
    }

    private int readQos(Map<String, Object> source, int fallback) {
        Object raw = source.get("qos");
        int parsed = fallback;
        if (raw instanceof Number number) {
            parsed = number.intValue();
        } else if (raw instanceof String text) {
            try {
                parsed = Integer.parseInt(text.trim());
            } catch (NumberFormatException ignored) {
                parsed = fallback;
            }
        }
        return switch (parsed) {
            case 0, 1, 2 -> parsed;
            default -> fallback;
        };
    }

    private boolean readBoolean(Map<String, Object> source, String key, boolean fallback) {
        Object raw = source.get(key);
        if (raw instanceof Boolean value) {
            return value;
        }
        if (raw instanceof Number number) {
            return number.intValue() != 0;
        }
        if (raw instanceof String text) {
            String normalized = text.trim().toLowerCase();
            if ("true".equals(normalized) || "1".equals(normalized) || "yes".equals(normalized)) {
                return true;
            }
            if ("false".equals(normalized) || "0".equals(normalized) || "no".equals(normalized)) {
                return false;
            }
        }
        return fallback;
    }

    private PipelineSinkRuntimeSection snapshotForNodes(String taskId, String groupKey, List<PipelineSinkNode> sinks) {
        if (taskId == null || taskId.isBlank() || groupKey == null || groupKey.isBlank() || sinks == null) {
            return emptySection();
        }

        List<PipelineSinkRuntimeNodeDto> nodes = new ArrayList<>();
        for (PipelineSinkNode sink : sinks) {
            if (sink == null) {
                continue;
            }
            String sinkId = normalizeSinkId(sink);
            String sinkType = PipelineSinkLibrary.normalizeType(sink.type());
            SinkRuntimeState state = runtimeByKey.get(stateKey(taskId, groupKey, sinkId));
            nodes.add(new PipelineSinkRuntimeNodeDto(
                    sinkId,
                    sinkType,
                    state == null ? 0L : state.receivedCount,
                    state == null ? null : state.lastReceivedAt
            ));
        }

        return new PipelineSinkRuntimeSection(List.copyOf(nodes));
    }

    private String normalizeSinkId(PipelineSinkNode sink) {
        if (sink == null) {
            return PipelineSinkLibrary.EVENT_FEED_ID;
        }
        if (sink.id() != null && !sink.id().isBlank()) {
            return sink.id().trim();
        }
        return PipelineSinkLibrary.defaultIdForType(sink.type());
    }

    private SinkRuntimeState stateFor(String taskId, String groupKey, String sinkId) {
        String key = stateKey(taskId, groupKey, sinkId);
        SinkRuntimeState state = runtimeByKey.get(key);
        if (state != null) {
            return state;
        }
        SinkRuntimeState created = new SinkRuntimeState();
        runtimeByKey.put(key, created);
        evictIfNeeded();
        return created;
    }

    private void evictIfNeeded() {
        while (runtimeByKey.size() > maxRuntimeEntries) {
            String eldestKey = runtimeByKey.keySet().iterator().next();
            runtimeByKey.remove(eldestKey);
        }
    }

    private String stateKey(String taskId, String groupKey, String sinkId) {
        return taskId + "|" + groupKey + "|" + sinkId;
    }

    private PipelineSinkRuntimeSection emptySection() {
        return new PipelineSinkRuntimeSection(List.of());
    }

    private record SendEventConfig(String topic, String payload, int qos, boolean retained) {
    }

    private static final class SinkRuntimeState {
        private long receivedCount;
        private Instant lastReceivedAt;
    }
}
