package ch.marcovogt.epl.pipelinebuilder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

public final class PipelineScenarioOverlayCodec {

    private static final Pattern DUPLICATES_PATTERN =
            Pattern.compile("^(duplicates?)\\s*:\\s*(\\d+)\\s*%?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern DELAY_PATTERN =
            Pattern.compile("^(delay)\\s*:\\s*(\\d+)\\s*ms?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern DROPS_PATTERN =
            Pattern.compile("^(drop|drops)\\s*:\\s*(\\d+)\\s*%?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern OUT_OF_ORDER_PATTERN =
            Pattern.compile("^(out[_-]?of[_-]?order|out_of_order)\\s*:\\s*(\\d+)\\s*%?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern REORDER_BUFFER_PATTERN =
            Pattern.compile(
                    "^(reorder[_-]?buffer|reorder_buffer|out[_-]?of[_-]?order[_-]?buffer|out_of_order_buffer)\\s*:\\s*(\\d+)\\s*ms?$",
                    Pattern.CASE_INSENSITIVE
            );

    private static final String TYPE_DUPLICATES = "duplicates";
    private static final String TYPE_DELAY = "delay";
    private static final String TYPE_DROPS = "drops";
    private static final String TYPE_OUT_OF_ORDER = "out_of_order";
    private static final String TYPE_REORDER_BUFFER = "reorder_buffer";

    private static final int MAX_DUPLICATES_PERCENT = 100;
    private static final int MAX_DELAY_MS = 10_000;
    private static final int MAX_DROPS_PERCENT = 100;
    private static final int MAX_OUT_OF_ORDER_PERCENT = 100;
    private static final int MAX_REORDER_BUFFER_MS = 10_000;

    private PipelineScenarioOverlayCodec() {
    }

    public static List<String> normalize(List<String> rawOverlays, boolean strict) {
        if (rawOverlays == null || rawOverlays.isEmpty()) {
            return List.of();
        }

        Map<String, Integer> values = new LinkedHashMap<>();
        for (String rawEntry : rawOverlays) {
            if (rawEntry == null) {
                continue;
            }
            String entry = rawEntry.trim();
            if (entry.isEmpty()) {
                continue;
            }

            ParsedScenario parsed = parse(entry);
            if (parsed == null) {
                if (strict) {
                    throw new ResponseStatusException(BAD_REQUEST, "Unsupported scenario overlay: " + entry);
                }
                continue;
            }

            Integer normalizedValue = normalizeValue(parsed.type(), parsed.value(), strict);
            if (normalizedValue == null) {
                continue;
            }
            values.put(parsed.type(), normalizedValue);
        }

        java.util.ArrayList<String> normalized = new java.util.ArrayList<>();
        appendIfPresent(normalized, render(values, TYPE_DUPLICATES));
        appendIfPresent(normalized, render(values, TYPE_DELAY));
        appendIfPresent(normalized, render(values, TYPE_DROPS));
        appendIfPresent(normalized, render(values, TYPE_OUT_OF_ORDER));
        appendIfPresent(normalized, render(values, TYPE_REORDER_BUFFER));
        return List.copyOf(normalized);
    }

    private static void appendIfPresent(List<String> target, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        target.add(value);
    }

    private static String render(Map<String, Integer> values, String type) {
        Integer value = values.get(type);
        if (value == null || value <= 0) {
            return null;
        }
        return switch (type) {
            case TYPE_DUPLICATES -> TYPE_DUPLICATES + ":" + value + "%";
            case TYPE_DELAY -> TYPE_DELAY + ":" + value + "ms";
            case TYPE_DROPS -> TYPE_DROPS + ":" + value + "%";
            case TYPE_OUT_OF_ORDER -> TYPE_OUT_OF_ORDER + ":" + value + "%";
            case TYPE_REORDER_BUFFER -> TYPE_REORDER_BUFFER + ":" + value + "ms";
            default -> null;
        };
    }

    private static Integer normalizeValue(String type, int value, boolean strict) {
        int max = switch (type) {
            case TYPE_DUPLICATES -> MAX_DUPLICATES_PERCENT;
            case TYPE_DELAY -> MAX_DELAY_MS;
            case TYPE_DROPS -> MAX_DROPS_PERCENT;
            case TYPE_OUT_OF_ORDER -> MAX_OUT_OF_ORDER_PERCENT;
            case TYPE_REORDER_BUFFER -> MAX_REORDER_BUFFER_MS;
            default -> 0;
        };

        if (value < 0 || value > max) {
            if (strict) {
                throw new ResponseStatusException(
                        BAD_REQUEST,
                        "Scenario value out of range for " + type + ": 0-" + max
                );
            }
            if (value < 0) {
                return null;
            }
            return max;
        }
        return value;
    }

    private static ParsedScenario parse(String entry) {
        ParsedScenario parsed = parseWithPattern(entry, DUPLICATES_PATTERN, TYPE_DUPLICATES);
        if (parsed != null) {
            return parsed;
        }
        parsed = parseWithPattern(entry, DELAY_PATTERN, TYPE_DELAY);
        if (parsed != null) {
            return parsed;
        }
        parsed = parseWithPattern(entry, DROPS_PATTERN, TYPE_DROPS);
        if (parsed != null) {
            return parsed;
        }
        parsed = parseWithPattern(entry, OUT_OF_ORDER_PATTERN, TYPE_OUT_OF_ORDER);
        if (parsed != null) {
            return parsed;
        }
        return parseWithPattern(entry, REORDER_BUFFER_PATTERN, TYPE_REORDER_BUFFER);
    }

    private static ParsedScenario parseWithPattern(String entry, Pattern pattern, String normalizedType) {
        Matcher matcher = pattern.matcher(entry);
        if (!matcher.matches()) {
            return null;
        }
        int value;
        try {
            value = Integer.parseInt(matcher.group(2));
        } catch (NumberFormatException ex) {
            return null;
        }
        return new ParsedScenario(normalizedType, value);
    }

    private record ParsedScenario(String type, int value) {
    }
}
