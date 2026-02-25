package ch.marcovogt.epl.groupcollaborationsync;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GroupStateService {

    private final GroupStateRepository groupStateRepository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public GroupStateService(GroupStateRepository groupStateRepository, ObjectMapper objectMapper) {
        this.groupStateRepository = groupStateRepository;
        this.objectMapper = objectMapper;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public GroupConfigDto getOrCreate(String groupKey) {
        GroupState state = groupStateRepository.findById(groupKey)
                .orElseGet(() -> {
                    GroupState created = new GroupState();
                    created.setGroupKey(groupKey);
                    created.setConfigJson("{}");
                    created.setRevision(0L);
                    created.setUpdatedAt(Instant.now(clock));
                    created.setUpdatedBy("system");
                    return groupStateRepository.save(created);
                });

        return toDto(state);
    }

    @Transactional
    public GroupConfigDto updateConfig(String groupKey, Map<String, Object> config, String updatedBy) {
        GroupState state = groupStateRepository.findById(groupKey)
                .orElseGet(() -> {
                    GroupState created = new GroupState();
                    created.setGroupKey(groupKey);
                    created.setRevision(0L);
                    return created;
                });

        state.setConfigJson(serialize(config));
        state.setRevision(state.getRevision() + 1);
        state.setUpdatedAt(Instant.now(clock));
        state.setUpdatedBy(updatedBy);

        return toDto(groupStateRepository.save(state));
    }

    private GroupConfigDto toDto(GroupState state) {
        return new GroupConfigDto(
                state.getGroupKey(),
                deserialize(state.getConfigJson()),
                state.getRevision(),
                state.getUpdatedAt(),
                state.getUpdatedBy()
        );
    }

    private String serialize(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException ex) {
            return "{}";
        }
    }

    private Map<String, Object> deserialize(String raw) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> mapped = objectMapper.readValue(raw, Map.class);
            return mapped == null ? Map.of() : mapped;
        } catch (JsonProcessingException ex) {
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("_raw", raw);
            return fallback;
        }
    }
}
