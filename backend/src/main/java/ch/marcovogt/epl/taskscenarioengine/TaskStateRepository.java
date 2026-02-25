package ch.marcovogt.epl.taskscenarioengine;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskStateRepository extends JpaRepository<TaskState, Short> {
}
