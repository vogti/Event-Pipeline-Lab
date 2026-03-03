package ch.marcovogt.epl.taskscenarioengine;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class TaskCatalog {

    private static final List<String> PBV_BLOCKS_BASIC = List.of(
            "FILTER_DEVICE",
            "FILTER_TOPIC",
            "FILTER_PAYLOAD",
            "CONDITIONAL_PAYLOAD",
            "EXTRACT_VALUE",
            "TRANSFORM_PAYLOAD"
    );

    private static final List<String> PBV_BLOCKS_INTERMEDIATE = List.of(
            "FILTER_DEVICE",
            "FILTER_TOPIC",
            "FILTER_PAYLOAD",
            "CONDITIONAL_PAYLOAD",
            "EXTRACT_VALUE",
            "TRANSFORM_PAYLOAD",
            "FILTER_RATE_LIMIT",
            "DEDUP",
            "WINDOW_AGGREGATE"
    );

    private static final List<String> PBV_BLOCKS_ADVANCED = List.of(
            "FILTER_DEVICE",
            "FILTER_TOPIC",
            "FILTER_PAYLOAD",
            "CONDITIONAL_PAYLOAD",
            "EXTRACT_VALUE",
            "TRANSFORM_PAYLOAD",
            "FILTER_RATE_LIMIT",
            "DEDUP",
            "WINDOW_AGGREGATE",
            "MICRO_BATCH"
    );

    private final Map<String, TaskDefinition> tasks;

    public TaskCatalog() {
        Map<String, TaskDefinition> entries = new LinkedHashMap<>();

        entries.put(
                "task_intro",
                new TaskDefinition(
                        "task_intro",
                        "Einführung: Eigene Ereignisse",
                        "Intro: Own Events",
                        "Nur eigene Gruppenereignisse, keine Befehle.",
                        "Only own group events, no commands.",
                        "Nur eigene Gruppenereignisse, keine Befehle.",
                        "Only own group events, no commands.",
                        new TaskCapabilities(
                                false,
                                false,
                                false,
                                false,
                                false,
                                List.of("displayMode", "sensorFocus"),
                                List.of(),
                                StudentDeviceScope.OWN_DEVICE,
                                StudentDeviceScope.OWN_DEVICE
                        ),
                        pipelineConfig(
                                true,
                                false,
                                PBV_BLOCKS_BASIC,
                                "LIVE_MQTT",
                                "GROUP_DEVICES",
                                StudentDeviceScope.OWN_DEVICE,
                                StudentDeviceScope.OWN_DEVICE,
                                false,
                                List.of(),
                                List.of(),
                                List.of("DEVICE_CONTROL"),
                                "Aktiviere LED grün bei schwarzem Button-Event / Trigger green LED on black button event"
                        )
                )
        );

        entries.put(
                "task_room_view",
                new TaskDefinition(
                        "task_room_view",
                        "Raumsicht: Alle Ereignisse",
                        "Room View: All Events",
                        "Alle Gruppenereignisse sichtbar, Analyse mit Filtern.",
                        "All group events visible, analysis with filters.",
                        "Alle Gruppenereignisse sichtbar, Analyse mit Filtern.",
                        "All group events visible, analysis with filters.",
                        new TaskCapabilities(
                                true,
                                false,
                                false,
                                true,
                                true,
                                List.of("displayMode", "sensorFocus", "topicPreset"),
                                List.of(),
                                StudentDeviceScope.ALL_DEVICES,
                                StudentDeviceScope.OWN_DEVICE
                        ),
                        pipelineConfig(
                                true,
                                false,
                                PBV_BLOCKS_INTERMEDIATE,
                                "LIVE_MQTT",
                                "ALL_DEVICES",
                                StudentDeviceScope.ALL_DEVICES,
                                StudentDeviceScope.OWN_DEVICE,
                                false,
                                List.of("eventType != status.system"),
                                List.of("delay:300ms"),
                                List.of("VIRTUAL_SIGNAL"),
                                "Erzeuge ein Gruppensignal bei hoher Aktivität / Trigger group signal on high activity"
                        )
                )
        );

        entries.put(
                "task_commands",
                new TaskDefinition(
                        "task_commands",
                        "Gerätebefehle",
                        "Device Commands",
                        "Eigene Geräte steuern (LED, Counter-Reset).",
                        "Control own devices (LED, counter reset).",
                        "Eigene Geräte steuern (LED, Counter-Reset).",
                        "Control own devices (LED, counter reset).",
                        new TaskCapabilities(
                                false,
                                true,
                                false,
                                true,
                                false,
                                List.of("displayMode", "sensorFocus", "commandPanel", "pipelineStateReset"),
                                List.of("LED_GREEN", "LED_ORANGE", "COUNTER_RESET"),
                                StudentDeviceScope.OWN_DEVICE,
                                StudentDeviceScope.OWN_DEVICE
                        ),
                        pipelineConfig(
                                true,
                                false,
                                PBV_BLOCKS_ADVANCED,
                                "LIVE_MQTT",
                                "GROUP_DEVICES",
                                StudentDeviceScope.OWN_DEVICE,
                                StudentDeviceScope.OWN_DEVICE,
                                false,
                                List.of(),
                                List.of("duplicates:10%"),
                                List.of("DEVICE_CONTROL", "VIRTUAL_SIGNAL"),
                                "Steuere Aktoren robust trotz Duplikaten / Drive actuators robustly under duplicates"
                        )
                )
        );

        entries.put(
                "task_lecturer_mode",
                new TaskDefinition(
                        "task_lecturer_mode",
                        "Dozierendenmodus",
                        "Lecturer Mode",
                        "Dozierende steuern Input/Sink live; Studierende arbeiten im mittleren Processing-Bereich.",
                        "Lecturer controls input/sink live while students work in the processing section.",
                        "Dozierende steuern Input/Sink live; Studierende arbeiten im mittleren Processing-Bereich.",
                        "Lecturer controls input/sink live while students work in the processing section.",
                        new TaskCapabilities(
                                true,
                                true,
                                false,
                                true,
                                true,
                                List.of(
                                        "displayMode",
                                        "sensorFocus",
                                        "commandPanel",
                                        "topicPreset",
                                        "pipelineStateReset"
                                ),
                                List.of("LED_GREEN", "LED_ORANGE", "COUNTER_RESET"),
                                StudentDeviceScope.ALL_DEVICES,
                                StudentDeviceScope.OWN_DEVICE
                        ),
                        pipelineConfig(
                                true,
                                true,
                                PBV_BLOCKS_ADVANCED,
                                "LIVE_MQTT",
                                "ALL_DEVICES",
                                StudentDeviceScope.ALL_DEVICES,
                                StudentDeviceScope.OWN_DEVICE,
                                false,
                                List.of(),
                                List.of("delay:500ms", "duplicates:15%"),
                                List.of("DEVICE_CONTROL", "VIRTUAL_SIGNAL", "STORAGE"),
                                "Lehrdemo: Linke/Rechte Seite live variieren / Lecture demo with live input and sink changes"
                        )
                )
        );

        this.tasks = Map.copyOf(entries);
    }

    public List<TaskDefinition> all() {
        return List.copyOf(tasks.values());
    }

    public Optional<TaskDefinition> findById(String id) {
        return Optional.ofNullable(tasks.get(id));
    }

    public String defaultTaskId() {
        return "task_intro";
    }

    private PipelineTaskConfig pipelineConfig(
            boolean visibleToStudents,
            boolean lecturerMode,
            List<String> allowedBlocks,
            String inputMode,
            String deviceScope,
            StudentDeviceScope studentEventVisibilityScope,
            StudentDeviceScope studentCommandTargetScope,
            boolean studentSendEventEnabled,
            List<String> ingestFilters,
            List<String> scenarioOverlays,
            List<String> sinkTargets,
            String sinkGoal
    ) {
        return new PipelineTaskConfig(
                visibleToStudents,
                lecturerMode,
                5,
                List.copyOf(allowedBlocks),
                inputMode,
                deviceScope,
                studentEventVisibilityScope,
                studentCommandTargetScope,
                studentSendEventEnabled,
                false,
                List.copyOf(ingestFilters),
                List.copyOf(scenarioOverlays),
                List.copyOf(sinkTargets),
                sinkGoal
        );
    }
}
