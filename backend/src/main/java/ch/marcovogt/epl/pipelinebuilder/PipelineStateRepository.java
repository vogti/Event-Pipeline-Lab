package ch.marcovogt.epl.pipelinebuilder;

import java.util.Optional;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PipelineStateRepository extends JpaRepository<PipelineState, PipelineStateId> {

    Optional<PipelineState> findByTaskIdAndOwnerTypeAndOwnerKey(String taskId, PipelineOwnerType ownerType, String ownerKey);

    List<PipelineState> findAllByOwnerTypeAndOwnerKey(PipelineOwnerType ownerType, String ownerKey);

    boolean existsByOwnerTypeAndOwnerKeyAndRevisionGreaterThan(PipelineOwnerType ownerType, String ownerKey, long revision);
}
