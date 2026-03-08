package ch.marcovogt.epl.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import ch.marcovogt.epl.auditlogging.AuditEntryRepository;
import ch.marcovogt.epl.authsession.AuthAccountRepository;
import ch.marcovogt.epl.authsession.AuthSessionRepository;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusRepository;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.eventfeedquery.FeedScenarioStateRepository;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import ch.marcovogt.epl.externalsources.ExternalStreamSourceStateRepository;
import ch.marcovogt.epl.groupcollaborationsync.GroupStateRepository;
import ch.marcovogt.epl.pipelinebuilder.PipelineStateRepository;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinitionState;
import ch.marcovogt.epl.taskscenarioengine.TaskDefinitionStateRepository;
import ch.marcovogt.epl.taskscenarioengine.TaskPipelineConfigState;
import ch.marcovogt.epl.taskscenarioengine.TaskPipelineConfigStateRepository;
import ch.marcovogt.epl.taskscenarioengine.TaskStateRepository;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateRepository;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SystemDataTransferServiceTest {

    @Mock
    private AppSettingsRepository appSettingsRepository;

    @Mock
    private TaskStateRepository taskStateRepository;

    @Mock
    private TaskDefinitionStateRepository taskDefinitionStateRepository;

    @Mock
    private TaskPipelineConfigStateRepository taskPipelineConfigStateRepository;

    @Mock
    private FeedScenarioStateRepository feedScenarioStateRepository;

    @Mock
    private GroupStateRepository groupStateRepository;

    @Mock
    private PipelineStateRepository pipelineStateRepository;

    @Mock
    private AuthAccountRepository authAccountRepository;

    @Mock
    private AuthSessionRepository authSessionRepository;

    @Mock
    private DeviceStatusRepository deviceStatusRepository;

    @Mock
    private VirtualDeviceStateRepository virtualDeviceStateRepository;

    @Mock
    private ExternalStreamSourceStateRepository externalStreamSourceStateRepository;

    @Mock
    private AuditEntryRepository auditEntryRepository;

    @Mock
    private CanonicalEventRepository canonicalEventRepository;

    @Mock
    private EventFeedService eventFeedService;

    @Mock
    private AppSettingsService appSettingsService;

    private final ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

    private SystemDataTransferService service;

    @BeforeEach
    void setUp() {
        service = new SystemDataTransferService(
                appSettingsRepository,
                taskStateRepository,
                taskDefinitionStateRepository,
                taskPipelineConfigStateRepository,
                feedScenarioStateRepository,
                groupStateRepository,
                pipelineStateRepository,
                authAccountRepository,
                authSessionRepository,
                deviceStatusRepository,
                virtualDeviceStateRepository,
                externalStreamSourceStateRepository,
                auditEntryRepository,
                canonicalEventRepository,
                eventFeedService,
                appSettingsService,
                objectMapper
        );
    }

    @Test
    void verifyShouldDetectAvailableParts() {
        ArrayNode appSettings = objectMapper.createArrayNode();
        appSettings.addObject()
                .put("id", 1)
                .put("defaultLanguageMode", "EN")
                .put("timeFormat24h", true)
                .put("studentVirtualDeviceVisible", true)
                .put("virtualDeviceTopicMode", "OWN_TOPIC")
                .put("updatedAt", "2026-02-26T10:00:00Z")
                .put("updatedBy", "admin");

        SystemDataTransferDocument document = new SystemDataTransferDocument(
                1,
                Instant.parse("2026-02-26T10:00:00Z"),
                Map.of("APP_SETTINGS", appSettings)
        );

        SystemDataImportVerifyResponse verified = service.verifyImportDocument(document);

        assertThat(verified.valid()).isTrue();
        assertThat(verified.errors()).isEmpty();
        assertThat(verified.availableParts())
                .containsExactly(new SystemDataImportPartInfo(SystemDataPart.APP_SETTINGS, 1));
    }

    @Test
    void applyShouldRejectSelectingMissingPart() {
        SystemDataTransferDocument document = new SystemDataTransferDocument(
                1,
                Instant.parse("2026-02-26T10:00:00Z"),
                Map.of("APP_SETTINGS", objectMapper.createArrayNode())
        );

        assertThatThrownBy(() -> service.applyImport(document, Set.of(SystemDataPart.TASK_STATE)))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(error -> {
                    ResponseStatusException ex = (ResponseStatusException) error;
                    assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
                });
    }

    @Test
    void applyEventDataShouldReplaceRowsAndClearLiveBuffer() {
        SystemDataTransferDocument document = new SystemDataTransferDocument(
                1,
                Instant.parse("2026-02-26T10:00:00Z"),
                Map.of("EVENT_DATA", objectMapper.createArrayNode())
        );

        SystemDataImportApplyResponse imported = service.applyImport(document, Set.of(SystemDataPart.EVENT_DATA));

        verify(canonicalEventRepository).deleteAllInBatch();
        verify(eventFeedService).clearLiveBuffer();
        verify(appSettingsService, never()).getOrCreate();

        assertThat(imported.importedParts())
                .containsExactly(new SystemDataImportPartInfo(SystemDataPart.EVENT_DATA, 0));
    }

    @Test
    void exportArchiveShouldContainSchemaAndPartData() throws Exception {
        AppSettings appSettings = new AppSettings();
        appSettings.setId((short) 1);
        appSettings.setDefaultLanguageMode(LanguageMode.EN);
        appSettings.setTimeFormat24h(true);
        appSettings.setStudentVirtualDeviceVisible(true);
        appSettings.setVirtualDeviceTopicMode(VirtualDeviceTopicMode.OWN_TOPIC);
        appSettings.setUpdatedAt(Instant.parse("2026-02-26T10:00:00Z"));
        appSettings.setUpdatedBy("admin");
        when(appSettingsRepository.findAll(any(Sort.class))).thenReturn(List.of(appSettings));

        byte[] archiveBytes = service.exportDataArchive(Set.of(SystemDataPart.APP_SETTINGS));
        Map<String, String> entries = unzipUtf8Entries(archiveBytes);

        assertThat(entries).containsKey("schema.json");
        assertThat(entries).containsKey("parts/app_settings.json");
        assertThat(entries.get("schema.json")).contains("\"format\":\"EPL_SYSTEM_DATA_ZIP_V1\"");
        assertThat(entries.get("schema.json")).contains("\"part\":\"APP_SETTINGS\"");
        assertThat(entries.get("parts/app_settings.json")).contains("\"defaultLanguageMode\":\"EN\"");
    }

    @Test
    void exportArchiveShouldContainTaskDefinitionAndPipelineConfigData() throws Exception {
        TaskDefinitionState definition = new TaskDefinitionState();
        definition.setTaskId("task_custom");
        definition.setCustomTask(true);
        definition.setTitleDe("Titel");
        definition.setTitleEn("Title");
        definition.setDescriptionDe("Beschreibung");
        definition.setDescriptionEn("Description");
        definition.setActiveDescriptionDe("Aktiv DE");
        definition.setActiveDescriptionEn("Active EN");
        definition.setStudentCapabilitiesJson("{\"foo\":true}");
        definition.setPipelineJson("{\"bar\":1}");
        definition.setDeleted(false);
        definition.setUpdatedAt(Instant.parse("2026-02-26T10:00:00Z"));
        definition.setUpdatedBy("admin");
        when(taskDefinitionStateRepository.findAll(any(Sort.class))).thenReturn(List.of(definition));

        TaskPipelineConfigState pipelineConfig = new TaskPipelineConfigState();
        pipelineConfig.setTaskId("task_custom");
        pipelineConfig.setVisibleToStudents(true);
        pipelineConfig.setSlotCount(4);
        pipelineConfig.setAllowedProcessingBlocksJson("[\"FILTER_SOURCE\"]");
        pipelineConfig.setScenarioOverlaysJson("[]");
        pipelineConfig.setStudentSendEventEnabled(true);
        pipelineConfig.setStudentDeviceViewDisturbed(false);
        pipelineConfig.setUpdatedAt(Instant.parse("2026-02-26T10:00:00Z"));
        pipelineConfig.setUpdatedBy("admin");
        when(taskPipelineConfigStateRepository.findAll(any(Sort.class))).thenReturn(List.of(pipelineConfig));

        byte[] archiveBytes = service.exportDataArchive(Set.of(
                SystemDataPart.TASK_DEFINITION_STATE,
                SystemDataPart.TASK_PIPELINE_CONFIG_STATE
        ));
        Map<String, String> entries = unzipUtf8Entries(archiveBytes);

        assertThat(entries).containsKey("parts/task_definition_state.json");
        assertThat(entries).containsKey("parts/task_pipeline_config_state.json");
        assertThat(entries.get("parts/task_definition_state.json")).contains("\"taskId\":\"task_custom\"");
        assertThat(entries.get("parts/task_pipeline_config_state.json")).contains("\"slotCount\":4");
    }

    @Test
    void verifyArchiveShouldDetectAvailableParts() {
        byte[] archiveBytes = createArchive(
                """
                        {
                          "format":"EPL_SYSTEM_DATA_ZIP_V1",
                          "schemaVersion":1,
                          "exportedAt":"2026-02-26T10:00:00Z",
                          "parts":[{"part":"APP_SETTINGS","file":"parts/app_settings.json","rowCount":1}]
                        }
                        """,
                Map.of(
                        "parts/app_settings.json",
                        """
                                [{
                                  "id":1,
                                  "defaultLanguageMode":"EN",
                                  "timeFormat24h":true,
                                  "studentVirtualDeviceVisible":true,
                                  "virtualDeviceTopicMode":"OWN_TOPIC",
                                  "updatedAt":"2026-02-26T10:00:00Z",
                                  "updatedBy":"admin"
                                }]
                                """
                )
        );

        SystemDataImportVerifyResponse verified = service.verifyImportArchive(archiveBytes);

        assertThat(verified.valid()).isTrue();
        assertThat(verified.availableParts())
                .containsExactly(new SystemDataImportPartInfo(SystemDataPart.APP_SETTINGS, 1));
    }

    @Test
    void verifyArchiveShouldReportMissingSchema() {
        byte[] archiveBytes = createArchive(null, Map.of("parts/app_settings.json", "[]"));

        SystemDataImportVerifyResponse verified = service.verifyImportArchive(archiveBytes);

        assertThat(verified.valid()).isFalse();
        assertThat(verified.errors()).anyMatch(message -> message.contains("schema.json"));
    }

    @Test
    void exportDataShouldIncludeAllSystemDataParts() {
        SystemDataTransferDocument export = service.exportData(Set.of(SystemDataPart.values()));

        assertThat(export.parts().keySet())
                .containsExactlyElementsOf(
                        List.of(SystemDataPart.values()).stream().map(SystemDataPart::name).toList()
                );
    }

    private byte[] createArchive(String schemaJson, Map<String, String> partFiles) {
        try (java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
             java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(output)) {
            if (schemaJson != null) {
                zip.putNextEntry(new ZipEntry("schema.json"));
                zip.write(schemaJson.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            for (Map.Entry<String, String> entry : partFiles.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey()));
                zip.write(entry.getValue().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            zip.finish();
            return output.toByteArray();
        } catch (IOException ex) {
            throw new RuntimeException(ex);
        }
    }

    private Map<String, String> unzipUtf8Entries(byte[] archiveBytes) throws IOException {
        Map<String, String> entries = new LinkedHashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                byte[] payload = zip.readAllBytes();
                entries.put(entry.getName(), new String(payload, java.nio.charset.StandardCharsets.UTF_8));
            }
        }
        return entries;
    }
}
