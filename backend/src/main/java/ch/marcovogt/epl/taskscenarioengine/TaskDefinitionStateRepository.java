package ch.marcovogt.epl.taskscenarioengine;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskDefinitionStateRepository extends JpaRepository<TaskDefinitionState, String> {
}
