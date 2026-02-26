package ch.marcovogt.epl.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import ch.marcovogt.epl.authsession.AuthAccountRepository;
import ch.marcovogt.epl.authsession.AuthSessionRepository;
import ch.marcovogt.epl.deviceregistryhealth.DeviceStatusRepository;
import ch.marcovogt.epl.eventfeedquery.EventFeedService;
import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventRepository;
import ch.marcovogt.epl.groupcollaborationsync.GroupStateRepository;
import ch.marcovogt.epl.taskscenarioengine.TaskStateRepository;
import ch.marcovogt.epl.virtualdevice.VirtualDeviceStateRepository;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@ExtendWith(MockitoExtension.class)
class SystemDataTransferServiceTest {

    @Mock
    private AppSettingsRepository appSettingsRepository;

    @Mock
    private TaskStateRepository taskStateRepository;

    @Mock
    private GroupStateRepository groupStateRepository;

    @Mock
    private AuthAccountRepository authAccountRepository;

    @Mock
    private AuthSessionRepository authSessionRepository;

    @Mock
    private DeviceStatusRepository deviceStatusRepository;

    @Mock
    private VirtualDeviceStateRepository virtualDeviceStateRepository;

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
                groupStateRepository,
                authAccountRepository,
                authSessionRepository,
                deviceStatusRepository,
                virtualDeviceStateRepository,
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
}
