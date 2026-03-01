package ch.marcovogt.epl.externalsources;

import ch.marcovogt.epl.eventingestionnormalization.EventIngestionService;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

@Component
public class WikimediaEventStreamClient implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(WikimediaEventStreamClient.class);

    private static final String SOURCE_ID = ExternalStreamSourceIds.WIKIMEDIA_EVENTSTREAM;
    private static final String INBOUND_TOPIC = "ext/wikimedia/recentchange";

    private final ExternalStreamSourceService streamSourceService;
    private final EventIngestionService eventIngestionService;
    private final WikimediaEventStreamProperties properties;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable);
        thread.setName("wikimedia-eventstream-worker");
        thread.setDaemon(true);
        return thread;
    });

    private volatile boolean running;

    public WikimediaEventStreamClient(
            ExternalStreamSourceService streamSourceService,
            EventIngestionService eventIngestionService,
            WikimediaEventStreamProperties properties
    ) {
        this.streamSourceService = streamSourceService;
        this.eventIngestionService = eventIngestionService;
        this.properties = properties;
    }

    @Override
    public synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        worker.execute(this::runLoop);
    }

    @Override
    public synchronized void stop() {
        running = false;
        worker.shutdownNow();
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MIN_VALUE + 50;
    }

    @Override
    public boolean isAutoStartup() {
        return true;
    }

    @Override
    public void stop(Runnable callback) {
        stop();
        callback.run();
    }

    private void runLoop() {
        while (running) {
            long delayMs = consumeOnce();
            if (!running) {
                break;
            }
            sleep(delayMs);
        }
    }

    private long consumeOnce() {
        if (!streamSourceService.isEnabled(SOURCE_ID)) {
            streamSourceService.markRuntimeDisconnected(SOURCE_ID, null);
            return Math.max(500L, properties.getDisabledPollDelayMs());
        }

        String endpointUrl = streamSourceService.endpointUrl(SOURCE_ID);
        HttpURLConnection connection = null;
        try {
            connection = openConnection(endpointUrl);
            int statusCode = connection.getResponseCode();
            if (statusCode < 200 || statusCode >= 300) {
                String body = readErrorBody(connection);
                throw new IOException("HTTP " + statusCode + (body.isBlank() ? "" : " - " + body));
            }

            streamSourceService.markRuntimeConnected(SOURCE_ID);
            log.info("Wikimedia stream connected endpoint={}", endpointUrl);
            consumeSseBody(connection.getInputStream());
            streamSourceService.markRuntimeDisconnected(SOURCE_ID, null);
            log.info("Wikimedia stream disconnected endpoint={}", endpointUrl);
        } catch (Exception ex) {
            String reason = ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage();
            streamSourceService.markRuntimeDisconnected(SOURCE_ID, reason);
            log.warn("Wikimedia stream error: {}", reason);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
        return Math.max(1000L, properties.getReconnectDelayMs());
    }

    private HttpURLConnection openConnection(String endpointUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) URI.create(endpointUrl).toURL().openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(Math.max(1000, properties.getConnectTimeoutMs()));
        connection.setReadTimeout(Math.max(1000, properties.getReadTimeoutMs()));
        connection.setRequestProperty("Accept", "text/event-stream");
        connection.setRequestProperty("Cache-Control", "no-cache");
        String userAgent = properties.getUserAgent();
        if (userAgent != null && !userAgent.isBlank()) {
            connection.setRequestProperty("User-Agent", userAgent.trim());
        }
        connection.setDoInput(true);
        connection.connect();
        return connection;
    }

    private void consumeSseBody(InputStream inputStream) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            StringBuilder dataBuffer = new StringBuilder();
            while (running) {
                if (!streamSourceService.isEnabled(SOURCE_ID)) {
                    dispatchSseData(dataBuffer);
                    return;
                }
                String line;
                try {
                    line = reader.readLine();
                } catch (SocketTimeoutException timeout) {
                    if (!streamSourceService.isEnabled(SOURCE_ID)) {
                        return;
                    }
                    continue;
                }

                if (line == null) {
                    dispatchSseData(dataBuffer);
                    return;
                }
                if (!streamSourceService.isEnabled(SOURCE_ID)) {
                    dispatchSseData(dataBuffer);
                    return;
                }
                if (line.isEmpty()) {
                    dispatchSseData(dataBuffer);
                    continue;
                }
                if (line.startsWith("data:")) {
                    if (!dataBuffer.isEmpty()) {
                        dataBuffer.append('\n');
                    }
                    dataBuffer.append(line.substring("data:".length()).stripLeading());
                }
            }
        }
    }

    private void dispatchSseData(StringBuilder dataBuffer) {
        if (dataBuffer == null || dataBuffer.isEmpty()) {
            return;
        }
        if (!streamSourceService.isEnabled(SOURCE_ID)) {
            dataBuffer.setLength(0);
            return;
        }
        String payload = dataBuffer.toString().trim();
        dataBuffer.setLength(0);
        if (payload.isEmpty()) {
            return;
        }
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > Math.max(1024, properties.getMaxPayloadBytes())) {
            log.warn("Skipping Wikimedia event because payload is too large ({} bytes)", bytes.length);
            return;
        }
        try {
            eventIngestionService.ingest(INBOUND_TOPIC, bytes);
            streamSourceService.markRuntimeEventReceived(SOURCE_ID, Instant.now());
        } catch (Exception ex) {
            log.warn("Failed to ingest Wikimedia event: {}", ex.getMessage());
        }
    }

    private String readErrorBody(HttpURLConnection connection) {
        try (InputStream errorStream = connection.getErrorStream()) {
            if (errorStream == null) {
                return "";
            }
            byte[] bytes = errorStream.readNBytes(512);
            return new String(bytes, StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private void sleep(long delayMs) {
        long boundedDelay = Math.max(250L, delayMs);
        try {
            TimeUnit.MILLISECONDS.sleep(boundedDelay);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
