package ch.marcovogt.epl.eventfeedquery;

import ch.marcovogt.epl.eventingestionnormalization.CanonicalEventDto;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class PipelineLiveEventBuffer {

    private final Deque<CanonicalEventDto> buffer;
    private final int capacity;

    public PipelineLiveEventBuffer(FeedProperties feedProperties) {
        this.capacity = feedProperties.getAdminBufferSize();
        this.buffer = new ArrayDeque<>(capacity);
    }

    public synchronized void append(CanonicalEventDto event) {
        if (buffer.size() >= capacity) {
            buffer.removeFirst();
        }
        buffer.addLast(event);
    }

    public synchronized List<CanonicalEventDto> snapshot(int limit) {
        int boundedLimit = Math.max(1, Math.min(limit, capacity));
        int skipCount = Math.max(0, buffer.size() - boundedLimit);

        List<CanonicalEventDto> result = new ArrayList<>(boundedLimit);
        int index = 0;
        for (CanonicalEventDto event : buffer) {
            if (index++ < skipCount) {
                continue;
            }
            result.add(event);
        }
        return result;
    }

    public synchronized void clear() {
        buffer.clear();
    }
}
