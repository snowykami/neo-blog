package utils

import "testing"

func TestEmailUtils_SendEmail(t *testing.T) {
	templateString := "{{.A}} {{.B}} {{.C}}"
	data := map[string]interface{}{"A": 1, "B": 2, "C": 3}
	rendered, err := Email.RenderTemplate(templateString, data)
	if err != nil {
		t.Fatalf("RenderTemplate failed: %v", err)
	}
	expected := "1 2 3"
	if rendered != expected {
		t.Errorf("RenderTemplate = %q; want %q", rendered, expected)
	}
}
