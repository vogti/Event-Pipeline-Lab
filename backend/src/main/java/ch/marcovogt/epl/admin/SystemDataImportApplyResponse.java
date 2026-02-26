package ch.marcovogt.epl.admin;

import java.time.Instant;
import java.util.List;

public record SystemDataImportApplyResponse(
        Instant importedAt,
        List<SystemDataImportPartInfo> importedParts
) {
}

