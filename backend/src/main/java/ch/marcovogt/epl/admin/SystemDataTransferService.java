package ch.marcovogt.epl.admin;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ch.marcovogt.epl.authsession.AuthAccount;
import ch.marcovogt.epl.authsession.AuthAccountRepository;
import ch.marcovogt.epl.authsession.AuthSessionRepository;
import ch.marcovogt.epl.common.DeviceIdMapping;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatus;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusRepository;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEvent;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import ch.marcovogt.epl.groupcollaborationsync.GroupState;
import ch.marcovogt.epl.groupcollaborationsync.GroupStateRepository;
import ch.marcovogt.epl.taskscenarioengine.TaskState;
import ch.marcovogt.epl.taskscenarioengine.TaskStateRepository;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceState;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SystemDataTransferService {

    private static final int SCHEMA_VERSION = 1;

    private static final TypeReference<List<AppSettings>> APP_SETTINGS_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<TaskState>> TASK_STATE_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<GroupState>> GROUP_STATE_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<AuthAccount>> AUTH_ACCOUNT_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<DeviceStatus>> DEVICE_STATUS_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<VirtualDeviceState>> VIRTUAL_DEVICE_STATE_LIST = new TypeReference<>() {
    };
    private static final TypeReference<List<CanonicalEvent>> EVENT_DATA_LIST = new TypeReference<>() {
    };

    private final AppSettingsRepository appSettingsRepository;
    private final TaskStateRepository taskStateRepository;
    private final GroupStateRepository groupStateRepository;
    private final AuthAccountRepository authAccountRepository;
    private final AuthSessionRepository authSessionRepository;
    private final DeviceStatusRepository deviceStatusRepository;
    private final VirtualDeviceStateRepository virtualDeviceStateRepository;
    private final CanonicalEventRepository canonicalEventRepository;
    private final EventFeedService eventFeedService;
    private final AppSettingsService appSettingsService;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public SystemDataTransferService(
            AppSettingsRepository appSettingsRepository,
            TaskStateRepository taskStateRepository,
            GroupStateRepository groupStateRepository,
            AuthAccountRepository authAccountRepository,
            AuthSessionRepository authSessionRepository,
            DeviceStatusRepository deviceStatusRepository,
            VirtualDeviceStateRepository virtualDeviceStateRepository,
            CanonicalEventRepository canonicalEventRepository,
            EventFeedService eventFeedService,
            AppSettingsService appSettingsService,
            ObjectMapper objectMapper
    ) {
        this.appSettingsRepository = appSettingsRepository;
        this.taskStateRepository = taskStateRepository;
        this.groupStateRepository = groupStateRepository;
        this.authAccountRepository = authAccountRepository;
        this.authSessionRepository = authSessionRepository;
        this.deviceStatusRepository = deviceStatusRepository;
        this.virtualDeviceStateRepository = virtualDeviceStateRepository;
        this.canonicalEventRepository = canonicalEventRepository;
        this.eventFeedService = eventFeedService;
        this.appSettingsService = appSettingsService;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public SystemDataTransferDocument exportData(Set<SystemDataPart> parts) {
        EnumSet<SystemDataPart> selectedParts = requireSelectedParts(parts, "parts");
        Map<String, JsonNode> payloadByPart = new LinkedHashMap<>();
        for (SystemDataPart part : sortedParts(selectedParts)) {
            payloadByPart.put(part.name(), exportPartNode(part));
        }
        return new SystemDataTransferDocument(
                SCHEMA_VERSION,
                Instant.now(clock),
                payloadByPart
        );
    }

    @Transactional(readOnly = true)
    public SystemDataImportVerifyResponse verifyImportDocument(SystemDataTransferDocument document) {
        VerificationResult verification = verifyDocument(document);
        Integer schemaVersion = document == null ? null : document.schemaVersion();
        Instant exportedAt = document == null ? null : document.exportedAt();
        return new SystemDataImportVerifyResponse(
                verification.errors().isEmpty(),
                schemaVersion,
                exportedAt,
                verification.availablePartInfos(),
                verification.errors(),
                verification.warnings()
        );
    }

    @Transactional
    public SystemDataImportApplyResponse applyImport(
            SystemDataTransferDocument document,
            Set<SystemDataPart> selectedParts
    ) {
        VerificationResult verification = verifyDocument(document);
        if (!verification.errors().isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Import document is invalid: " + String.join(" | ", verification.errors())
            );
        }

        EnumSet<SystemDataPart> selected = requireSelectedParts(selectedParts, "selectedParts");
        EnumSet<SystemDataPart> available = EnumSet.copyOf(verification.availableParts().keySet());
        for (SystemDataPart part : selected) {
            if (!available.contains(part)) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Selected part " + part.name() + " is not present in the import document"
                );
            }
        }

        List<SystemDataImportPartInfo> importedParts = new ArrayList<>();
        for (SystemDataPart part : sortedParts(selected)) {
            JsonNode payload = verification.availableParts().get(part);
            long rowCount = replacePart(part, payload);
            importedParts.add(new SystemDataImportPartInfo(part, rowCount));
        }

        if (selected.contains(SystemDataPart.APP_SETTINGS)) {
            appSettingsService.getOrCreate();
        }

        return new SystemDataImportApplyResponse(Instant.now(clock), importedParts);
    }

    private JsonNode exportPartNode(SystemDataPart part) {
        return switch (part) {
            case APP_SETTINGS -> objectMapper.valueToTree(
                    appSettingsRepository.findAll(Sort.by(Sort.Direction.ASC, "id"))
            );
            case TASK_STATE -> objectMapper.valueToTree(
                    taskStateRepository.findAll(Sort.by(Sort.Direction.ASC, "id"))
            );
            case GROUP_STATE -> objectMapper.valueToTree(
                    groupStateRepository.findAll(Sort.by(Sort.Direction.ASC, "groupKey"))
            );
            case AUTH_ACCOUNTS -> objectMapper.valueToTree(
                    authAccountRepository.findAll(Sort.by(Sort.Direction.ASC, "username"))
            );
            case DEVICE_STATUS -> objectMapper.valueToTree(
                    deviceStatusRepository.findAllByOrderByDeviceIdAsc()
                            .stream()
                            .filter(status -> !DeviceIdMapping.isVirtualDeviceId(status.getDeviceId()))
                            .toList()
            );
            case VIRTUAL_DEVICE_STATE -> objectMapper.valueToTree(
                    virtualDeviceStateRepository.findAllByOrderByDeviceIdAsc()
            );
            case EVENT_DATA -> objectMapper.valueToTree(
                    canonicalEventRepository.findAll(
                            Sort.by(
                                    Sort.Order.asc("ingestTs"),
                                    Sort.Order.asc("id")
                            )
                    )
            );
        };
    }

    private long replacePart(SystemDataPart part, JsonNode payload) {
        try {
            return switch (part) {
                case APP_SETTINGS -> replaceAppSettings(payload);
                case TASK_STATE -> replaceTaskState(payload);
                case GROUP_STATE -> replaceGroupState(payload);
                case AUTH_ACCOUNTS -> replaceAuthAccounts(payload);
                case DEVICE_STATUS -> replaceDeviceStatus(payload);
                case VIRTUAL_DEVICE_STATE -> replaceVirtualDeviceState(payload);
                case EVENT_DATA -> replaceEventData(payload);
            };
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Failed to import part " + part.name() + ": " + rootMessage(ex),
                    ex
            );
        }
    }

    private long replaceAppSettings(JsonNode payload) {
        List<AppSettings> rows = readRows(payload, APP_SETTINGS_LIST, SystemDataPart.APP_SETTINGS);
        appSettingsRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            appSettingsRepository.saveAll(rows);
        }
        return rows.size();
    }

    private long replaceTaskState(JsonNode payload) {
        List<TaskState> rows = readRows(payload, TASK_STATE_LIST, SystemDataPart.TASK_STATE);
        taskStateRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            taskStateRepository.saveAll(rows);
        }
        return rows.size();
    }

    private long replaceGroupState(JsonNode payload) {
        List<GroupState> rows = readRows(payload, GROUP_STATE_LIST, SystemDataPart.GROUP_STATE);
        groupStateRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            groupStateRepository.saveAll(rows);
        }
        return rows.size();
    }

    private long replaceAuthAccounts(JsonNode payload) {
        List<AuthAccount> rows = readRows(payload, AUTH_ACCOUNT_LIST, SystemDataPart.AUTH_ACCOUNTS);
        authSessionRepository.deleteAllInBatch();
        authAccountRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            authAccountRepository.saveAll(rows);
        }
        return rows.size();
    }

    private long replaceDeviceStatus(JsonNode payload) {
        List<DeviceStatus> rows = readRows(payload, DEVICE_STATUS_LIST, SystemDataPart.DEVICE_STATUS)
                .stream()
                .filter(row -> row.getDeviceId() != null && !row.getDeviceId().isBlank())
                .filter(row -> !DeviceIdMapping.isVirtualDeviceId(row.getDeviceId()))
                .toList();
        deviceStatusRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            deviceStatusRepository.saveAll(rows);
        }
        return rows.size();
    }

    private long replaceVirtualDeviceState(JsonNode payload) {
        List<VirtualDeviceState> rows = readRows(payload, VIRTUAL_DEVICE_STATE_LIST, SystemDataPart.VIRTUAL_DEVICE_STATE)
                .stream()
                .filter(row -> row.getDeviceId() != null && !row.getDeviceId().isBlank())
                .filter(row -> DeviceIdMapping.isVirtualDeviceId(row.getDeviceId()))
                .toList();
        virtualDeviceStateRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            virtualDeviceStateRepository.saveAll(rows);
        }
        return rows.size();
    }

    private long replaceEventData(JsonNode payload) {
        List<CanonicalEvent> rows = readRows(payload, EVENT_DATA_LIST, SystemDataPart.EVENT_DATA);
        canonicalEventRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            canonicalEventRepository.saveAll(rows);
        }
        eventFeedService.clearLiveBuffer();
        return rows.size();
    }

    private <T> List<T> readRows(
            JsonNode payload,
            TypeReference<List<T>> typeReference,
            SystemDataPart part
    ) {
        try {
            List<T> rows = objectMapper.convertValue(payload, typeReference);
            return rows == null ? List.of() : rows;
        } catch (IllegalArgumentException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Import data for part " + part.name() + " is invalid",
                    ex
            );
        }
    }

    private VerificationResult verifyDocument(SystemDataTransferDocument document) {
        List<String> errors = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        Map<SystemDataPart, JsonNode> availableParts = new EnumMap<>(SystemDataPart.class);

        if (document == null) {
            errors.add("document is required");
            return new VerificationResult(availableParts, errors, warnings);
        }

        if (document.schemaVersion() != SCHEMA_VERSION) {
            errors.add("Unsupported schemaVersion " + document.schemaVersion() + " (expected " + SCHEMA_VERSION + ")");
        }

        if (document.exportedAt() == null) {
            warnings.add("exportedAt is missing");
        }

        Map<String, JsonNode> rawParts = document.parts();
        if (rawParts == null || rawParts.isEmpty()) {
            errors.add("document.parts must not be empty");
            return new VerificationResult(availableParts, errors, warnings);
        }

        for (Map.Entry<String, JsonNode> entry : rawParts.entrySet()) {
            String partKey = entry.getKey();
            SystemDataPart part = SystemDataPart.fromKey(partKey).orElse(null);
            if (part == null) {
                warnings.add("Unknown part ignored: " + partKey);
                continue;
            }

            JsonNode payloadNode = entry.getValue();
            if (payloadNode == null || payloadNode.isNull()) {
                errors.add("Part " + part.name() + " must not be null");
                continue;
            }
            if (!payloadNode.isArray()) {
                errors.add("Part " + part.name() + " must be a JSON array");
                continue;
            }
            availableParts.put(part, payloadNode);
        }

        JsonNode authAccountsNode = availableParts.get(SystemDataPart.AUTH_ACCOUNTS);
        if (authAccountsNode != null) {
            boolean hasEnabledAdmin = false;
            for (JsonNode accountNode : authAccountsNode) {
                String role = accountNode.path("role").asText("");
                boolean enabled = accountNode.path("enabled").asBoolean(true);
                if ("ADMIN".equalsIgnoreCase(role) && enabled) {
                    hasEnabledAdmin = true;
                    break;
                }
            }
            if (!hasEnabledAdmin) {
                warnings.add("AUTH_ACCOUNTS does not contain an enabled ADMIN account");
            }
        }

        if (availableParts.isEmpty()) {
            errors.add("No supported import parts were found in document.parts");
        }

        return new VerificationResult(availableParts, errors, warnings);
    }

    private String rootMessage(Throwable error) {
        Throwable current = error;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        String message = current.getMessage();
        if (message == null || message.isBlank()) {
            return current.getClass().getSimpleName();
        }
        return message;
    }

    private EnumSet<SystemDataPart> requireSelectedParts(Set<SystemDataPart> parts, String fieldName) {
        if (parts == null || parts.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, fieldName + " must not be empty");
        }
        return EnumSet.copyOf(parts);
    }

    private List<SystemDataPart> sortedParts(Set<SystemDataPart> parts) {
        return parts.stream()
                .sorted(Comparator.comparingInt(Enum::ordinal))
                .toList();
    }

    private record VerificationResult(
            Map<SystemDataPart, JsonNode> availableParts,
            List<String> errors,
            List<String> warnings
    ) {
        private List<SystemDataImportPartInfo> availablePartInfos() {
            return availableParts.entrySet()
                    .stream()
                    .sorted((left, right) -> Integer.compare(left.getKey().ordinal(), right.getKey().ordinal()))
                    .map(entry -> new SystemDataImportPartInfo(entry.getKey(), entry.getValue().size()))
                    .toList();
        }
    }
}
