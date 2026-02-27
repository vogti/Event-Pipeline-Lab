package ch.marcovogt.epl.taskscenarioengine;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "task_pipeline_config")
public class TaskPipelineConfigState {

    @Id
    @Column(name = "task_id", nullable = false, length = 64)
    private String taskId;

    @Column(name = "visible_to_students", nullable = false)
    private boolean visibleToStudents;

    @Column(name = "slot_count", nullable = false)
    private int slotCount;

    @Column(name = "allowed_processing_blocks_json", nullable = false, columnDefinition = "text")
    private String allowedProcessingBlocksJson;

    @Column(name = "scenario_overlays_json", columnDefinition = "text")
    private String scenarioOverlaysJson;

    @Enumerated(EnumType.STRING)
    @Column(name = "student_event_visibility_scope", length = 32)
    private StudentDeviceScope studentEventVisibilityScope;

    @Enumerated(EnumType.STRING)
    @Column(name = "student_command_target_scope", length = 32)
    private StudentDeviceScope studentCommandTargetScope;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 64)
    private String updatedBy;

    public String getTaskId() {
        return taskId;
    }

    public void setTaskId(String taskId) {
        this.taskId = taskId;
    }

    public boolean isVisibleToStudents() {
        return visibleToStudents;
    }

    public void setVisibleToStudents(boolean visibleToStudents) {
        this.visibleToStudents = visibleToStudents;
    }

    public int getSlotCount() {
        return slotCount;
    }

    public void setSlotCount(int slotCount) {
        this.slotCount = slotCount;
    }

    public String getAllowedProcessingBlocksJson() {
        return allowedProcessingBlocksJson;
    }

    public void setAllowedProcessingBlocksJson(String allowedProcessingBlocksJson) {
        this.allowedProcessingBlocksJson = allowedProcessingBlocksJson;
    }

    public String getScenarioOverlaysJson() {
        return scenarioOverlaysJson;
    }

    public void setScenarioOverlaysJson(String scenarioOverlaysJson) {
        this.scenarioOverlaysJson = scenarioOverlaysJson;
    }

    public StudentDeviceScope getStudentEventVisibilityScope() {
        return studentEventVisibilityScope;
    }

    public void setStudentEventVisibilityScope(StudentDeviceScope studentEventVisibilityScope) {
        this.studentEventVisibilityScope = studentEventVisibilityScope;
    }

    public StudentDeviceScope getStudentCommandTargetScope() {
        return studentCommandTargetScope;
    }

    public void setStudentCommandTargetScope(StudentDeviceScope studentCommandTargetScope) {
        this.studentCommandTargetScope = studentCommandTargetScope;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getUpdatedBy() {
        return updatedBy;
    }

    public void setUpdatedBy(String updatedBy) {
        this.updatedBy = updatedBy;
    }
}
