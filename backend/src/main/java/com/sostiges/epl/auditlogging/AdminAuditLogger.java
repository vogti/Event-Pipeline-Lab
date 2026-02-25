package com.sostiges.epl.auditlogging;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class AdminAuditLogger {

    private static final Logger log = LoggerFactory.getLogger(AdminAuditLogger.class);

    public void logAction(String action, String actor, Map<String, Object> details) {
        log.info("AUDIT action={} actor={} details={}", action, actor, details);
    }
}
