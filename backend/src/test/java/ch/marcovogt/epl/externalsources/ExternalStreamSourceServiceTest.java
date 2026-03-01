package ch.marcovogt.epl.externalsources;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class ExternalStreamSourceServiceTest {

    @Mock
    private ExternalStreamSourceStateRepository stateRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    private ExternalStreamSourceService service;

    @BeforeEach
    void setUp() {
        service = new ExternalStreamSourceService(stateRepository, jdbcTemplate);
    }

    @Test
    void shouldListWikimediaSourceWithRuntimeStatusAndCounter() {
        ExternalStreamSourceState state = state(
                true,
                "https://stream.wikimedia.org/v2/stream/recentchange",
                Instant.parse("2026-03-01T11:00:00Z")
        );

        when(stateRepository.existsById(ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM)).thenReturn(true);
        when(stateRepository.findAllByOrderBySourceIdAsc()).thenReturn(List.of(state));
        when(jdbcTemplate.queryForObject(any(String.class), eq(Long.class), eq(state.getSourceId()), any()))
                .thenReturn(42L);

        service.markRuntimeConnected(ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM);
        service.markRuntimeEventReceived(
                ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM,
                Instant.parse("2026-03-01T11:01:00Z")
        );

        List<ExternalStreamSourceDto> result = service.listSources();

        assertThat(result).hasSize(1);
        ExternalStreamSourceDto dto = result.getFirst();
        assertThat(dto.sourceId()).isEqualTo(ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM);
        assertThat(dto.displayName()).isEqualTo("Wikimedia EventStream");
        assertThat(dto.enabled()).isTrue();
        assertThat(dto.online()).isTrue();
        assertThat(dto.eventsSinceReset()).isEqualTo(42L);
        assertThat(dto.lastEventAt()).isEqualTo(Instant.parse("2026-03-01T11:01:00Z"));
    }

    @Test
    void shouldDisableSourceAndReturnOfflineStatus() {
        ExternalStreamSourceState state = state(
                true,
                "https://stream.wikimedia.org/v2/stream/recentchange",
                Instant.parse("2026-03-01T11:00:00Z")
        );
        when(stateRepository.findById(ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM))
                .thenReturn(Optional.of(state));
        when(stateRepository.save(any(ExternalStreamSourceState.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(jdbcTemplate.queryForObject(any(String.class), eq(Long.class), eq(state.getSourceId()), any()))
                .thenReturn(0L);

        service.markRuntimeConnected(ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM);
        ExternalStreamSourceDto updated = service.setEnabled(
                ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM,
                false,
                "admin"
        );

        assertThat(updated.enabled()).isFalse();
        assertThat(updated.online()).isFalse();
    }

    private ExternalStreamSourceState state(boolean enabled, String endpointUrl, Instant counterResetAt) {
        ExternalStreamSourceState state = new ExternalStreamSourceState();
        state.setSourceId(ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM);
        state.setEnabled(enabled);
        state.setEndpointUrl(endpointUrl);
        state.setCounterResetAt(counterResetAt);
        state.setUpdatedAt(Instant.parse("2026-03-01T10:55:00Z"));
        state.setUpdatedBy("system");
        return state;
    }
}
