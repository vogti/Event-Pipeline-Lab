package ch.marcovogt.epl.pipelinebuilder;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PipelineStateRepository extends JpaRepository<PipelineState, PipelineStateId> {

    Optional<PipelineState> findByTaskIdAndOwnerTypeAndOwnerKey(String taskId, PipelineOwnerType ownerType, String ownerKey);
}
