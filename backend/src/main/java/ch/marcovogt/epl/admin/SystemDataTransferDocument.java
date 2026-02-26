package ch.marcovogt.epl.admin;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.Map;

public record SystemDataTransferDocument(
        int schemaVersion,
        Instant exportedAt,
        Map<String, JsonNode> parts
) {
}

