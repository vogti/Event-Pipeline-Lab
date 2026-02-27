package ch.marcovogt.epl.admin;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record ReorderTasksRequest(
        @NotEmpty List<@NotBlank String> taskIds
) {
}
