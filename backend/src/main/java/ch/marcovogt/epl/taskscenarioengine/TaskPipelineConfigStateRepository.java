package ch.marcovogt.epl.taskscenarioengine;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskPipelineConfigStateRepository extends JpaRepository<TaskPipelineConfigState, String> {
}
