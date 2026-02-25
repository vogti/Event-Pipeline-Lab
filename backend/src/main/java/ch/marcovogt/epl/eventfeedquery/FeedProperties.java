package ch.marcovogt.epl.eventfeedquery;

import jakarta.validation.constraints.Min;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "epl.feed")
public class FeedProperties {

    @Min(50)
    private int adminBufferSize = 500;

    public int getAdminBufferSize() {
        return adminBufferSize;
    }

    public void setAdminBufferSize(int adminBufferSize) {
        this.adminBufferSize = adminBufferSize;
    }
}
