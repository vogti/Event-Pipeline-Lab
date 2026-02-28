package ch.marcovogt.epl.taskscenarioengine;

public record TaskDefinition(
        String id,
        String titleDe,
        String titleEn,
        String descriptionDe,
        String descriptionEn,
        String activeDescriptionDe,
        String activeDescriptionEn,
        TaskCapabilities studentCapabilities,
        PipelineTaskConfig pipeline
) {
}
