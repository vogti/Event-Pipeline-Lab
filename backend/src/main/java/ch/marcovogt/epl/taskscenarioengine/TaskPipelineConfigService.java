package ch.marcovogt.epl.taskscenarioengine;

import ch.marcovogt.epl.pipelinebuilder.PipelineBlockLibrary;
import ch.marcovogt.epl.pipelinebuilder.PipelineScenarioOverlayCodec;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

@Service
public class TaskPipelineConfigService {

    public static final int MIN_SLOT_COUNT = 4;
    public static final int MAX_SLOT_COUNT = 6;

    private final TaskPipelineConfigStateRepository repository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public TaskPipelineConfigService(TaskPipelineConfigStateRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public TaskDefinition applyOverrides(TaskDefinition definition) {
        var override = repository.findById(definition.id()).orElse(null);
        if (override == null) {
            return definition;
        }

        PipelineTaskConfig base = definition.pipeline();
        List<String> allowedBlocks = normalizeAllowedBlocks(parseAllowedBlocks(override.getAllowedProcessingBlocksJson()));
        String rawScenarioOverlays = override.getScenarioOverlaysJson();
        List<String> scenarioOverlays = rawScenarioOverlays == null
                ? normalizeScenarioOverlays(base.scenarioOverlays())
                : normalizeScenarioOverlays(parseScenarioOverlays(rawScenarioOverlays));
        int slotCount = clampSlotCount(override.getSlotCount());
        PipelineTaskConfig overridden = new PipelineTaskConfig(
                override.isVisibleToStudents(),
                base.lecturerMode(),
                slotCount,
                allowedBlocks.isEmpty() ? base.allowedProcessingBlocks() : allowedBlocks,
                base.inputMode(),
                base.deviceScope(),
                base.ingestFilters(),
                scenarioOverlays,
                base.sinkTargets(),
                base.sinkGoal()
        );

        return new TaskDefinition(
                definition.id(),
                definition.titleDe(),
                definition.titleEn(),
                definition.descriptionDe(),
                definition.descriptionEn(),
                definition.studentCapabilities(),
                overridden
        );
    }

    @Transactional(readOnly = true)
    public TaskPipelineConfigDto getConfig(TaskDefinition definition) {
        var override = repository.findById(definition.id()).orElse(null);
        PipelineTaskConfig pipeline = definition.pipeline();
        return new TaskPipelineConfigDto(
                definition.id(),
                pipeline.visibleToStudents(),
                clampSlotCount(pipeline.slotCount()),
                normalizeAllowedBlocks(pipeline.allowedProcessingBlocks()),
                normalizeScenarioOverlays(pipeline.scenarioOverlays()),
                availableBlocks(),
                MIN_SLOT_COUNT,
                MAX_SLOT_COUNT,
                pipeline.lecturerMode(),
                override != null,
                override == null ? null : override.getUpdatedAt(),
                override == null ? null : override.getUpdatedBy()
        );
    }

    @Transactional
    public TaskPipelineConfigDto update(
            TaskDefinition baselineDefinition,
            boolean visibleToStudents,
            int slotCount,
            List<String> allowedProcessingBlocks,
            List<String> scenarioOverlays,
            String actor
    ) {
        int normalizedSlotCount = clampSlotCountStrict(slotCount);
        List<String> normalizedAllowedBlocks = normalizeAllowedBlocksStrict(allowedProcessingBlocks);
        List<String> normalizedScenarioOverlays = normalizeScenarioOverlaysStrict(scenarioOverlays);

        TaskPipelineConfigState state = repository.findById(baselineDefinition.id())
                .orElseGet(() -> {
                    TaskPipelineConfigState created = new TaskPipelineConfigState();
                    created.setTaskId(baselineDefinition.id());
                    return created;
                });

        state.setVisibleToStudents(visibleToStudents);
        state.setSlotCount(normalizedSlotCount);
        state.setAllowedProcessingBlocksJson(serializeAllowedBlocks(normalizedAllowedBlocks));
        state.setScenarioOverlaysJson(serializeScenarioOverlays(normalizedScenarioOverlays));
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(actor == null || actor.isBlank() ? "system" : actor);
        repository.save(state);

        TaskDefinition effective = applyOverrides(baselineDefinition);
        return getConfig(effective);
    }

    private List<String> parseAllowedBlocks(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        try {
            @SuppressWarnings("unchecked")
            List<String> parsed = objectMapper.readValue(raw, List.class);
            return parsed == null ? List.of() : parsed;
        } catch (JsonProcessingException ex) {
            return List.of();
        }
    }

    private List<String> parseScenarioOverlays(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        try {
            @SuppressWarnings("unchecked")
            List<String> parsed = objectMapper.readValue(raw, List.class);
            return parsed == null ? List.of() : parsed;
        } catch (JsonProcessingException ex) {
            return List.of();
        }
    }

    private String serializeAllowedBlocks(List<String> allowedBlocks) {
        try {
            return objectMapper.writeValueAsString(allowedBlocks);
        } catch (JsonProcessingException ex) {
            return "[]";
        }
    }

    private String serializeScenarioOverlays(List<String> scenarioOverlays) {
        try {
            return objectMapper.writeValueAsString(scenarioOverlays);
        } catch (JsonProcessingException ex) {
            return "[]";
        }
    }

    private int clampSlotCount(int slotCount) {
        if (slotCount < MIN_SLOT_COUNT) {
            return MIN_SLOT_COUNT;
        }
        if (slotCount > MAX_SLOT_COUNT) {
            return MAX_SLOT_COUNT;
        }
        return slotCount;
    }

    private int clampSlotCountStrict(int slotCount) {
        int normalized = clampSlotCount(slotCount);
        if (normalized != slotCount) {
            throw new ResponseStatusException(
                    BAD_REQUEST,
                    "slotCount out of allowed range: " + MIN_SLOT_COUNT + "-" + MAX_SLOT_COUNT
            );
        }
        return normalized;
    }

    private List<String> availableBlocks() {
        return PipelineBlockLibrary.allBlocks().stream()
                .filter(block -> !PipelineBlockLibrary.NONE.equals(block))
                .toList();
    }

    private List<String> normalizeAllowedBlocks(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String block : raw) {
            if (block == null) {
                continue;
            }
            String candidate = block.trim().toUpperCase(Locale.ROOT);
            if (candidate.isEmpty() || PipelineBlockLibrary.NONE.equals(candidate)) {
                continue;
            }
            if (PipelineBlockLibrary.isKnown(candidate)) {
                normalized.add(candidate);
            }
        }
        if (normalized.isEmpty()) {
            return List.of();
        }
        return List.copyOf(normalized);
    }

