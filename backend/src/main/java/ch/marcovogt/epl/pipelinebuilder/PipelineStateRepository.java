package ch.marcovogt.epl.pipelinebuilder;

import java.util.Optional;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PipelineStateRepository extends JpaRepository<PipelineState, PipelineStateId> {

    Optional<PipelineState> findByTaskIdAndOwnerTypeAndOwnerKey(String taskId, PipelineOwnerType ownerType, String ownerKey);

    List<PipelineState> findAllByOwnerTypeAndOwnerKey(PipelineOwnerType ownerType, String ownerKey);

    boolean existsByOwnerTypeAndOwnerKeyAndRevisionGreaterThan(PipelineOwnerType ownerType, String ownerKey, long revision);

    @Modifying
    @Query(
            value = """
                    insert into pipeline_state
                        (task_id, owner_type, owner_key, state_json, revision, updated_at, updated_by)
                    values
                        (:taskId, :ownerType, :ownerKey, :stateJson, :revision, :updatedAt, :updatedBy)
                    on conflict (task_id, owner_type, owner_key) do nothing
                    """,
            nativeQuery = true
    )
    int insertIfAbsent(
            @Param("taskId") String taskId,
            @Param("ownerType") String ownerType,
            @Param("ownerKey") String ownerKey,
            @Param("stateJson") String stateJson,
            @Param("revision") long revision,
            @Param("updatedAt") java.time.Instant updatedAt,
            @Param("updatedBy") String updatedBy
    );
}
