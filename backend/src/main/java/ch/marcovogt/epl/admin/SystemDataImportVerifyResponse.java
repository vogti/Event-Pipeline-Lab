package ch.marcovogt.epl.admin;

import java.time.Instant;
import java.util.List;

public record SystemDataImportVerifyResponse(
        boolean valid,
        Integer schemaVersion,
        Instant exportedAt,
        List<SystemDataImportPartInfo> availableParts,
        List<String> errors,
        List<String> warnings
) {
}

