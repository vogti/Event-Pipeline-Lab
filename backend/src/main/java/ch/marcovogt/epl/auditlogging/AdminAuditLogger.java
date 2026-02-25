package ch.marcovogt.epl.auditlogging;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class AdminAuditLogger {

    private static final Logger log = LoggerFactory.getLogger(AdminAuditLogger.class);

    private final AuditEntryRepository auditEntryRepository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public AdminAuditLogger(AuditEntryRepository auditEntryRepository, ObjectMapper objectMapper) {
        this.auditEntryRepository = auditEntryRepository;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public void logAction(String action, String actor, Map<String, Object> details) {
        AuditEntry entry = new AuditEntry();
        entry.setAction(action);
        entry.setActor(actor);
        entry.setDetailsJson(serialize(details));
        entry.setCreatedAt(Instant.now(clock));
        auditEntryRepository.save(entry);

        log.info("AUDIT action={} actor={} details={}", action, actor, details);
    }

    private String serialize(Map<String, Object> details) {
        try {
            return objectMapper.writeValueAsString(details);
        } catch (JsonProcessingException ex) {
            return "{}";
        }
    }
}
