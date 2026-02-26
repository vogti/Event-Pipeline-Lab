package ch.marcovogt.epl.pipelinebuilder;

public record PipelineStatePayload(
        PipelineInputSection input,
        PipelineProcessingSection processing,
        PipelineSinkSection sink
) {
}
