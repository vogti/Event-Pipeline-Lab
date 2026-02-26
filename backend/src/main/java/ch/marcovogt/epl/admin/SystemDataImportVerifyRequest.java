package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotNull;

public record SystemDataImportVerifyRequest(
        @NotNull SystemDataTransferDocument document
) {
}

