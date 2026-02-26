package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.PartitionInfo;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

@Service
public class PipelineLogModeService implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(PipelineLogModeService.class);
    private static final List<String> LIVE_MODE_BADGES = List.of(
            "realtime_pubsub",
            "no_offset_replay"
    );
    private static final List<String> LOG_MODE_BADGES = List.of(
            "retention",
            "replay",
            "offsets",
            "consumer_groups"
    );

    private final ObjectMapper objectMapper;
    private final boolean enabled;
    private final String bootstrapServers;
    private final String topic;
    private final String clientId;
    private final int replayDefaultMaxRecords;
    private volatile KafkaProducer<String, String> producer;

    public PipelineLogModeService(
            ObjectMapper objectMapper,
            @Value("${epl.log-mode.kafka.enabled:false}") boolean enabled,
            @Value("${epl.log-mode.kafka.bootstrap-servers:kafka:9092}") String bootstrapServers,
            @Value("${epl.log-mode.kafka.topic:epl.events.log}") String topic,
            @Value("${epl.log-mode.kafka.client-id:epl-log-mode}") String clientId,
            @Value("${epl.log-mode.kafka.replay-default-max-records:200}") int replayDefaultMaxRecords
    ) {
        this.objectMapper = objectMapper;
        this.enabled = enabled;
        this.bootstrapServers = bootstrapServers;
        this.topic = topic;
        this.clientId = clientId;
        this.replayDefaultMaxRecords = Math.max(1, Math.min(replayDefaultMaxRecords, 1000));
    }

    public boolean enabled() {
        return enabled;
    }

    public List<String> liveModeFeatureBadges() {
        return LIVE_MODE_BADGES;
    }

    public List<String> logModeFeatureBadges() {
        return LOG_MODE_BADGES;
    }

    public void publish(CanonicalEventDto event) {
        if (!enabled) {
            return;
        }
        try {
            String payload = objectMapper.writeValueAsString(event);
            ProducerRecord<String, String> record = new ProducerRecord<>(topic, event.groupKey(), payload);
            producer().send(record, (metadata, exception) -> {
                if (exception != null) {
                    log.warn("Kafka log-mode publish failed: {}", exception.getMessage());
                }
            });
        } catch (Exception ex) {
            log.warn("Kafka log-mode serialization/publish failed: {}", ex.getMessage());
        }
    }

    public PipelineLogModeStatusDto status() {
        if (!enabled) {
            return new PipelineLogModeStatusDto(
                    false,
                    false,
                    false,
                    topic,
                    null,
                    null,
                    replayDefaultMaxRecords,
                    LIVE_MODE_BADGES,
                    "Kafka log mode disabled"
            );
        }

        try (KafkaConsumer<String, String> consumer = consumer("status")) {
            Set<TopicPartition> partitions = partitions(consumer);
            if (partitions.isEmpty()) {
                return new PipelineLogModeStatusDto(
                        true,
                        false,
                        true,
                        topic,
                        null,
                        null,
                        replayDefaultMaxRecords,
                        LOG_MODE_BADGES,
                        "Topic has no partitions yet"
                );
            }

            Map<TopicPartition, Long> beginning = consumer.beginningOffsets(partitions, Duration.ofSeconds(2));
            Map<TopicPartition, Long> end = consumer.endOffsets(partitions, Duration.ofSeconds(2));

            Long earliest = beginning.values().stream().min(Long::compareTo).orElse(0L);
            Long latestExclusive = end.values().stream().max(Long::compareTo).orElse(0L);
            Long latest = latestExclusive <= 0 ? null : latestExclusive - 1L;

            return new PipelineLogModeStatusDto(
                    true,
                    true,
                    true,
                    topic,
                    earliest,
                    latest,
                    replayDefaultMaxRecords,
                    LOG_MODE_BADGES,
                    "Kafka log mode active"
            );
        } catch (Exception ex) {
            return new PipelineLogModeStatusDto(
                    true,
                    false,
                    true,
                    topic,
                    null,
                    null,
                    replayDefaultMaxRecords,
                    LOG_MODE_BADGES,
                    "Kafka unavailable: " + ex.getMessage()
            );
        }
    }

    public PipelineLogReplayResponse replay(String groupKey, Long fromOffset, Integer maxRecords) {
        if (!enabled) {
            throw new ResponseStatusException(BAD_REQUEST, "Kafka log mode is not enabled");
        }
        if (groupKey == null || groupKey.isBlank()) {
            throw new ResponseStatusException(BAD_REQUEST, "groupKey must not be blank");
        }
        long normalizedFromOffset = fromOffset == null ? -1L : Math.max(0L, fromOffset);
        int normalizedMaxRecords = maxRecords == null
                ? replayDefaultMaxRecords
                : Math.max(1, Math.min(maxRecords, 1000));

        List<PipelineLogReplayRecordDto> records = new ArrayList<>();
        long maxOffset = -1L;
        try (KafkaConsumer<String, String> consumer = consumer("replay")) {
            Set<TopicPartition> partitions = partitions(consumer);
            if (partitions.isEmpty()) {
                return new PipelineLogReplayResponse(
                        topic,
                        groupKey,
                        normalizedFromOffset < 0 ? null : normalizedFromOffset,
                        null,
                        0,
                        List.of()
                );
            }

            Map<TopicPartition, Long> beginning = consumer.beginningOffsets(partitions, Duration.ofSeconds(2));
            Map<TopicPartition, Long> end = consumer.endOffsets(partitions, Duration.ofSeconds(2));

            for (TopicPartition partition : partitions) {
                long begin = beginning.getOrDefault(partition, 0L);
                long endExclusive = end.getOrDefault(partition, begin);
                if (normalizedFromOffset < 0) {
                    consumer.seek(partition, begin);
                } else if (endExclusive <= begin) {
                    consumer.seek(partition, begin);
                } else {
                    long maxSeek = Math.max(begin, endExclusive - 1);
                    long seek = Math.max(begin, Math.min(normalizedFromOffset, maxSeek));
                    consumer.seek(partition, seek);
                }
            }

            int idlePolls = 0;
            while (records.size() < normalizedMaxRecords && idlePolls < 4) {
                var polled = consumer.poll(Duration.ofMillis(350));
                if (polled.isEmpty()) {
                    idlePolls += 1;
                    continue;
                }
                idlePolls = 0;

                for (ConsumerRecord<String, String> record : polled) {
                    CanonicalEventDto event = decode(record.value());
                    if (event == null) {
                        continue;
                    }
                    if (!groupKey.equals(event.groupKey())) {
                        continue;
                    }
                    records.add(new PipelineLogReplayRecordDto(
                            record.partition(),
                            record.offset(),
                            Instant.ofEpochMilli(record.timestamp()),
                            event
                    ));
                    maxOffset = Math.max(maxOffset, record.offset());
                    if (records.size() >= normalizedMaxRecords) {
                        break;
                    }
                }
            }
        } catch (Exception ex) {
            throw new ResponseStatusException(BAD_REQUEST, "Kafka replay failed: " + ex.getMessage(), ex);
        }

        return new PipelineLogReplayResponse(
                topic,
                groupKey,
                normalizedFromOffset < 0 ? null : normalizedFromOffset,
                maxOffset < 0 ? null : maxOffset + 1L,
                records.size(),
                List.copyOf(records)
        );
    }

    @Override
    public void destroy() {
        KafkaProducer<String, String> current = producer;
        if (current != null) {
            try {
                current.close(Duration.ofSeconds(2));
            } catch (Exception ignored) {
                // ignore
            }
        }
    }

    private KafkaProducer<String, String> producer() {
        KafkaProducer<String, String> current = producer;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (producer == null) {
                producer = new KafkaProducer<>(producerProps());
            }
            return producer;
        }
    }

    private Set<TopicPartition> partitions(KafkaConsumer<String, String> consumer) {
        List<PartitionInfo> infos = consumer.partitionsFor(topic, Duration.ofSeconds(2));
        if (infos == null || infos.isEmpty()) {
            return Set.of();
        }
        Set<TopicPartition> partitions = infos.stream()
                .map(info -> new TopicPartition(info.topic(), info.partition()))
                .collect(Collectors.toSet());
        consumer.assign(partitions);
        return partitions;
    }

    private KafkaConsumer<String, String> consumer(String purpose) {
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, clientId + "-" + purpose + "-" + UUID.randomUUID());
        properties.put(ConsumerConfig.CLIENT_ID_CONFIG, clientId + "-" + purpose);
        properties.put(ConsumerConfig.REQUEST_TIMEOUT_MS_CONFIG, "5000");
        properties.put(AdminClientConfig.RETRIES_CONFIG, "0");
        return new KafkaConsumer<>(properties);
    }

    private Properties producerProps() {
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, "true");
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, clientId + "-producer");
        properties.put(ProducerConfig.RETRIES_CONFIG, "2");
        return properties;
    }

    private CanonicalEventDto decode(String raw) {
        try {
            return objectMapper.readValue(raw, CanonicalEventDto.class);
        } catch (Exception ex) {
            log.debug("Skipping invalid Kafka log entry: {}", ex.getMessage());
            return null;
        }
    }
}

