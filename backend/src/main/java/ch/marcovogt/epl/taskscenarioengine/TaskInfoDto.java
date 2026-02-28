package ch.marcovogt.epl.taskscenarioengine;

public record TaskInfoDto(
        String id,
        String titleDe,
        String titleEn,
        String descriptionDe,
        String descriptionEn,
        String activeDescriptionDe,
        String activeDescriptionEn,
        boolean active,
        boolean lecturerMode,
        boolean deletable
) {
    public static TaskInfoDto from(TaskDefinition definition, boolean active) {
        boolean lecturerMode = definition.pipeline().lecturerMode();
        return new TaskInfoDto(
                definition.id(),
                definition.titleDe(),
                definition.titleEn(),
                definition.descriptionDe(),
                definition.descriptionEn(),
                definition.activeDescriptionDe(),
                definition.activeDescriptionEn(),
                active,
                lecturerMode,
                !lecturerMode
        );
    }
}
