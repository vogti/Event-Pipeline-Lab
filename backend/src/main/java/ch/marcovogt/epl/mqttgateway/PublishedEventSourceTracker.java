package ch.marcovogt.epl.mqttgateway;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class PublishedEventSourceTracker {

    private final Map<EventKey, Deque<SourceEntry>> entriesByKey = new ConcurrentHashMap<>();
    private final Clock clock;
    private final Duration ttl;

    public PublishedEventSourceTracker(
            @Value("${epl.mqtt.publish-source-ttl:PT30S}") Duration ttl
    ) {
        this.clock = Clock.systemUTC();
        this.ttl = ttl == null || ttl.isNegative() ? Duration.ofSeconds(30) : ttl;
    }

    public void register(String topic, String payload, String source) {
        String normalizedSource = normalizeText(source);
        if (normalizedSource == null) {
            return;
        }
        EventKey key = keyFor(topic, payload);
        if (key == null) {
            return;
        }

        Instant now = Instant.now(clock);
        SourceEntry entry = new SourceEntry(normalizedSource, now.plus(ttl));
        Deque<SourceEntry> queue = entriesByKey.computeIfAbsent(key, ignored -> new ArrayDeque<>());
        synchronized (queue) {
            trimExpired(queue, now);
            queue.addLast(entry);
        }
    }

    public String consume(String topic, String payload) {
        EventKey key = keyFor(topic, payload);
        if (key == null) {
            return null;
        }

        Deque<SourceEntry> queue = entriesByKey.get(key);
        if (queue == null) {
            return null;
        }

        Instant now = Instant.now(clock);
        synchronized (queue) {
            trimExpired(queue, now);
            SourceEntry entry = queue.pollFirst();
            if (queue.isEmpty()) {
                entriesByKey.remove(key, queue);
            }
            return entry == null ? null : entry.source();
        }
    }

    private void trimExpired(Deque<SourceEntry> queue, Instant now) {
        while (!queue.isEmpty()) {
            SourceEntry head = queue.peekFirst();
            if (head == null || !head.expiresAt().isBefore(now)) {
                return;
            }
            queue.pollFirst();
        }
    }

    private EventKey keyFor(String topic, String payload) {
        String normalizedTopic = normalizeText(topic);
        if (normalizedTopic == null) {
            return null;
        }
        return new EventKey(normalizedTopic, payload == null ? "" : payload);
    }

    private String normalizeText(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private record EventKey(String topic, String payload) {
    }

    private record SourceEntry(String source, Instant expiresAt) {
    }
}

