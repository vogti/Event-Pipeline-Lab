package ch.marcovogt.epl.admin;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "app_settings")
public class AppSettings {

    @Id
    private Short id;

    @Enumerated(EnumType.STRING)
    @Column(name = "default_language_mode", nullable = false, length = 32)
    private LanguageMode defaultLanguageMode;

    @Column(name = "time_format_24h", nullable = false)
    private boolean timeFormat24h;

    @Column(name = "student_virtual_device_visible", nullable = false)
    private boolean studentVirtualDeviceVisible;

    @Column(name = "admin_device_id", length = 64)
    private String adminDeviceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "virtual_device_topic_mode", nullable = false, length = 32)
    private VirtualDeviceTopicMode virtualDeviceTopicMode;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false, length = 64)
    private String updatedBy;

    public Short getId() {
        return id;
    }

    public void setId(Short id) {
        this.id = id;
    }

    public LanguageMode getDefaultLanguageMode() {
        return defaultLanguageMode;
    }

    public void setDefaultLanguageMode(LanguageMode defaultLanguageMode) {
        this.defaultLanguageMode = defaultLanguageMode;
    }

    public boolean isTimeFormat24h() {
        return timeFormat24h;
    }

    public void setTimeFormat24h(boolean timeFormat24h) {
        this.timeFormat24h = timeFormat24h;
    }

    public boolean isStudentVirtualDeviceVisible() {
        return studentVirtualDeviceVisible;
    }

    public void setStudentVirtualDeviceVisible(boolean studentVirtualDeviceVisible) {
        this.studentVirtualDeviceVisible = studentVirtualDeviceVisible;
    }

    public String getAdminDeviceId() {
        return adminDeviceId;
    }

    public void setAdminDeviceId(String adminDeviceId) {
        this.adminDeviceId = adminDeviceId;
    }

    public VirtualDeviceTopicMode getVirtualDeviceTopicMode() {
        return virtualDeviceTopicMode;
    }

    public void setVirtualDeviceTopicMode(VirtualDeviceTopicMode virtualDeviceTopicMode) {
        this.virtualDeviceTopicMode = virtualDeviceTopicMode;
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
