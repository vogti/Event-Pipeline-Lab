package ch.marcovogt.epl.externalsources;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExternalStreamSourceService {

    public static final String DEFAULT_WIKIMEDIA_ENDPOINT = "https://stream.wikimedia.org/v2/stream/recentchange";

    private static final Set<String> SUPPORTED_SOURCE_IDS = Set.of(
            ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM
    );
    private static final String COUNT_EVENTS_SINCE_RESET_SQL = """
            select count(*)::bigint
            from canonical_event
            where source = ?
              and ingest_ts >= ?
            """;
    private static final int MAX_ENDPOINT_URL_LENGTH = 1024;
    private static final int MAX_ERROR_LENGTH = 2000;

    private final ExternalStreamSourceStateRepository stateRepository;
    private final JdbcTemplate jdbcTemplate;
    private final Clock clock;
    private final ConcurrentMap<String, ExternalStreamRuntimeStatus> runtimeBySource = new ConcurrentHashMap<>();

    public ExternalStreamSourceService(
            ExternalStreamSourceStateRepository stateRepository,
            JdbcTemplate jdbcTemplate
    ) {
        this.stateRepository = stateRepository;
        this.jdbcTemplate = jdbcTemplate;
        this.clock = Clock.systemUTC();
    }

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void initializeDefaultsOnStartup() {
        ensureDefaults();
    }

    @Transactional
    public List<ExternalStreamSourceDto> listSources() {
        ensureDefaults();
        return stateRepository.findAllByOrderBySourceIdAsc().stream()
                .filter(state -> SUPPORTED_SOURCE_IDS.contains(state.getSourceId()))
                .map(this::toDto)
                .toList();
    }

    @Transactional
    public ExternalStreamSourceDto setEnabled(String sourceId, boolean enabled, String actor) {
        ExternalStreamSourceState state = getOrCreateState(normalizeSourceId(sourceId));
        state.setEnabled(enabled);
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        ExternalStreamSourceState saved = stateRepository.save(state);
        if (!enabled) {
            markRuntimeDisconnected(saved.getSourceId(), null);
        }
        return toDto(saved);
    }

    @Transactional
    public ExternalStreamSourceDto updateEndpointUrl(String sourceId, String endpointUrl, String actor) {
        ExternalStreamSourceState state = getOrCreateState(normalizeSourceId(sourceId));
        state.setEndpointUrl(normalizeEndpointUrl(endpointUrl));
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        ExternalStreamSourceState saved = stateRepository.save(state);
        return toDto(saved);
    }

    @Transactional
    public ExternalStreamSourceDto resetCounter(String sourceId, String actor) {
        ExternalStreamSourceState state = getOrCreateState(normalizeSourceId(sourceId));
        state.setCounterResetAt(Instant.now(clock));
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(normalizeActor(actor));
        ExternalStreamSourceState saved = stateRepository.save(state);
        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public boolean isEnabled(String sourceId) {
        String normalized = normalizeSourceId(sourceId);
        return stateRepository.findById(normalized).map(ExternalStreamSourceState::isEnabled).orElse(false);
    }

    @Transactional(readOnly = true)
    public String endpointUrl(String sourceId) {
        String normalized = normalizeSourceId(sourceId);
        return stateRepository.findById(normalized)
                .map(ExternalStreamSourceState::getEndpointUrl)
                .orElse(defaultEndpointUrl(normalized));
    }

    public void markRuntimeConnected(String sourceId) {
        String normalized = normalizeSourceId(sourceId);
        Instant now = Instant.now(clock);
        runtimeBySource.compute(normalized, (ignored, previous) -> new ExternalStreamRuntimeStatus(
                true,
                now,
                previous == null ? null : previous.lastEventAt(),
                now,
                null
        ));
    }

    public void markRuntimeEventReceived(String sourceId, Instant eventTs) {
        String normalized = normalizeSourceId(sourceId);
        Instant observedAt = eventTs == null ? Instant.now(clock) : eventTs;
        runtimeBySource.compute(normalized, (ignored, previous) -> new ExternalStreamRuntimeStatus(
                true,
                previous == null ? observedAt : coalesce(previous.lastConnectedAt(), observedAt),
                observedAt,
                observedAt,
                null
        ));
    }

    public void markRuntimeDisconnected(String sourceId, String lastError) {
        String normalized = normalizeSourceId(sourceId);
        Instant now = Instant.now(clock);
        runtimeBySource.compute(normalized, (ignored, previous) -> new ExternalStreamRuntimeStatus(
                false,
                previous == null ? null : previous.lastConnectedAt(),
                previous == null ? null : previous.lastEventAt(),
                now,
                sanitizeError(lastError)
        ));
    }

    private void ensureDefaults() {
        for (String sourceId : SUPPORTED_SOURCE_IDS) {
            if (stateRepository.existsById(sourceId)) {
                continue;
            }
            ExternalStreamSourceState state = new ExternalStreamSourceState();
            Instant now = Instant.now(clock);
            state.setSourceId(sourceId);
            state.setEnabled(false);
            state.setEndpointUrl(defaultEndpointUrl(sourceId));
            state.setCounterResetAt(now);
            state.setUpdatedAt(now);
            state.setUpdatedBy("system");
            stateRepository.save(state);
        }
    }

    private ExternalStreamSourceState getOrCreateState(String sourceId) {
        return stateRepository.findById(sourceId).orElseGet(() -> {
            ExternalStreamSourceState created = new ExternalStreamSourceState();
            Instant now = Instant.now(clock);
            created.setSourceId(sourceId);
            created.setEnabled(false);
            created.setEndpointUrl(defaultEndpointUrl(sourceId));
            created.setCounterResetAt(now);
            created.setUpdatedAt(now);
            created.setUpdatedBy("system");
            return stateRepository.save(created);
        });
    }

    private ExternalStreamSourceDto toDto(ExternalStreamSourceState state) {
        ExternalStreamRuntimeStatus runtime = runtimeBySource.get(state.getSourceId());
        boolean online = state.isEnabled() && runtime != null && runtime.online();
        Instant counterResetAt = coalesce(state.getCounterResetAt(), Instant.EPOCH);
        return new ExternalStreamSourceDto(
                state.getSourceId(),
                displayNameFor(state.getSourceId()),
                state.isEnabled(),
                state.getEndpointUrl(),
                online,
                runtime == null ? null : runtime.lastConnectedAt(),
                runtime == null ? null : runtime.lastEventAt(),
                runtime == null ? null : runtime.checkedAt(),
                runtime == null ? null : runtime.lastError(),
                readEventsSinceReset(state.getSourceId(), counterResetAt),
                counterResetAt,
                state.getUpdatedAt(),
                state.getUpdatedBy()
        );
    }

    private long readEventsSinceReset(String sourceId, Instant counterResetAt) {
        Long value = jdbcTemplate.queryForObject(
                COUNT_EVENTS_SINCE_RESET_SQL,
                Long.class,
                sourceId,
                Timestamp.from(counterResetAt)
        );
        return value == null ? 0L : value;
    }

    private String normalizeSourceId(String sourceId) {
        if (sourceId == null || sourceId.isBlank()) {
            throw new IllegalArgumentException("sourceId is required");
        }
        String normalized = sourceId.trim().toLowerCase(Locale.ROOT);
        if (!SUPPORTED_SOURCE_IDS.contains(normalized)) {
            throw new IllegalArgumentException("Unsupported stream source: " + normalized);
        }
        return normalized;
    }

    private String normalizeEndpointUrl(String endpointUrl) {
        if (endpointUrl == null || endpointUrl.isBlank()) {
            throw new IllegalArgumentException("endpointUrl is required");
        }
        String normalized = endpointUrl.trim();
        if (normalized.length() > MAX_ENDPOINT_URL_LENGTH) {
            throw new IllegalArgumentException("endpointUrl is too long");
        }
        if (!(normalized.startsWith("http://") || normalized.startsWith("https://"))) {
            throw new IllegalArgumentException("endpointUrl must start with http:// or https://");
        }
        return normalized;
    }

    private String normalizeActor(String actor) {
        if (actor == null || actor.isBlank()) {
            return "admin";
        }
        return actor.trim();
    }

    private Instant coalesce(Instant value, Instant fallback) {
        return value == null ? fallback : value;
    }

    private String sanitizeError(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() <= MAX_ERROR_LENGTH) {
            return normalized;
        }
        return normalized.substring(0, MAX_ERROR_LENGTH);
    }

    private String displayNameFor(String sourceId) {
        return switch (sourceId) {
            case ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM -> "Wikimedia EventStream";
            default -> sourceId;
        };
    }

    private String defaultEndpointUrl(String sourceId) {
        return switch (sourceId) {
            case ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM -> DEFAULT_WIKIMEDIA_ENDPOINT;
            default -> "";
        };
    }
}
