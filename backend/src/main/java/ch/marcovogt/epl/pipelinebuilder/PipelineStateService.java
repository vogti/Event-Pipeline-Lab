package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioService;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.taskscenarioengine.PipelineTaskConfig;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinition;
import ch.marcovogt.epl.taskscenarioengine.TaskStateService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.IntStream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

@Service
public class PipelineStateService {

    private static final String GLOBAL_OWNER_KEY = "global";
    private static final Set<String> INPUT_MODES = Set.of("LIVE_MQTT", "LOG_MODE");
    private static final Set<String> DEVICE_SCOPES = Set.of("SINGLE_DEVICE", "GROUP_DEVICES", "ALL_DEVICES");

    private final PipelineStateRepository pipelineStateRepository;
    private final TaskStateService taskStateService;
    private final PipelineObservabilityService pipelineObservabilityService;
    private final FeedScenarioService feedScenarioService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public PipelineStateService(
            PipelineStateRepository pipelineStateRepository,
            TaskStateService taskStateService,
            PipelineObservabilityService pipelineObservabilityService,
            FeedScenarioService feedScenarioService,
            ObjectMapper objectMapper
    ) {
        this.pipelineStateRepository = pipelineStateRepository;
        this.taskStateService = taskStateService;
        this.pipelineObservabilityService = pipelineObservabilityService;
        this.feedScenarioService = feedScenarioService;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public PipelineViewDto getStudentView(SessionPrincipal principal) {
        return getStudentViewForGroup(principal.groupKey());
    }

    @Transactional
    public PipelineViewDto getStudentViewForGroup(String groupKey) {
        String normalizedGroupKey = normalizeGroupKey(groupKey);
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        PipelineStatePayload defaults = defaultPayload(config);

        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, normalizedGroupKey, defaults);
        PipelineStatePayload groupPayload = deserializeOrDefault(groupState.getStateJson(), defaults);

        PipelineState globalState = config.lecturerMode()
                ? loadOrCreate(task.id(), PipelineOwnerType.ADMIN_GLOBAL, GLOBAL_OWNER_KEY, defaults)
                : null;
        PipelineStatePayload effective = effectivePayload(config, groupPayload, globalState, defaults);
        PipelineObservabilityDto observability = pipelineObservabilityService.snapshot(
                task.id(),
                normalizedGroupKey,
                effective.processing()
        );

        return new PipelineViewDto(
                task.id(),
                normalizedGroupKey,
                effective.input(),
                effective.processing(),
                effective.sink(),
                new PipelinePermissions(
                        config.visibleToStudents(),
                        false,
                        config.visibleToStudents(),
                        false,
                        studentStateResetAllowed(task),
                        false,
                        config.lecturerMode(),
                        config.allowedProcessingBlocks(),
                        config.slotCount()
                ),
                observability,
                effectiveRevision(groupState, globalState),
                effectiveUpdatedAt(groupState, globalState),
                effectiveUpdatedBy(groupState, globalState)
        );
    }

    @Transactional
    public PipelineViewDto updateStudentProcessing(SessionPrincipal principal, PipelineProcessingSection processingSection) {
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        if (!config.visibleToStudents()) {
            throw new ResponseStatusException(BAD_REQUEST, "Pipeline builder is disabled for this task");
        }

        String groupKey = principal.groupKey();
        PipelineStatePayload defaults = defaultPayload(config);
        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, groupKey, defaults);
        PipelineStatePayload current = deserializeOrDefault(groupState.getStateJson(), defaults);

        PipelineProcessingSection normalizedProcessing = normalizeProcessing(
                processingSection,
                config.slotCount(),
                config.allowedProcessingBlocks(),
                true
        );

        PipelineStatePayload nextPayload = new PipelineStatePayload(
                current.input(),
                normalizedProcessing,
                current.sink()
        );
        persist(groupState, nextPayload, principal.displayName());
        pipelineObservabilityService.reset(task.id(), groupKey);

