package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.pipelinebuilder.PipelineScenarioOverlayCodec;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FeedScenarioService {

    private static final short STATE_ID = 1;

    private final FeedScenarioStateRepository repository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public FeedScenarioService(FeedScenarioStateRepository repository, ObjectMapper objectMapper) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional(readOnly = true)
    public FeedScenarioConfigDto getConfig() {
        FeedScenarioState state = loadOrCreate();
        return toDto(state);
    }

    @Transactional
    public FeedScenarioConfigDto updateConfig(List<String> scenarioOverlays, String actor) {
        FeedScenarioState state = loadOrCreate();
        List<String> normalized = PipelineScenarioOverlayCodec.normalize(scenarioOverlays, true);
        persist(state, normalized, actor);
        return toDto(state);
    }

    @Transactional
    public FeedScenarioConfigDto applyPreset(List<String> scenarioOverlays, String actor) {
        FeedScenarioState state = loadOrCreate();
        List<String> normalized = PipelineScenarioOverlayCodec.normalize(scenarioOverlays, false);
        persist(state, normalized, actor);
        return toDto(state);
    }

    private FeedScenarioState loadOrCreate() {
        return repository.findById(STATE_ID).orElseGet(() -> {
            FeedScenarioState created = new FeedScenarioState();
            created.setId(STATE_ID);
            created.setOverlaysJson("[]");
            created.setUpdatedAt(Instant.now(clock));
            created.setUpdatedBy("system");
            return repository.save(created);
        });
    }

    private void persist(FeedScenarioState state, List<String> scenarioOverlays, String actor) {
        state.setOverlaysJson(serialize(scenarioOverlays));
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(actor == null || actor.isBlank() ? "system" : actor);
        repository.save(state);
    }

    private FeedScenarioConfigDto toDto(FeedScenarioState state) {
        return new FeedScenarioConfigDto(
                deserialize(state.getOverlaysJson()),
                state.getUpdatedAt(),
                state.getUpdatedBy()
        );
    }

    private String serialize(List<String> overlays) {
        try {
            return objectMapper.writeValueAsString(overlays == null ? List.of() : overlays);
        } catch (JsonProcessingException ex) {
            return "[]";
        }
    }

    private List<String> deserialize(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        try {
            @SuppressWarnings("unchecked")
            List<String> parsed = objectMapper.readValue(raw, List.class);
            return PipelineScenarioOverlayCodec.normalize(parsed == null ? List.of() : parsed, false);
        } catch (JsonProcessingException ex) {
            return List.of();
        }
    }
}
