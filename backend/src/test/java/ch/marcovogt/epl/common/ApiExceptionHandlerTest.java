package ch.marcovogt.epl.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ApiExceptionHandlerTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    @SuppressWarnings("unchecked")
    @Test
    void returnsDeterministicValidationMessage() {
        ConstraintViolation<Object> second = mock(ConstraintViolation.class);
        Path secondPath = mock(Path.class);
        when(secondPath.toString()).thenReturn("z.path");
        when(second.getPropertyPath()).thenReturn(secondPath);
        when(second.getMessage()).thenReturn("second");

        ConstraintViolation<Object> first = mock(ConstraintViolation.class);
        Path firstPath = mock(Path.class);
        when(firstPath.toString()).thenReturn("a.path");
        when(first.getPropertyPath()).thenReturn(firstPath);
        when(first.getMessage()).thenReturn("first");

        ConstraintViolationException exception = new ConstraintViolationException(Set.of(second, first));

        assertThat(handler.handleConstraintViolation(exception)).containsEntry("message", "first");
    }
}
