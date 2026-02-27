package ch.marcovogt.epl.pipelinebuilder;

public record PipelineSinkRuntimeUpdateDto(
        String taskId,
        String groupKey,
        PipelineSinkRuntimeSection sinkRuntime
) {
}
