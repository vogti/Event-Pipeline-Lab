package ch.marcovogt.epl.pipelinebuilder;

import ch.marcovogt.epl.admin.AppSettingsService;
import ch.marcovogt.epl.authsession.SessionPrincipal;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioService;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import ch.marcovogt.epl.taskscenarioengine.PipelineTaskConfig;
import ch.marcovogt.epl.taskscenarioengine.StudentDeviceScope;
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
import java.util.Objects;
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
    private static final String TASK_SCOPE_LOCKED_KEY = "taskScopeLocked";
    private static final String TASK_SCOPE_ORIGIN_KEY = "taskScopeOrigin";
    private static final String TASK_SCOPE_ORIGIN_VALUE = "task_device_scope";

    private final PipelineStateRepository pipelineStateRepository;
    private final TaskStateService taskStateService;
    private final PipelineObservabilityService pipelineObservabilityService;
    private final PipelineSinkExecutionService pipelineSinkExecutionService;
    private final FeedScenarioService feedScenarioService;
    private final AppSettingsService appSettingsService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public PipelineStateService(
            PipelineStateRepository pipelineStateRepository,
            TaskStateService taskStateService,
            PipelineObservabilityService pipelineObservabilityService,
            PipelineSinkExecutionService pipelineSinkExecutionService,
            FeedScenarioService feedScenarioService,
            AppSettingsService appSettingsService,
            ObjectMapper objectMapper
    ) {
        this.pipelineStateRepository = pipelineStateRepository;
        this.taskStateService = taskStateService;
        this.pipelineObservabilityService = pipelineObservabilityService;
        this.pipelineSinkExecutionService = pipelineSinkExecutionService;
        this.feedScenarioService = feedScenarioService;
        this.appSettingsService = appSettingsService;
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
        PipelineProcessingSection effectiveProcessing = withTaskDeviceScopeFilter(config, effective.processing());
        PipelineObservabilityDto observability = pipelineObservabilityService.snapshot(
                task.id(),
                normalizedGroupKey,
                effectiveProcessing
        );
        PipelineSinkRuntimeSection sinkRuntime = pipelineSinkExecutionService.snapshot(
                task.id(),
                normalizedGroupKey,
                effective.sink()
        );

        return new PipelineViewDto(
                task.id(),
                normalizedGroupKey,
                effective.input(),
                effectiveProcessing,
                effective.sink(),
                sinkRuntime,
                new PipelinePermissions(
                        config.visibleToStudents(),
                        false,
                        config.visibleToStudents(),
                        config.visibleToStudents(),
                        studentStateResetAllowed(task),
                        false,
                        config.lecturerMode(),
                        config.allowedProcessingBlocks(),
                        effectiveProcessing.slotCount()
                ),
                observability,
                effectiveRevision(groupState, globalState),
                effectiveUpdatedAt(groupState, globalState),
                effectiveUpdatedBy(groupState, globalState)
        );
    }

    @Transactional
    public PipelineViewDto updateStudentPipeline(
            SessionPrincipal principal,
            PipelineProcessingSection processingSection,
            PipelineSinkSection sinkSection
    ) {
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        if (!config.visibleToStudents()) {
            throw new ResponseStatusException(BAD_REQUEST, "Pipeline builder is disabled for this task");
        }

        String groupKey = principal.groupKey();
        PipelineStatePayload defaults = defaultPayload(config);
        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, groupKey, defaults);
        PipelineStatePayload current = deserializeOrDefault(groupState.getStateJson(), defaults);
        PipelineProcessingSection requestedProcessing = withoutTaskDeviceScopeFilter(processingSection);

        PipelineProcessingSection normalizedProcessing = normalizeProcessing(
                requestedProcessing,
                config.slotCount(),
                config.allowedProcessingBlocks(),
                true
        );
        PipelineSinkSection normalizedSink = normalizeSink(sinkSection, current.sink());

        PipelineStatePayload nextPayload = new PipelineStatePayload(
                current.input(),
                normalizedProcessing,
                normalizedSink
        );
        persist(groupState, nextPayload, principal.displayName());
        if (!Objects.equals(current.processing(), normalizedProcessing)) {
            pipelineObservabilityService.reset(task.id(), groupKey);
        }

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
        PipelineProcessingSection effectiveProcessing = withTaskDeviceScopeFilter(config, effective.processing());
        PipelineObservabilityDto observability = pipelineObservabilityService.snapshot(
                task.id(),
                normalizedGroupKey,
                effectiveProcessing
        );
        PipelineSinkRuntimeSection sinkRuntime = pipelineSinkExecutionService.snapshot(
                task.id(),
                normalizedGroupKey,
                effective.sink()
        );

        return new PipelineViewDto(
                task.id(),
                normalizedGroupKey,
                effective.input(),
                effectiveProcessing,
                effective.sink(),
                sinkRuntime,
                new PipelinePermissions(
                        true,
                        config.lecturerMode(),
                        true,
                        config.lecturerMode(),
                        true,
                        true,
                        config.lecturerMode(),
                        PipelineBlockLibrary.allBlocks(),
                        effectiveProcessing.slotCount()
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
        PipelineProcessingSection requestedProcessing = withoutTaskDeviceScopeFilter(request.processing());

        PipelineProcessingSection processing = normalizeProcessing(
                requestedProcessing,
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
                sink
        );
        persist(groupState, updatedGroup, principal.username());
        pipelineObservabilityService.reset(task.id(), groupKey);

        return getAdminView(groupKey);
    }

    @Transactional
    public PipelineEventProcessingResult recordObservabilityAndProjectEvent(CanonicalEventDto eventDto) {
        return recordObservabilityAndProjectEvent(eventDto, true);
    }

    @Transactional
    public PipelineObservabilityUpdateDto recordObservabilityEvent(CanonicalEventDto eventDto) {
        PipelineEventProcessingResult result = recordObservabilityAndProjectEvent(eventDto, false);
        return result == null ? null : result.observabilityUpdate();
    }

    private PipelineEventProcessingResult recordObservabilityAndProjectEvent(
            CanonicalEventDto eventDto,
            boolean executeSinks
    ) {
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
        PipelineProcessingSection effectiveProcessing = withTaskDeviceScopeFilter(config, effective.processing());

        CanonicalEventDto projected = pipelineObservabilityService.recordEvent(
                task.id(),
                groupKey,
                effectiveProcessing,
                eventDto
        );
        PipelineSinkRuntimeUpdateDto sinkRuntimeUpdate = null;
        if (projected != null && executeSinks) {
            StudentDeviceScope sinkTargetScope = taskStateService.currentStudentCapabilities().studentCommandTargetScope();
            String adminDeviceId = appSettingsService.getAdminDeviceId();
            PipelineSinkRuntimeSection sinkRuntime = pipelineSinkExecutionService.processProjectedEvent(
                    task.id(),
                    groupKey,
                    effective.sink(),
                    projected,
                    sinkTargetScope == null ? StudentDeviceScope.OWN_DEVICE : sinkTargetScope,
                    groupKey,
                    adminDeviceId
            );
            sinkRuntimeUpdate = new PipelineSinkRuntimeUpdateDto(task.id(), groupKey, sinkRuntime);
        }
        PipelineObservabilityDto observability = pipelineObservabilityService.snapshot(
                task.id(),
                groupKey,
                effectiveProcessing
        );
        return new PipelineEventProcessingResult(
                new PipelineObservabilityUpdateDto(task.id(), groupKey, observability),
                projected,
                sinkRuntimeUpdate
        );
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

    @Transactional
    public PipelineSinkRuntimeUpdateDto resetStudentSinkRuntime(SessionPrincipal principal, String sinkId) {
        String groupKey = normalizeGroupKey(principal.groupKey());
        TaskDefinition task = taskStateService.getActiveTask();
        PipelineTaskConfig config = task.pipeline();
        PipelineStatePayload defaults = defaultPayload(config);

        PipelineState groupState = loadOrCreate(task.id(), PipelineOwnerType.GROUP, groupKey, defaults);
        PipelineStatePayload groupPayload = deserializeOrDefault(groupState.getStateJson(), defaults);
        PipelineState globalState = config.lecturerMode()
                ? loadOrCreate(task.id(), PipelineOwnerType.ADMIN_GLOBAL, GLOBAL_OWNER_KEY, defaults)
                : null;
        PipelineStatePayload effective = effectivePayload(config, groupPayload, globalState, defaults);

        PipelineSinkRuntimeSection sinkRuntime = pipelineSinkExecutionService.resetSinkCounter(
                task.id(),
                groupKey,
                effective.sink(),
                sinkId
        );
        return new PipelineSinkRuntimeUpdateDto(task.id(), groupKey, sinkRuntime);
    }

    @Transactional
    public PipelineSinkRuntimeUpdateDto resetAdminSinkRuntime(String groupKey, String sinkId) {
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

        PipelineSinkRuntimeSection sinkRuntime = pipelineSinkExecutionService.resetSinkCounter(
                task.id(),
                normalizedGroupKey,
                effective.sink(),
                sinkId
        );
        return new PipelineSinkRuntimeUpdateDto(task.id(), normalizedGroupKey, sinkRuntime);
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
            pipelineSinkExecutionService.resetAllForGroup(taskId, normalizedGroupKey);
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
            PipelineSinkSection groupSink = groupPayload.sink() == null ? defaults.sink() : groupPayload.sink();
            PipelineInputSection resolvedInput = new PipelineInputSection(
                    groupInput.mode(),
                    groupInput.deviceScope(),
                    groupInput.ingestFilters(),
                    globalScenarioOverlays
            );
            return new PipelineStatePayload(resolvedInput, groupPayload.processing(), groupSink);
        }
        PipelineStatePayload globalPayload = deserializeOrDefault(globalState.getStateJson(), defaults);
        PipelineInputSection globalInput = globalPayload.input();
        PipelineSinkSection groupSink = groupPayload.sink() == null ? defaults.sink() : groupPayload.sink();
        PipelineInputSection resolvedInput = new PipelineInputSection(
                globalInput.mode(),
                globalInput.deviceScope(),
                globalInput.ingestFilters(),
                globalScenarioOverlays
        );
        return new PipelineStatePayload(resolvedInput, groupPayload.processing(), groupSink);
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
        PipelineSinkSection sink = normalizeSink(
                new PipelineSinkSection(defaultSinkNodesFromTargets(config.sinkTargets()), config.sinkTargets(), config.sinkGoal()),
                null
        );
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
        String scope = taskConfig == null
                ? normalizeEnum(base.deviceScope(), DEVICE_SCOPES, base.deviceScope())
                : normalizeTaskDeviceScope(taskConfig.deviceScope());
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
            List<PipelineSinkNode> defaults = List.of(
                    new PipelineSinkNode(PipelineSinkLibrary.EVENT_FEED_ID, PipelineSinkLibrary.EVENT_FEED, Map.of()),
                    new PipelineSinkNode(PipelineSinkLibrary.VIRTUAL_SIGNAL_ID, PipelineSinkLibrary.VIRTUAL_SIGNAL, Map.of())
            );
            return new PipelineSinkSection(defaults, List.of(), "");
        }
        String goal = base.goal() == null ? "" : base.goal().trim();
        List<PipelineSinkNode> nodes = sanitizeSinkNodes(base.nodes(), base.targets());
        return new PipelineSinkSection(nodes, legacyTargetsFromNodes(nodes), goal);
    }

    private List<PipelineSinkNode> defaultSinkNodesFromTargets(List<String> targets) {
        return sanitizeSinkNodes(List.of(), targets);
    }

    private List<PipelineSinkNode> sanitizeSinkNodes(List<PipelineSinkNode> rawNodes, List<String> legacyTargets) {
        List<PipelineSinkNode> candidates = new ArrayList<>();
        if (rawNodes != null) {
            candidates.addAll(rawNodes);
        }
        if (candidates.isEmpty() && legacyTargets != null) {
            for (String target : legacyTargets) {
                String sinkType = PipelineSinkLibrary.normalizeType(target);
                candidates.add(new PipelineSinkNode(
                        PipelineSinkLibrary.defaultIdForType(sinkType),
                        sinkType,
                        Map.of()
                ));
            }
        }

        List<PipelineSinkNode> normalized = new ArrayList<>();
        normalized.add(new PipelineSinkNode(
                PipelineSinkLibrary.EVENT_FEED_ID,
                PipelineSinkLibrary.EVENT_FEED,
                Map.of()
        ));
        LinkedHashSet<String> usedIds = new LinkedHashSet<>();
        usedIds.add(PipelineSinkLibrary.EVENT_FEED_ID);
        usedIds.add(PipelineSinkLibrary.VIRTUAL_SIGNAL_ID);
        usedIds.add(PipelineSinkLibrary.SHOW_PAYLOAD_ID);
        usedIds.add(PipelineSinkLibrary.LEGACY_LAST_PAYLOAD_ID);
        int sendEventIndex = 1;
        boolean includeShowPayload = false;

        for (PipelineSinkNode node : candidates) {
            if (node == null) {
                continue;
            }
            String sinkType = PipelineSinkLibrary.normalizeType(node.type());
            if (PipelineSinkLibrary.SEND_EVENT.equals(sinkType)) {
                String sinkId = normalizeSendEventSinkId(node.id(), usedIds, sendEventIndex);
                while (usedIds.contains(sinkId)) {
                    sendEventIndex += 1;
                    sinkId = PipelineSinkLibrary.SEND_EVENT_ID + "-" + sendEventIndex;
                }
                normalized.add(new PipelineSinkNode(
                        sinkId,
                        sinkType,
                        sanitizeSendEventSinkConfig(node.config())
                ));
                usedIds.add(sinkId);
                sendEventIndex += 1;
                continue;
            }

            if (PipelineSinkLibrary.SHOW_PAYLOAD.equals(sinkType)) {
                includeShowPayload = true;
            }
        }

        if (includeShowPayload) {
            normalized.add(new PipelineSinkNode(
                    PipelineSinkLibrary.SHOW_PAYLOAD_ID,
                    PipelineSinkLibrary.SHOW_PAYLOAD,
                    Map.of()
            ));
        }

        normalized.add(new PipelineSinkNode(
                PipelineSinkLibrary.VIRTUAL_SIGNAL_ID,
                PipelineSinkLibrary.VIRTUAL_SIGNAL,
                Map.of()
        ));

        return List.copyOf(normalized);
    }

    private String normalizeSendEventSinkId(String rawId, LinkedHashSet<String> usedIds, int sendEventIndex) {
        if (rawId != null && !rawId.isBlank()) {
            String trimmed = rawId.trim();
            if (!PipelineSinkLibrary.EVENT_FEED_ID.equals(trimmed)
                    && !PipelineSinkLibrary.VIRTUAL_SIGNAL_ID.equals(trimmed)
                    && !usedIds.contains(trimmed)) {
                return trimmed;
            }
        }
        String candidate = sendEventIndex <= 1
                ? PipelineSinkLibrary.SEND_EVENT_ID
                : PipelineSinkLibrary.SEND_EVENT_ID + "-" + sendEventIndex;
        while (usedIds.contains(candidate)) {
            sendEventIndex += 1;
            candidate = PipelineSinkLibrary.SEND_EVENT_ID + "-" + sendEventIndex;
        }
        return candidate;
    }

    private Map<String, Object> sanitizeSendEventSinkConfig(Map<String, Object> rawConfig) {
        if (rawConfig == null || rawConfig.isEmpty()) {
            return Map.of("topic", "", "payload", "", "qos", 1, "retained", false);
        }
        Object topicRaw = rawConfig.get("topic");
        String topic = topicRaw == null ? "" : String.valueOf(topicRaw).trim();
        Object payloadRaw = rawConfig.get("payload");
        String payload = payloadRaw == null ? "" : String.valueOf(payloadRaw);

        Object qosRaw = rawConfig.get("qos");
        int qos = 1;
        if (qosRaw instanceof Number number) {
            qos = number.intValue();
        } else if (qosRaw instanceof String text) {
            try {
                qos = Integer.parseInt(text.trim());
            } catch (NumberFormatException ignored) {
                qos = 1;
            }
        }
        if (qos < 0 || qos > 2) {
            qos = 1;
        }

        Object retainedRaw = rawConfig.get("retained");
        boolean retained;
        if (retainedRaw instanceof Boolean value) {
            retained = value;
        } else if (retainedRaw instanceof Number number) {
            retained = number.intValue() != 0;
        } else {
            retained = "true".equalsIgnoreCase(String.valueOf(retainedRaw));
        }

        return Map.of(
                "topic", topic,
                "payload", payload,
                "qos", qos,
                "retained", retained
        );
    }

    private List<String> legacyTargetsFromNodes(List<PipelineSinkNode> nodes) {
        if (nodes == null || nodes.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> targets = new LinkedHashSet<>();
        for (PipelineSinkNode node : nodes) {
            if (node == null) {
                continue;
            }
            String sinkType = PipelineSinkLibrary.normalizeType(node.type());
            if (PipelineSinkLibrary.SEND_EVENT.equals(sinkType)) {
                targets.add("DEVICE_CONTROL");
            } else if (PipelineSinkLibrary.SHOW_PAYLOAD.equals(sinkType)) {
                targets.add("SHOW_PAYLOAD");
            } else if (PipelineSinkLibrary.VIRTUAL_SIGNAL.equals(sinkType)) {
                targets.add("VIRTUAL_SIGNAL");
            }
        }
        return List.copyOf(targets);
    }

    private PipelineProcessingSection normalizeProcessing(
            PipelineProcessingSection source,
            int minimumSlotCount,
            List<String> allowedBlocks,
            boolean enforceAllowList
    ) {
        int minSlots = Math.max(1, minimumSlotCount);
        int requestedSlots = source != null ? Math.max(1, source.slotCount()) : minSlots;

        Map<Integer, PipelineSlot> byIndex = new java.util.HashMap<>();
        List<PipelineSlot> incoming = source == null || source.slots() == null ? List.of() : source.slots();
        int highestIndex = -1;
        for (PipelineSlot slot : incoming) {
            if (slot == null) {
                continue;
            }
            if (slot.index() < 0) {
                throw new ResponseStatusException(BAD_REQUEST, "Invalid slot index: " + slot.index());
            }
            if (byIndex.containsKey(slot.index())) {
                throw new ResponseStatusException(BAD_REQUEST, "Duplicate slot index: " + slot.index());
            }
            byIndex.put(slot.index(), slot);
            if (slot.index() > highestIndex) {
                highestIndex = slot.index();
            }
        }

        int effectiveSlotCount = Math.max(Math.max(minSlots, requestedSlots), highestIndex + 1);

        Set<String> allowListSet = new LinkedHashSet<>();
        if (allowedBlocks != null) {
            for (String block : allowedBlocks) {
                allowListSet.add(canonicalBlock(block));
            }
        }

        List<PipelineSlot> normalizedSlots = new ArrayList<>();
        for (int index = 0; index < effectiveSlotCount; index++) {
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

        return new PipelineProcessingSection("CONSTRAINED", effectiveSlotCount, normalizedSlots);
    }

    private PipelineProcessingSection withTaskDeviceScopeFilter(
            PipelineTaskConfig config,
            PipelineProcessingSection processing
    ) {
        PipelineProcessingSection base = processing == null
                ? new PipelineProcessingSection("CONSTRAINED", 1, List.of())
                : processing;
        String fixedScope = normalizeTaskDeviceScope(config == null ? null : config.deviceScope());

        Map<Integer, PipelineSlot> shifted = new java.util.HashMap<>();
        List<PipelineSlot> sourceSlots = base.slots() == null ? List.of() : base.slots();
        for (PipelineSlot slot : sourceSlots) {
            if (slot == null || slot.index() < 0) {
                continue;
            }
            if (slot.index() == 0 && isTaskDeviceScopeSlot(slot)) {
                continue;
            }
            int shiftedIndex = slot.index() + 1;
            shifted.put(shiftedIndex, new PipelineSlot(
                    shiftedIndex,
                    canonicalBlock(slot.blockType()),
                    stripTaskScopeMeta(slot.config())
            ));
        }

        int highestIndex = shifted.keySet().stream().mapToInt(Integer::intValue).max().orElse(0);
        int requestedSlots = Math.max(2, base.slotCount() + 1);
        int effectiveSlotCount = Math.max(requestedSlots, highestIndex + 1);

        List<PipelineSlot> resolved = new ArrayList<>();
        resolved.add(new PipelineSlot(
                0,
                "FILTER_DEVICE",
                Map.of(
                        "deviceScope", fixedScope,
                        TASK_SCOPE_LOCKED_KEY, true,
                        TASK_SCOPE_ORIGIN_KEY, TASK_SCOPE_ORIGIN_VALUE
                )
        ));
        for (int index = 1; index < effectiveSlotCount; index++) {
            PipelineSlot existing = shifted.get(index);
            if (existing == null) {
                resolved.add(new PipelineSlot(index, PipelineBlockLibrary.NONE, Map.of()));
            } else {
                resolved.add(existing);
            }
        }
        return new PipelineProcessingSection("CONSTRAINED", effectiveSlotCount, resolved);
    }

    private PipelineProcessingSection withoutTaskDeviceScopeFilter(PipelineProcessingSection processing) {
        if (processing == null) {
            return new PipelineProcessingSection("CONSTRAINED", 1, List.of());
        }
        List<PipelineSlot> stripped = new ArrayList<>();
        List<PipelineSlot> sourceSlots = processing.slots() == null ? List.of() : processing.slots();
        int highestIndex = -1;
        for (PipelineSlot slot : sourceSlots) {
            if (slot == null || slot.index() <= 0) {
                continue;
            }
            int targetIndex = slot.index() - 1;
            if (targetIndex > highestIndex) {
                highestIndex = targetIndex;
            }
            stripped.add(new PipelineSlot(
                    targetIndex,
                    canonicalBlock(slot.blockType()),
                    stripTaskScopeMeta(slot.config())
            ));
        }
        stripped.sort((left, right) -> Integer.compare(left.index(), right.index()));
        int requestedSlots = Math.max(1, processing.slotCount() - 1);
        int effectiveSlots = Math.max(requestedSlots, highestIndex + 1);
        return new PipelineProcessingSection("CONSTRAINED", effectiveSlots, stripped);
    }

    private Map<String, Object> stripTaskScopeMeta(Map<String, Object> rawConfig) {
        if (rawConfig == null || rawConfig.isEmpty()) {
            return Map.of();
        }
        java.util.HashMap<String, Object> next = new java.util.HashMap<>(rawConfig);
        next.remove(TASK_SCOPE_LOCKED_KEY);
        next.remove(TASK_SCOPE_ORIGIN_KEY);
        return Map.copyOf(next);
    }

    private boolean isTaskDeviceScopeSlot(PipelineSlot slot) {
        if (slot == null || slot.index() != 0) {
            return false;
        }
        if (!"FILTER_DEVICE".equals(canonicalBlock(slot.blockType()))) {
            return false;
        }
        if (slot.config() == null || slot.config().isEmpty()) {
            return false;
        }
        Object locked = slot.config().get(TASK_SCOPE_LOCKED_KEY);
        if (locked instanceof Boolean value && value) {
            return true;
        }
        Object origin = slot.config().get(TASK_SCOPE_ORIGIN_KEY);
        return origin != null && TASK_SCOPE_ORIGIN_VALUE.equalsIgnoreCase(String.valueOf(origin));
    }

    private String normalizeTaskDeviceScope(String rawScope) {
        if (rawScope == null || rawScope.isBlank()) {
            return "GROUP_DEVICES";
        }
        String normalized = rawScope.trim().toUpperCase(Locale.ROOT);
        if (!DEVICE_SCOPES.contains(normalized)) {
            return "GROUP_DEVICES";
        }
        return normalized;
    }

    private String canonicalBlock(String raw) {
        if (raw == null || raw.isBlank()) {
            return PipelineBlockLibrary.NONE;
        }
        String normalized = raw.trim().toUpperCase(Locale.ROOT);
        if ("FILTER_DEVICE_TOPIC".equals(normalized)) {
            return "FILTER_DEVICE";
        }
        if ("PARSE_VALIDATE".equals(normalized)
                || "ROUTE".equals(normalized)
                || "RETRY_DLQ".equals(normalized)
                || "ENRICH_METADATA".equals(normalized)) {
            return PipelineBlockLibrary.NONE;
        }
        return normalized;
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
