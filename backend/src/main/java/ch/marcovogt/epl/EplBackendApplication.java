package ch.marcovogt.epl;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class EplBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(EplBackendApplication.class, args);
    }
}
