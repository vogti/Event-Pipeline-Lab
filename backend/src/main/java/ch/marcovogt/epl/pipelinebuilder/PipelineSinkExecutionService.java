package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.mqttgateway.MqttCommandPublisher;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Service;

@Service
public class PipelineSinkExecutionService implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(PipelineSinkExecutionService.class);
    private static final int SHOW_PAYLOAD_PREVIEW_MAX_LENGTH = 40;

    private final ObjectProvider<MqttCommandPublisher> mqttCommandPublisherProvider;
    private final Clock clock;
    private final int maxRuntimeEntries;
    private final LinkedHashMap<String, SinkRuntimeState> runtimeByKey;
    private final ScheduledExecutorService blinkScheduler;

    public PipelineSinkExecutionService(
            ObjectProvider<MqttCommandPublisher> mqttCommandPublisherProvider,
            @Value("${epl.pipeline.sink.max-runtime-entries:1024}") int maxRuntimeEntries
    ) {
        this.mqttCommandPublisherProvider = mqttCommandPublisherProvider;
        this.clock = Clock.systemUTC();
        this.maxRuntimeEntries = Math.max(64, Math.min(20_000, maxRuntimeEntries));
        this.runtimeByKey = new LinkedHashMap<>(64, 0.75f, true);
        this.blinkScheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "epl-sink-blink");
            thread.setDaemon(true);
            return thread;
        });
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
        return processProjectedEvent(
                taskId,
                groupKey,
                sinkSection,
                event,
                StudentDeviceScope.ALL_DEVICES,
                groupKey,
                null
        );
    }

    public synchronized PipelineSinkRuntimeSection processProjectedEvent(
            String taskId,
            String groupKey,
            PipelineSinkSection sinkSection,
            CanonicalEventDto event,
            StudentDeviceScope targetScope,
            String ownerGroupKey,
            String adminDeviceId
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
            state.lastPayloadPreview = previewPayload(inputPayload(event));

            if (PipelineSinkLibrary.SEND_EVENT.equals(sinkType)) {
                publishSendEventSink(sink, event, targetScope, ownerGroupKey, adminDeviceId);
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

    private void publishSendEventSink(
            PipelineSinkNode sink,
            CanonicalEventDto inputEvent,
            StudentDeviceScope targetScope,
            String ownerGroupKey,
            String adminDeviceId
    ) {
        SendEventConfig config = parseSendEventConfig(sink.config());
        String targetTopic = resolveSendEventTopic(config.topic(), inputEvent);
        if (targetTopic.isBlank()) {
            return;
        }
        StudentDeviceScope resolvedScope = targetScope == null ? StudentDeviceScope.ALL_DEVICES : targetScope;
        boolean adminPipelineOwner = ownerGroupKey != null
                && !ownerGroupKey.isBlank()
                && adminDeviceId != null
                && !adminDeviceId.isBlank()
                && ownerGroupKey.trim().equalsIgnoreCase(adminDeviceId.trim());
        if (!adminPipelineOwner && !isTopicAllowedForScope(resolvedScope, targetTopic, ownerGroupKey, adminDeviceId)) {
            log.debug(
                    "Skipped SEND_EVENT sink publish due target scope restriction sinkId={} topic={} scope={}",
                    normalizeSinkId(sink),
                    targetTopic,
                    resolvedScope
            );
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
        if (config.ledBlinkEnabled()) {
            publishLedBlink(sink, mqttCommandPublisher, targetTopic, config.qos(), config.retained(), config.ledBlinkMs());
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

    private void publishLedBlink(
            PipelineSinkNode sink,
            MqttCommandPublisher mqttCommandPublisher,
            String targetTopic,
            int qos,
            boolean retained,
            int blinkMs
    ) {
        try {
            mqttCommandPublisher.publishCustom(targetTopic, "on", qos, retained);
        } catch (RuntimeException ex) {
            log.warn(
                    "SEND_EVENT LED blink publish(on) failed sinkId={} topic={} reason={}",
                    normalizeSinkId(sink),
                    targetTopic,
                    ex.getMessage()
            );
            return;
        }
        blinkScheduler.schedule(() -> {
            try {
                mqttCommandPublisher.publishCustom(targetTopic, "off", qos, retained);
            } catch (RuntimeException ex) {
                log.warn(
                        "SEND_EVENT LED blink publish(off) failed sinkId={} topic={} reason={}",
                        normalizeSinkId(sink),
                        targetTopic,
                        ex.getMessage()
                );
            }
        }, Math.max(50, Math.min(blinkMs, 10_000)), TimeUnit.MILLISECONDS);
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

    private boolean isTopicAllowedForScope(
            StudentDeviceScope scope,
            String topic,
            String ownerGroupKey,
            String adminDeviceId
    ) {
        if (scope == StudentDeviceScope.ALL_DEVICES) {
            return true;
        }
        String targetGroupKey = extractTopicTargetGroupKey(topic);
        if (targetGroupKey == null || targetGroupKey.isBlank()) {
            return false;
        }
        boolean isOwn = ownerGroupKey != null && ownerGroupKey.equalsIgnoreCase(targetGroupKey);
        boolean isAdmin = adminDeviceId != null && adminDeviceId.equalsIgnoreCase(targetGroupKey);
        return switch (scope) {
            case OWN_DEVICE -> isOwn;
            case ADMIN_DEVICE -> isAdmin;
            case OWN_AND_ADMIN_DEVICE -> isOwn || isAdmin;
            case ALL_DEVICES -> true;
        };
    }

    private String extractTopicTargetGroupKey(String topic) {
        if (topic == null || topic.isBlank()) {
            return null;
        }
        String normalized = topic.trim();
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        if (startsWithIgnoreCase(normalized, "epld/")) {
            normalized = normalized.substring("epld/".length());
        }
        int separatorIndex = normalized.indexOf('/');
        String firstSegment = (separatorIndex < 0 ? normalized : normalized.substring(0, separatorIndex))
                .trim()
                .toLowerCase(Locale.ROOT);
        if (firstSegment.isEmpty()) {
            return null;
        }
        return DeviceIdMapping.groupKeyForDevice(firstSegment).orElse(null);
    }

    private SendEventConfig parseSendEventConfig(Map<String, Object> config) {
        if (config == null || config.isEmpty()) {
            return new SendEventConfig("", "", 1, false, false, 200);
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
        boolean ledBlinkEnabled = readBoolean(config, "ledBlinkEnabled", false);
        int ledBlinkMs = readInt(config, "ledBlinkMs", 200, 50, 10_000);

        return new SendEventConfig(topic, payload, qos, retained, ledBlinkEnabled, ledBlinkMs);
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
            String normalized = text.trim().toLowerCase(Locale.ROOT);
            if ("true".equals(normalized) || "1".equals(normalized) || "yes".equals(normalized)) {
                return true;
            }
            if ("false".equals(normalized) || "0".equals(normalized) || "no".equals(normalized)) {
                return false;
            }
        }
        return fallback;
    }

    private int readInt(Map<String, Object> source, String key, int fallback, int min, int max) {
        Object raw = source.get(key);
        int value = fallback;
        if (raw instanceof Number number) {
            value = number.intValue();
        } else if (raw instanceof String text) {
            try {
                value = Integer.parseInt(text.trim());
            } catch (NumberFormatException ignored) {
                value = fallback;
            }
        }
        return Math.max(min, Math.min(max, value));
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
                    state == null ? null : state.lastReceivedAt,
                    state == null ? null : state.lastPayloadPreview
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

    private String inputPayload(CanonicalEventDto event) {
        if (event == null || event.payloadJson() == null) {
            return "";
        }
        return event.payloadJson();
    }

    private String previewPayload(String payload) {
        if (payload == null) {
            return "";
        }
        String trimmed = payload.trim();
        if (trimmed.length() <= SHOW_PAYLOAD_PREVIEW_MAX_LENGTH) {
            return trimmed;
        }
        return trimmed.substring(0, SHOW_PAYLOAD_PREVIEW_MAX_LENGTH);
    }

    @Override
    public void destroy() {
        blinkScheduler.shutdownNow();
    }

    private record SendEventConfig(
            String topic,
            String payload,
            int qos,
            boolean retained,
            boolean ledBlinkEnabled,
            int ledBlinkMs
    ) {
    }

    private static final class SinkRuntimeState {
        private long receivedCount;
        private Instant lastReceivedAt;
        private String lastPayloadPreview;
    }
}
