package ch.marcovogt.epl.taskscenarioengine;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "task_definition_state")
public class TaskDefinitionState {

    @Id
    @Column(name = "task_id", nullable = false, length = 64)
    private String taskId;

    @Column(name = "custom_task", nullable = false)
    private boolean customTask;

    @Column(name = "title_de", nullable = false, length = 255)
    private String titleDe;

    @Column(name = "title_en", nullable = false, length = 255)
    private String titleEn;

    @Column(name = "description_de", nullable = false, columnDefinition = "text")
    private String descriptionDe;

    @Column(name = "description_en", nullable = false, columnDefinition = "text")
    private String descriptionEn;

    @Column(name = "student_capabilities_json", columnDefinition = "text")
    private String studentCapabilitiesJson;

    @Column(name = "pipeline_json", columnDefinition = "text")
    private String pipelineJson;

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

    public boolean isCustomTask() {
        return customTask;
    }

    public void setCustomTask(boolean customTask) {
        this.customTask = customTask;
    }

    public String getTitleDe() {
        return titleDe;
    }

    public void setTitleDe(String titleDe) {
        this.titleDe = titleDe;
    }

    public String getTitleEn() {
        return titleEn;
    }

    public void setTitleEn(String titleEn) {
        this.titleEn = titleEn;
    }

    public String getDescriptionDe() {
        return descriptionDe;
    }

    public void setDescriptionDe(String descriptionDe) {
        this.descriptionDe = descriptionDe;
    }

    public String getDescriptionEn() {
        return descriptionEn;
    }

    public void setDescriptionEn(String descriptionEn) {
        this.descriptionEn = descriptionEn;
    }

    public String getStudentCapabilitiesJson() {
        return studentCapabilitiesJson;
    }

    public void setStudentCapabilitiesJson(String studentCapabilitiesJson) {
        this.studentCapabilitiesJson = studentCapabilitiesJson;
    }

    public String getPipelineJson() {
        return pipelineJson;
    }

    public void setPipelineJson(String pipelineJson) {
        this.pipelineJson = pipelineJson;
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
