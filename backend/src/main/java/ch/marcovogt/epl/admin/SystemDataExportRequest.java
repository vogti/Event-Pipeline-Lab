package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotEmpty;
import java.util.Set;

public record SystemDataExportRequest(
        @NotEmpty Set<SystemDataPart> parts
) {
}

