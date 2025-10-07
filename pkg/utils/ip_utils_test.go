package utils

import (
	"testing"
)

func TestGetIPInfo(t *testing.T) {
	r, err := GetIPInfo("1.1.1.1")
	t.Log(r, err)
}
