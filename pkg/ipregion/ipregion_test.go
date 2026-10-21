package ipregion

import "testing"

func TestLookup(t *testing.T) {
	cases := map[string]string{
		"222.178.10.1":  "重庆市 电信",
		"113.92.157.29": "广东省 深圳市 电信",
		"1.1.1.1":       "Australia Queensland Brisbane",
		"192.168.1.1":   "局域网",
		"127.0.0.1":     "局域网",
		"not-an-ip":     "",
	}
	for ip, want := range cases {
		if got := Lookup(ip).String(); got != want {
			t.Errorf("Lookup(%q) = %q, want %q", ip, got, want)
		}
	}
}
