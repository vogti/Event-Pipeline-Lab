package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.Set;

public record SystemDataImportApplyRequest(
        @NotNull SystemDataTransferDocument document,
        @NotEmpty Set<SystemDataPart> selectedParts
) {
}