        return getStudentViewForGroup(groupKey);
    }

    @Transactional
    public PipelineViewDto getAdminView(String groupKey) {
        String normalizedGroupKey = normalizeGroupKey(groupKey);
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        PipelineStatePayload defaults = defaultPayload(config);

        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, normalizedGroupKey, defaults);
        PipelineStatePayload groupPayload = deserializeOrDefault(groupState.getStateJson(), defaults);

        PipelineState globalState = config.lecturerMode()
                ? loadOrCreate(task.id(), PipelineOwnerType.ADMIN_GLOBAL, GLOBAL_OWNER_KEY, defaults)
                : null;
        PipelineStatePayload effective = effectivePayload(config, groupPayload, globalState, defaults);
        PipelineObservabilityDto observability = pipelineObservabilityService.snapshot(
                task.id(),
                normalizedGroupKey,
                effective.processing()
        );

        return new PipelineViewDto(
                task.id(),
                normalizedGroupKey,
                effective.input(),
                effective.processing(),
                effective.sink(),
                new PipelinePermissions(
                        true,
                        config.lecturerMode(),
                        true,
                        config.lecturerMode(),
                        true,
                        true,
                        config.lecturerMode(),
                        PipelineBlockLibrary.allBlocks(),
                        config.slotCount()
                ),
                observability,
                effectiveRevision(groupState, globalState),
                effectiveUpdatedAt(groupState, globalState),
                effectiveUpdatedBy(groupState, globalState)
        );
    }

    @Transactional
    public PipelineViewDto updateAdminState(SessionPrincipal principal, AdminPipelineUpdateRequest request) {
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        PipelineStatePayload defaults = defaultPayload(config);

        String groupKey = normalizeGroupKey(request.groupKey());
        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, groupKey, defaults);
        PipelineStatePayload groupCurrent = deserializeOrDefault(groupState.getStateJson(), defaults);

        PipelineProcessingSection processing = normalizeProcessing(
                request.processing(),
                config.slotCount(),
                PipelineBlockLibrary.allBlocks(),
                false
        );

        if (!config.lecturerMode()) {
            PipelineStatePayload updatedGroup = new PipelineStatePayload(
                    groupCurrent.input(),
                    processing,
                    groupCurrent.sink()
            );
            persist(groupState, updatedGroup, principal.username());
            pipelineObservabilityService.reset(task.id(), groupKey);
            return getAdminView(groupKey);
        }

        PipelineState globalState = loadOrCreate(task.id(), PipelineOwnerType.ADMIN_GLOBAL, GLOBAL_OWNER_KEY, defaults);
        PipelineStatePayload globalCurrent = deserializeOrDefault(globalState.getStateJson(), defaults);

        PipelineInputSection input = normalizeInput(request.input(), config, globalCurrent.input(), true);
        PipelineSinkSection sink = normalizeSink(request.sink(), globalCurrent.sink());

        PipelineStatePayload updatedGlobal = new PipelineStatePayload(
                input,
                globalCurrent.processing(),
                sink
        );
        persist(globalState, updatedGlobal, principal.username());

        PipelineStatePayload updatedGroup = new PipelineStatePayload(
                groupCurrent.input(),
                processing,
                groupCurrent.sink()
        );
        persist(groupState, updatedGroup, principal.username());
        pipelineObservabilityService.reset(task.id(), groupKey);

        return getAdminView(groupKey);
    }

    @Transactional
    public PipelineObservabilityUpdateDto recordObservabilityEvent(CanonicalEventDto eventDto) {
        String resolvedGroupKey = eventDto.groupKey();
        if (resolvedGroupKey == null || resolvedGroupKey.isBlank()) {
            resolvedGroupKey = DeviceIdMapping.groupKeyForDevice(eventDto.deviceId()).orElse(null);
        }
        if (resolvedGroupKey == null || resolvedGroupKey.isBlank()) {
            return null;
        }

        String groupKey = normalizeGroupKey(resolvedGroupKey);
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        PipelineStatePayload defaults = defaultPayload(config);

        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, groupKey, defaults);
        PipelineStatePayload groupPayload = deserializeOrDefault(groupState.getStateJson(), defaults);

        PipelineState globalState = config.lecturerMode()
                ? loadOrCreate(task.id(), PipelineOwnerType.ADMIN_GLOBAL, GLOBAL_OWNER_KEY, defaults)
                : null;
        PipelineStatePayload effective = effectivePayload(config, groupPayload, globalState, defaults);

        pipelineObservabilityService.recordEvent(task.id(), groupKey, effective.processing(), eventDto);
        PipelineObservabilityDto observability = pipelineObservabilityService.snapshot(
                task.id(),
                groupKey,
                effective.processing()
        );
        return new PipelineObservabilityUpdateDto(task.id(), groupKey, observability);
    }

    @Transactional
    public PipelineViewDto controlAdminState(PipelineStateControlRequest request) {
        String groupKey = normalizeGroupKey(request.groupKey());
        TaskDefinition task = taskStateService.getActiveTask();

        PipelineViewDto view = getAdminView(groupKey);
        applyStateControl(task.id(), groupKey, view.processing(), request.action());
        return getAdminView(groupKey);
    }

    @Transactional
    public PipelineViewDto resetStudentState(SessionPrincipal principal, PipelineStateControlAction action) {
        if (action != PipelineStateControlAction.RESET_STATE) {
            throw new ResponseStatusException(BAD_REQUEST, "Students may only execute RESET_STATE");
        }
        TaskDefinition task = taskStateService.getActiveTask();
        if (!studentStateResetAllowed(task)) {
            throw new ResponseStatusException(BAD_REQUEST, "State reset is not allowed in this task");
        }

        String groupKey = normalizeGroupKey(principal.groupKey());
        PipelineViewDto view = getStudentViewForGroup(groupKey);
        applyStateControl(task.id(), groupKey, view.processing(), action);
        return getStudentViewForGroup(groupKey);
    }

    private void applyStateControl(
            String taskId,
            String groupKey,
            PipelineProcessingSection processing,
            PipelineStateControlAction action
    ) {
        switch (action) {
            case RESET_STATE -> pipelineObservabilityService.resetStateStores(taskId, groupKey, processing);
            case RESTART_STATE_LOST -> pipelineObservabilityService.restart(taskId, groupKey, processing, false);
            case RESTART_STATE_RETAINED -> pipelineObservabilityService.restart(taskId, groupKey, processing, true);
            default -> throw new ResponseStatusException(BAD_REQUEST, "Unsupported state control action");
        }
    }

    private boolean studentStateResetAllowed(TaskDefinition task) {
        return task.studentCapabilities().allowedConfigOptions().stream()
                .anyMatch(option -> "pipelineStateReset".equalsIgnoreCase(option));
    }

    @Transactional
    public List<PipelineViewDto> listStudentViewsForGroups(List<String> groupKeys) {
        List<PipelineViewDto> views = new ArrayList<>();
        for (String groupKey : groupKeys) {
            if (groupKey == null || groupKey.isBlank()) {
                continue;
            }
            views.add(getStudentViewForGroup(groupKey));
        }
        return views;
    }

    @Transactional(readOnly = true)
    public boolean activeTaskLecturerMode() {
        return taskStateService.getActiveTask().pipeline().lecturerMode();
    }

    @Transactional(readOnly = true)
    public boolean hasGroupProgress(String groupKey) {
        String normalizedGroupKey = normalizeGroupKey(groupKey);
        return pipelineStateRepository.existsByOwnerTypeAndOwnerKeyAndRevisionGreaterThan(
                PipelineOwnerType.GROUP,
                normalizedGroupKey,
                0L
        );
    }

    @Transactional
    public int resetGroupProgress(String groupKey) {
        String normalizedGroupKey = normalizeGroupKey(groupKey);
        List<PipelineState> states = pipelineStateRepository.findAllByOwnerTypeAndOwnerKey(
                PipelineOwnerType.GROUP,
                normalizedGroupKey
        );
        if (states.isEmpty()) {
            return 0;
        }

        LinkedHashSet<String> affectedTaskIds = new LinkedHashSet<>();
        for (PipelineState state : states) {
            affectedTaskIds.add(state.getTaskId());
        }

        pipelineStateRepository.deleteAll(states);
        for (String taskId : affectedTaskIds) {
            pipelineObservabilityService.reset(taskId, normalizedGroupKey);
        }
        return states.size();
    }

    @Transactional
    public List<PipelineCompareRowDto> compareForActiveTask(List<String> groupKeys) {
        List<PipelineCompareRowDto> rows = new ArrayList<>();
        for (PipelineViewDto view : listStudentViewsForGroups(groupKeys)) {
            List<String> slotBlocks = IntStream.range(0, view.processing().slotCount())
                    .mapToObj(index -> view.processing().slots().stream()
                            .filter(slot -> slot.index() == index)
                            .findFirst()
                            .map(PipelineSlot::blockType)
                            .orElse(PipelineBlockLibrary.NONE))
                    .toList();

            rows.add(new PipelineCompareRowDto(
                    view.taskId(),
                    view.groupKey(),
                    view.revision(),
                    view.updatedAt(),
                    view.updatedBy(),
                    slotBlocks
            ));
        }
        rows.sort((left, right) -> left.groupKey().compareToIgnoreCase(right.groupKey()));
        return rows;
    }

    private PipelineStatePayload effectivePayload(
            PipelineTaskConfig config,
            PipelineStatePayload groupPayload,
            PipelineState globalState,
            PipelineStatePayload defaults
    ) {
        List<String> globalScenarioOverlays = feedScenarioService.getConfig().scenarioOverlays();
        if (!config.lecturerMode() || globalState == null) {
            PipelineInputSection groupInput = groupPayload.input();
            PipelineInputSection resolvedInput = new PipelineInputSection(
                    groupInput.mode(),
                    groupInput.deviceScope(),
                    groupInput.ingestFilters(),
                    globalScenarioOverlays
            );
            return new PipelineStatePayload(resolvedInput, groupPayload.processing(), defaults.sink());
        }
        PipelineStatePayload globalPayload = deserializeOrDefault(globalState.getStateJson(), defaults);
        PipelineInputSection globalInput = globalPayload.input();
        PipelineInputSection resolvedInput = new PipelineInputSection(
                globalInput.mode(),
                globalInput.deviceScope(),
                globalInput.ingestFilters(),
                globalScenarioOverlays
        );
        return new PipelineStatePayload(resolvedInput, groupPayload.processing(), globalPayload.sink());
    }

    private long effectiveRevision(PipelineState groupState, PipelineState globalState) {
        if (globalState == null) {
            return groupState.getRevision();
        }
        return Math.max(groupState.getRevision(), globalState.getRevision());
    }

    private Instant effectiveUpdatedAt(PipelineState groupState, PipelineState globalState) {
        if (globalState == null) {
            return groupState.getUpdatedAt();
        }
        return globalState.getUpdatedAt().isAfter(groupState.getUpdatedAt())
                ? globalState.getUpdatedAt()
                : groupState.getUpdatedAt();
    }

    private String effectiveUpdatedBy(PipelineState groupState, PipelineState globalState) {
        if (globalState == null) {
            return groupState.getUpdatedBy();
        }
        return globalState.getUpdatedAt().isAfter(groupState.getUpdatedAt())
                ? globalState.getUpdatedBy()
                : groupState.getUpdatedBy();
    }

    private PipelineState loadOrCreate(
            String taskId,
            PipelineOwnerType ownerType,
            String ownerKey,
            PipelineStatePayload defaults
    ) {
        return pipelineStateRepository.findByTaskIdAndOwnerTypeAndOwnerKey(taskId, ownerType, ownerKey)
                .orElseGet(() -> {
                    PipelineState created = new PipelineState();
                    created.setTaskId(taskId);
                    created.setOwnerType(ownerType);
                    created.setOwnerKey(ownerKey);
                    created.setStateJson(serialize(defaults));
                    created.setRevision(0L);
                    created.setUpdatedAt(Instant.now(clock));
                    created.setUpdatedBy("system");
                    return pipelineStateRepository.save(created);
                });
    }

    private void persist(PipelineState state, PipelineStatePayload payload, String actor) {
        state.setStateJson(serialize(payload));
        state.setRevision(state.getRevision() + 1L);
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(actor == null || actor.isBlank() ? "system" : actor);
        pipelineStateRepository.save(state);
    }

    private PipelineStatePayload defaultPayload(PipelineTaskConfig config) {
        PipelineInputSection input = new PipelineInputSection(
                config.inputMode(),
                config.deviceScope(),
                config.ingestFilters(),
                PipelineScenarioOverlayCodec.normalize(config.scenarioOverlays(), false)
        );
        PipelineProcessingSection processing = normalizeProcessing(
                new PipelineProcessingSection("CONSTRAINED", config.slotCount(), List.of()),
                config.slotCount(),
                PipelineBlockLibrary.allBlocks(),
                false
        );
        PipelineSinkSection sink = new PipelineSinkSection(config.sinkTargets(), config.sinkGoal());
        return new PipelineStatePayload(input, processing, sink);
    }

    private PipelineStatePayload deserializeOrDefault(String raw, PipelineStatePayload defaults) {
        try {
            PipelineStatePayload parsed = objectMapper.readValue(raw, PipelineStatePayload.class);
            if (parsed == null) {
                return defaults;
            }
            PipelineInputSection input = normalizeInput(parsed.input(), null, defaults.input(), false);
            PipelineProcessingSection processing = normalizeProcessing(
                    parsed.processing(),
                    defaults.processing().slotCount(),
                    PipelineBlockLibrary.allBlocks(),
                    false
            );
            PipelineSinkSection sink = normalizeSink(parsed.sink(), defaults.sink());
            return new PipelineStatePayload(input, processing, sink);
        } catch (JsonProcessingException ex) {
            return defaults;
        }
    }

    private String serialize(PipelineStatePayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException ex) {
            return "{}";
        }
    }

    private PipelineInputSection normalizeInput(
            PipelineInputSection source,
            PipelineTaskConfig taskConfig,
            PipelineInputSection fallback
    ) {
        return normalizeInput(source, taskConfig, fallback, false);
    }

    private PipelineInputSection normalizeInput(
            PipelineInputSection source,
            PipelineTaskConfig taskConfig,
            PipelineInputSection fallback,
            boolean strictScenarios
    ) {
        PipelineInputSection base = source == null ? fallback : source;
        if (base == null) {
            String defaultMode = taskConfig == null ? "LIVE_MQTT" : taskConfig.inputMode();
            String defaultScope = taskConfig == null ? "GROUP_DEVICES" : taskConfig.deviceScope();
            return new PipelineInputSection(defaultMode, defaultScope, List.of(), List.of());
        }

        String mode = normalizeEnum(base.mode(), INPUT_MODES, taskConfig == null ? base.mode() : taskConfig.inputMode());
        String scope = normalizeEnum(
                base.deviceScope(),
                DEVICE_SCOPES,
                taskConfig == null ? base.deviceScope() : taskConfig.deviceScope()
        );
        return new PipelineInputSection(
                mode,
                scope,
                sanitizeStringList(base.ingestFilters(), 20),
                PipelineScenarioOverlayCodec.normalize(base.scenarioOverlays(), strictScenarios)
        );
    }

    private PipelineSinkSection normalizeSink(PipelineSinkSection source, PipelineSinkSection fallback) {
        PipelineSinkSection base = source == null ? fallback : source;
        if (base == null) {
            return new PipelineSinkSection(List.of("DEVICE_CONTROL"), "");
        }
        String goal = base.goal() == null ? "" : base.goal().trim();
        return new PipelineSinkSection(sanitizeStringList(base.targets(), 10), goal);
    }

    private PipelineProcessingSection normalizeProcessing(
            PipelineProcessingSection source,
            int expectedSlotCount,
            List<String> allowedBlocks,
            boolean enforceAllowList
    ) {
        if (expectedSlotCount < 1 || expectedSlotCount > 8) {
            throw new ResponseStatusException(BAD_REQUEST, "Pipeline slot count out of range");
        }

        Map<Integer, PipelineSlot> byIndex = new java.util.HashMap<>();
        List<PipelineSlot> incoming = source == null || source.slots() == null ? List.of() : source.slots();
        for (PipelineSlot slot : incoming) {
            if (slot == null) {
                continue;
            }
            if (slot.index() < 0 || slot.index() >= expectedSlotCount) {
                throw new ResponseStatusException(BAD_REQUEST, "Invalid slot index: " + slot.index());
            }
            if (byIndex.containsKey(slot.index())) {
                throw new ResponseStatusException(BAD_REQUEST, "Duplicate slot index: " + slot.index());
            }
            byIndex.put(slot.index(), slot);
        }

        Set<String> allowListSet = new LinkedHashSet<>();
        if (allowedBlocks != null) {
            for (String block : allowedBlocks) {
                allowListSet.add(canonicalBlock(block));
            }
        }

        List<PipelineSlot> normalizedSlots = new ArrayList<>();
        for (int index = 0; index < expectedSlotCount; index++) {
            PipelineSlot sourceSlot = byIndex.get(index);
            String blockType = sourceSlot == null ? PipelineBlockLibrary.NONE : canonicalBlock(sourceSlot.blockType());
            if (!PipelineBlockLibrary.isKnown(blockType)) {
                throw new ResponseStatusException(BAD_REQUEST, "Unknown block type: " + blockType);
            }
            if (enforceAllowList
                    && !PipelineBlockLibrary.NONE.equals(blockType)
                    && !allowListSet.contains(blockType)) {
                throw new ResponseStatusException(BAD_REQUEST, "Block type not allowed in this task: " + blockType);
            }
            Map<String, Object> normalizedConfig = sourceSlot == null || sourceSlot.config() == null
                    ? Map.of()
                    : sourceSlot.config();
            normalizedSlots.add(new PipelineSlot(index, blockType, normalizedConfig));
        }

        return new PipelineProcessingSection("CONSTRAINED", expectedSlotCount, normalizedSlots);
    }

    private String canonicalBlock(String raw) {
        if (raw == null || raw.isBlank()) {
            return PipelineBlockLibrary.NONE;
        }
        return raw.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeEnum(String value, Set<String> allowed, String fallback) {
        String candidate = value == null ? fallback : value.trim().toUpperCase(Locale.ROOT);
        if (candidate == null || !allowed.contains(candidate)) {
            if (fallback != null) {
                String fallbackCandidate = fallback.trim().toUpperCase(Locale.ROOT);
                if (allowed.contains(fallbackCandidate)) {
                    return fallbackCandidate;
                }
            }
            return allowed.iterator().next();
        }
        return candidate;
    }

    private List<String> sanitizeStringList(List<String> raw, int maxItems) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (String entry : raw) {
            if (entry == null) {
                continue;
            }
            String trimmed = entry.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            unique.add(trimmed);
            if (unique.size() >= maxItems) {
                break;
            }
        }
        return List.copyOf(unique);
    }

    private String normalizeGroupKey(String groupKey) {
        if (groupKey == null || groupKey.isBlank()) {
            throw new ResponseStatusException(BAD_REQUEST, "groupKey must not be blank");
        }
        return groupKey.trim();
    }
}
