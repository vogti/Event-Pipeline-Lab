package ch.marcovogt.epl.authsession;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "auth_account")
public class AuthAccount {

    @Id
    @Column(nullable = false, length = 64)
    private String username;

    @Column(name = "pin_code", nullable = false, length = 128)
    private String pinCode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private AppRole role;

    @Column(name = "group_key", length = 128)
    private String groupKey;

    @Column(nullable = false)
    private boolean enabled;

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPinCode() {
        return pinCode;
    }

    public void setPinCode(String pinCode) {
        this.pinCode = pinCode;
    }

    public AppRole getRole() {
        return role;
    }

    public void setRole(AppRole role) {
        this.role = role;
    }

    public String getGroupKey() {
        return groupKey;
    }

    public void setGroupKey(String groupKey) {
        this.groupKey = groupKey;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
}
