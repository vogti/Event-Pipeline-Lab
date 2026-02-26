package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelineProcessingSection(
        String mode,
        int slotCount,
        List<PipelineSlot> slots
) {
}
