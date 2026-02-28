package ch.marcovogt.epl.mqttgateway;

import java.util.function.Supplier;
import org.springframework.stereotype.Component;

@Component
public class PublishSourceContext {

    private final ThreadLocal<String> sourceHolder = new ThreadLocal<>();

    public void runWithSource(String source, Runnable action) {
        if (action == null) {
            return;
        }
        if (source == null || source.isBlank()) {
            action.run();
            return;
        }

        String previous = sourceHolder.get();
        sourceHolder.set(source.trim());
        try {
            action.run();
        } finally {
            restore(previous);
        }
    }

    public <T> T supplyWithSource(String source, Supplier<T> action) {
        if (action == null) {
            return null;
        }
        if (source == null || source.isBlank()) {
            return action.get();
        }

        String previous = sourceHolder.get();
        sourceHolder.set(source.trim());
        try {
            return action.get();
        } finally {
            restore(previous);
        }
    }

    public String currentSource() {
        return sourceHolder.get();
    }

    private void restore(String previous) {
        if (previous == null || previous.isBlank()) {
            sourceHolder.remove();
        } else {
            sourceHolder.set(previous);
        }
    }
}

