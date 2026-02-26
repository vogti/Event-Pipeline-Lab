package ch.marcovogt.epl.pipelinebuilder;

import java.util.List;

public record PipelinePermissions(
        boolean visible,
        boolean inputEditable,
        boolean processingEditable,
        boolean sinkEditable,
        boolean stateResetAllowed,
        boolean stateRestartAllowed,
        boolean lecturerMode,
        List<String> allowedProcessingBlocks,
        int slotCount
) {
}
