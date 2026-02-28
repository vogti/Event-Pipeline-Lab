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
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
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
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SystemDataTransferService {

    private static final int SCHEMA_VERSION = 1;
    private static final String ARCHIVE_FORMAT = "EPL_SYSTEM_DATA_ZIP_V1";
    private static final String SCHEMA_FILE = "schema.json";
    private static final String PARTS_DIR = "parts/";

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
    public byte[] exportDataArchive(Set<SystemDataPart> parts) {
        SystemDataTransferDocument document = exportData(parts);
        return writeArchive(document);
    }

    @Transactional(readOnly = true)
    public SystemDataImportVerifyResponse verifyImportArchive(byte[] payloadBytes) {
        try {
            SystemDataTransferDocument document = readImportDocument(payloadBytes);
            return verifyImportDocument(document);
        } catch (ResponseStatusException ex) {
            String reason = ex.getReason();
            String message = reason == null || reason.isBlank() ? rootMessage(ex) : reason;
            return new SystemDataImportVerifyResponse(
                    false,
                    null,
                    null,
                    List.of(),
                    List.of(message),
                    List.of()
            );
        }
    }

    @Transactional
    public SystemDataImportApplyResponse applyImportArchive(
            byte[] payloadBytes,
            Set<SystemDataPart> selectedParts
    ) {
        SystemDataTransferDocument document = readImportDocument(payloadBytes);
        return applyImport(document, selectedParts);
    }

    public int schemaVersion() {
        return SCHEMA_VERSION;
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

    private byte[] writeArchive(SystemDataTransferDocument document) {
        if (document == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "document is required");
        }
        ArchiveSchema schema = buildArchiveSchema(document);

        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(outputStream, StandardCharsets.UTF_8)) {
            writeZipEntry(zip, SCHEMA_FILE, objectMapper.writeValueAsBytes(schema));

            for (ArchivePartRef partRef : schema.parts()) {
                JsonNode payload = document.parts().get(partRef.part());
                writeZipEntry(zip, partRef.file(), objectMapper.writeValueAsBytes(payload));
            }

            zip.finish();
            return outputStream.toByteArray();
        } catch (IOException ex) {
            throw new ResponseStatusException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "Failed to create export archive",
                    ex
            );
        }
    }

    private SystemDataTransferDocument readImportDocument(byte[] payloadBytes) {
        if (payloadBytes == null || payloadBytes.length == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Import archive is empty");
        }
        if (looksLikeJsonDocument(payloadBytes)) {
            return readJsonDocument(payloadBytes);
        }
        return readZipDocument(payloadBytes);
    }

    private boolean looksLikeJsonDocument(byte[] payloadBytes) {
        String preview = new String(payloadBytes, StandardCharsets.UTF_8).trim();
        return preview.startsWith("{");
    }

    private SystemDataTransferDocument readJsonDocument(byte[] payloadBytes) {
        try {
            return objectMapper.readValue(payloadBytes, SystemDataTransferDocument.class);
        } catch (IOException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Import file is not a valid JSON document",
                    ex
            );
        }
    }

    private SystemDataTransferDocument readZipDocument(byte[] payloadBytes) {
        Map<String, byte[]> entries = readZipEntries(payloadBytes);
        byte[] schemaBytes = entries.get(SCHEMA_FILE);
        if (schemaBytes == null) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Import archive is missing " + SCHEMA_FILE
            );
        }

        ArchiveSchema schema;
        try {
            schema = objectMapper.readValue(schemaBytes, ArchiveSchema.class);
        } catch (IOException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Schema file is invalid",
                    ex
            );
        }
        if (schema.format() != null && !ARCHIVE_FORMAT.equals(schema.format())) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Unsupported archive format " + schema.format()
            );
        }

        Map<String, JsonNode> parts = new LinkedHashMap<>();
        for (ArchivePartRef partRef : safeArchiveParts(schema)) {
            byte[] partBytes = entries.get(partRef.file());
            if (partBytes == null) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Import archive is missing part file " + partRef.file()
                );
            }
            try {
                parts.put(partRef.part(), objectMapper.readTree(partBytes));
            } catch (IOException ex) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Part file " + partRef.file() + " is invalid JSON",
                        ex
                );
            }
        }

        int schemaVersion = schema.schemaVersion() == null ? 0 : schema.schemaVersion();
        return new SystemDataTransferDocument(schemaVersion, schema.exportedAt(), parts);
    }

    private Map<String, byte[]> readZipEntries(byte[] payloadBytes) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(payloadBytes), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }

                String name = normalizeEntryName(entry.getName());
                if (entries.containsKey(name)) {
                    throw new ResponseStatusException(
                            HttpStatus.BAD_REQUEST,
                            "Import archive contains duplicate file " + name
                    );
                }

                ByteArrayOutputStream entryBuffer = new ByteArrayOutputStream();
                zip.transferTo(entryBuffer);
                entries.put(name, entryBuffer.toByteArray());
            }
        } catch (ResponseStatusException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Import file is not a valid zip archive",
                    ex
            );
        }
        return entries;
    }

    private String normalizeEntryName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Import archive contains empty file name");
        }
        String normalized = rawName.replace('\\', '/').trim();
        if (normalized.startsWith("/") || normalized.contains("../")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Import archive contains invalid file path");
        }
        return normalized;
    }

    private List<ArchivePartRef> safeArchiveParts(ArchiveSchema schema) {
        if (schema == null || schema.parts() == null) {
            return List.of();
        }

        List<ArchivePartRef> refs = new ArrayList<>();
        for (ArchivePartRef partRef : schema.parts()) {
            if (partRef == null || partRef.part() == null || partRef.part().isBlank()) {
                continue;
            }
            if (partRef.file() == null || partRef.file().isBlank()) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Schema entry for part " + partRef.part() + " is missing file name"
                );
            }
            refs.add(new ArchivePartRef(partRef.part().trim(), normalizeEntryName(partRef.file()), partRef.rowCount()));
        }
        return refs;
    }

    private ArchiveSchema buildArchiveSchema(SystemDataTransferDocument document) {
        List<ArchivePartRef> partRefs = new ArrayList<>();
        for (Map.Entry<String, JsonNode> entry : document.parts().entrySet()) {
            String partKey = entry.getKey();
            String fileName = partFileName(partKey);
            long rowCount = entry.getValue() != null && entry.getValue().isArray() ? entry.getValue().size() : 0;
            partRefs.add(new ArchivePartRef(partKey, fileName, rowCount));
        }
        return new ArchiveSchema(
                ARCHIVE_FORMAT,
                document.schemaVersion(),
                document.exportedAt(),
                partRefs
        );
    }

    private String partFileName(String partKey) {
        String normalized = partKey == null ? "unknown" : partKey.trim().toLowerCase();
        return PARTS_DIR + normalized + ".json";
    }

    private void writeZipEntry(ZipOutputStream zip, String entryName, byte[] payload) throws IOException {
        ZipEntry entry = new ZipEntry(entryName);
        zip.putNextEntry(entry);
        zip.write(payload);
        zip.closeEntry();
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
        List<AppSettings> rows = readRows(payload, APP_SETTINGS_LIST, SystemDataPart.APP_SETTINGS)
                .stream()
                .peek(this::normalizeImportedAppSettings)
                .toList();
        appSettingsRepository.deleteAllInBatch();
        if (!rows.isEmpty()) {
            appSettingsRepository.saveAll(rows);
        }
        return rows.size();
    }

    private void normalizeImportedAppSettings(AppSettings settings) {
        if (settings == null) {
            return;
        }
        if (settings.getVirtualDeviceTopicMode() == null) {
            settings.setVirtualDeviceTopicMode(VirtualDeviceTopicMode.OWN_TOPIC);
        }
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

    private record ArchiveSchema(
            String format,
            Integer schemaVersion,
            Instant exportedAt,
            List<ArchivePartRef> parts
    ) {
    }

    private record ArchivePartRef(
            String part,
            String file,
            Long rowCount
    ) {
    }
}