    private List<String> normalizeAllowedBlocksStrict(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "allowedProcessingBlocks must not be empty");
        }
        List<String> normalized = normalizeAllowedBlocks(raw);
        if (normalized.isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "No valid block types in allowedProcessingBlocks");
        }

        Set<String> requested = new LinkedHashSet<>();
        for (String entry : raw) {
            if (entry == null) {
                continue;
            }
            String candidate = entry.trim().toUpperCase(Locale.ROOT);
            if (!candidate.isEmpty()) {
                requested.add(candidate);
            }
        }

        List<String> unknown = new ArrayList<>();
        for (String requestedBlock : requested) {
            if (PipelineBlockLibrary.NONE.equals(requestedBlock)) {
                continue;
            }
            if (!PipelineBlockLibrary.isKnown(requestedBlock)) {
                unknown.add(requestedBlock);
            }
        }
        if (!unknown.isEmpty()) {
            throw new ResponseStatusException(BAD_REQUEST, "Unknown block types: " + String.join(", ", unknown));
        }
        return normalized;
    }

    private List<String> normalizeScenarioOverlays(List<String> raw) {
        return PipelineScenarioOverlayCodec.normalize(raw, false);
    }

    private List<String> normalizeScenarioOverlaysStrict(List<String> raw) {
        if (raw == null) {
            return List.of();
        }
        return PipelineScenarioOverlayCodec.normalize(raw, true);
    }
}
