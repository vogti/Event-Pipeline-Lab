package ch.marcovogt.epl.taskscenarioengine;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class TaskCatalog {

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
                        new TaskCapabilities(
                                false,
                                false,
                                false,
                                false,
                                List.of("displayMode", "sensorFocus"),
                                List.of()
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
                        new TaskCapabilities(
                                true,
                                false,
                                true,
                                true,
                                List.of("displayMode", "sensorFocus", "topicPreset"),
                                List.of()
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
                        new TaskCapabilities(
                                false,
                                true,
                                true,
                                false,
                                List.of("displayMode", "sensorFocus", "commandPanel"),
                                List.of("LED_GREEN", "LED_ORANGE", "COUNTER_RESET")
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
}
