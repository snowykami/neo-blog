package repo

import "testing"

func TestKvRepo_GetKV(t *testing.T) {
	err := KV.SetKV("AAA", map[string]interface{}{"b": 1, "c": "2"})
	if err != nil {
		t.Fatal(err)
	}
	v, _ := KV.GetKV("AAA")
	t.Log(v)
	if v.(map[string]interface{})["b"] != float64(1) {
		t.Fatal("b not equal")
	}
	if v.(map[string]interface{})["c"] != "2" {
		t.Fatal("c not equal")
	}
}
