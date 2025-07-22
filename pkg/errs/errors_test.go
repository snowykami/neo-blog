package errs

import (
	"testing"
)

func TestAsServiceError(c) {
	serviceError := ErrNotFound
	err := AsServiceError(serviceError)
	if err.Code != serviceError.Code || err.Message != serviceError.Message {
		t.Errorf("Expected %v, got %v", serviceError, err)
	}

	serviceError = New(520, "Custom error", nil)
	err = AsServiceError(serviceError)
	if err.Code != serviceError.Code || err.Message != serviceError.Message {
		t.Errorf("Expected %v, got %v", serviceError, err)
	}
}
