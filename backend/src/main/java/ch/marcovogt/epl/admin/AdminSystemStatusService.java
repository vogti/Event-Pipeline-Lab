package ch.marcovogt.epl.admin;

import com.sun.management.OperatingSystemMXBean;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.realtimewebsocket.AdminWebSocketBroadcaster;
import ch.marcovogt.epl.realtimewebsocket.StudentWebSocketBroadcaster;
import java.lang.management.ManagementFactory;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AdminSystemStatusService {

    private static final String EVENT_COUNT_BY_MINUTE_SQL = """
            select date_trunc('minute', ingest_ts) as minute_ts, count(*)::bigint as event_count
            from canonical_event
            where ingest_ts >= ?
            group by minute_ts
            order by minute_ts asc
            """;

    private final JdbcTemplate jdbcTemplate;
    private final EventFeedService eventFeedService;
    private final AdminWebSocketBroadcaster adminWebSocketBroadcaster;
    private final StudentWebSocketBroadcaster studentWebSocketBroadcaster;
    private final CloudflareTunnelStatusService cloudflareTunnelStatusService;
    private final Clock clock;

    public AdminSystemStatusService(
            JdbcTemplate jdbcTemplate,
            EventFeedService eventFeedService,
            AdminWebSocketBroadcaster adminWebSocketBroadcaster,
            StudentWebSocketBroadcaster studentWebSocketBroadcaster,
            CloudflareTunnelStatusService cloudflareTunnelStatusService
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.eventFeedService = eventFeedService;
        this.adminWebSocketBroadcaster = adminWebSocketBroadcaster;
        this.studentWebSocketBroadcaster = studentWebSocketBroadcaster;
        this.cloudflareTunnelStatusService = cloudflareTunnelStatusService;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public AdminSystemStatusResponse snapshot() {
        Instant now = Instant.now(clock);
        Instant nowMinute = now.truncatedTo(ChronoUnit.MINUTES);
        List<SystemStatusEventRatePoint> eventRate = loadEventRateLast10Minutes(nowMinute);
        ResourceMetrics metrics = readResourceMetrics();
        long postgresSizeBytes = readPostgresSizeBytes();
        long storedEventCount = readCanonicalEventCount();
        int adminSessions = adminWebSocketBroadcaster.activeSessionCount();
        int studentSessions = studentWebSocketBroadcaster.activeSessionCount();
        CloudflareTunnelStatus cloudflareTunnel = cloudflareTunnelStatusService.snapshot();

        return new AdminSystemStatusResponse(
                now,
                eventRate,
                metrics.cpuLoadPct(),
                metrics.ramUsedBytes(),
                metrics.ramTotalBytes(),
                postgresSizeBytes,
                storedEventCount,
                new WebSocketSessionStats(adminSessions, studentSessions, adminSessions + studentSessions),
                cloudflareTunnel
        );
    }

    @Transactional
    public ResetEventsResponse resetEvents() {
        long existingEvents = readCanonicalEventCount();
        jdbcTemplate.execute("truncate table canonical_event");
        eventFeedService.clearLiveBuffer();
        return new ResetEventsResponse(existingEvents, Instant.now(clock));
    }

    private List<SystemStatusEventRatePoint> loadEventRateLast10Minutes(Instant nowMinute) {
        Instant windowStart = nowMinute.minus(9, ChronoUnit.MINUTES);
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                EVENT_COUNT_BY_MINUTE_SQL,
                Timestamp.from(windowStart)
        );
        Map<Instant, Long> countsByMinute = new HashMap<>();
        for (Map<String, Object> row : rows) {
            Instant minuteTs = toInstant(row.get("minute_ts"));
            Number countValue = (Number) row.get("event_count");
            if (minuteTs == null || countValue == null) {
                continue;
            }
            countsByMinute.put(minuteTs.truncatedTo(ChronoUnit.MINUTES), countValue.longValue());
        }

        List<SystemStatusEventRatePoint> points = new ArrayList<>(10);
        for (int index = 0; index < 10; index += 1) {
            Instant bucketTs = windowStart.plus(index, ChronoUnit.MINUTES);
            long count = countsByMinute.getOrDefault(bucketTs, 0L);
            points.add(new SystemStatusEventRatePoint(bucketTs, count));
        }
        return points;
    }

    private ResourceMetrics readResourceMetrics() {
        java.lang.management.OperatingSystemMXBean osBean = ManagementFactory.getOperatingSystemMXBean();
        if (!(osBean instanceof OperatingSystemMXBean extended)) {
            return new ResourceMetrics(null, null, null);
        }

        Double cpuLoadPct = null;
        double rawCpuLoad = extended.getCpuLoad();
        if (rawCpuLoad >= 0) {
            cpuLoadPct = Math.round(rawCpuLoad * 1000d) / 10d;
        }

        Long ramTotalBytes = null;
        Long ramUsedBytes = null;
        long totalMemory = extended.getTotalMemorySize();
        long freeMemory = extended.getFreeMemorySize();
        if (totalMemory > 0 && freeMemory >= 0) {
            ramTotalBytes = totalMemory;
            ramUsedBytes = Math.max(0, totalMemory - freeMemory);
        }

        return new ResourceMetrics(cpuLoadPct, ramUsedBytes, ramTotalBytes);
    }

    private long readPostgresSizeBytes() {
        Long size = jdbcTemplate.queryForObject(
                "select pg_database_size(current_database())",
                Long.class
        );
        return size == null ? 0L : size;
    }

    private long readCanonicalEventCount() {
        Long count = jdbcTemplate.queryForObject("select count(*) from canonical_event", Long.class);
        return count == null ? 0L : count;
    }

    private Instant toInstant(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Instant instant) {
            return instant;
        }
        if (raw instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        if (raw instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant();
        }
        if (raw instanceof LocalDateTime localDateTime) {
            return localDateTime.toInstant(ZoneOffset.UTC);
        }
        return null;
    }

    private record ResourceMetrics(
            Double cpuLoadPct,
            Long ramUsedBytes,
            Long ramTotalBytes
    ) {
    }
}
