package ch.marcovogt.epl.taskscenarioengine;

public record TaskDefinition(
        String id,
        String titleDe,
        String titleEn,
        String descriptionDe,
        String descriptionEn,
        TaskCapabilities studentCapabilities,
        PipelineTaskConfig pipeline
) {
}
