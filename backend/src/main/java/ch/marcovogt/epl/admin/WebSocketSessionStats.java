package ch.marcovogt.epl.admin;

public record WebSocketSessionStats(
        int admin,
        int student,
        int total
) {
}
