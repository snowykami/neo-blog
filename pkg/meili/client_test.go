package meili

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"
)

type handlerTransport struct {
	h http.Handler
}

func (t handlerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rec := httptest.NewRecorder()
	t.h.ServeHTTP(rec, req)
	return rec.Result(), nil
}

func TestParseHighlighted(t *testing.T) {
	raw := "欢迎使用 " + HighlightPre + "Kubernetes" + HighlightPost + " 部署 " + HighlightPre + "Neo" + HighlightPost + " 博客"
	clean, terms := ParseHighlighted(raw)
	if clean != "欢迎使用 Kubernetes 部署 Neo 博客" {
		t.Fatalf("unexpected clean text: %q", clean)
	}
	if !slices.Equal(terms, []string{"Kubernetes", "Neo"}) {
		t.Fatalf("unexpected terms: %v", terms)
	}
}

func TestClientOperations(t *testing.T) {
	var gotAuth string
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/health":
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "available"})
		case "/version":
			_ = json.NewEncoder(w).Encode(map[string]string{"pkgVersion": "1.12.0"})
		case "/stats":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"databaseSize":     40960,
				"usedDatabaseSize": 20480,
				"indexes": map[string]any{
					"neo_posts": map[string]any{"numberOfDocuments": 42, "isIndexing": false},
				},
			})
		case "/tasks":
			switch r.URL.Query().Get("statuses") {
			case "enqueued,processing":
				_ = json.NewEncoder(w).Encode(map[string]any{"total": 2})
			case "succeeded":
				_ = json.NewEncoder(w).Encode(map[string]any{"total": 100})
			case "failed":
				_ = json.NewEncoder(w).Encode(map[string]any{"total": 1})
			}
		case "/multi-search":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"results": []any{
					map[string]any{
						"hits": []any{
							map[string]any{
								"id": 7,
								"_formatted": map[string]any{
									"title": "Hello " + HighlightPre + "World" + HighlightPost,
								},
							},
						},
						"estimatedTotalHits": 1,
					},
				},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "index_not_found", "message": "not found"})
		}
	})

	client := NewClient("http://meilisearch:7700", "secret-key", 2*time.Second).WithTransport(handlerTransport{h: handler})
	ctx := context.Background()

	if err := client.Health(ctx); err != nil {
		t.Fatalf("Health failed: %v", err)
	}
	if gotAuth != "Bearer secret-key" {
		t.Fatalf("unexpected auth header: %q", gotAuth)
	}
	if client.Location() != "meilisearch:7700" {
		t.Fatalf("Location = %q", client.Location())
	}
	ver, err := client.Version(ctx)
	if err != nil || ver != "1.12.0" {
		t.Fatalf("Version = %q, %v", ver, err)
	}
	stats, err := client.Stats(ctx)
	if err != nil || stats.Indexes["neo_posts"].NumberOfDocuments != 42 {
		t.Fatalf("Stats = %+v, %v", stats, err)
	}
	tasks, err := client.TaskCounts(ctx)
	if err != nil || tasks.Pending != 2 || tasks.Succeeded != 100 || tasks.Failed != 1 {
		t.Fatalf("TaskCounts = %+v, %v", tasks, err)
	}
	results, err := client.MultiSearch(ctx, []SearchQuery{{
		IndexUID:              "neo_posts",
		Query:                 "world",
		AttributesToHighlight: []string{"title"},
	}})
	if err != nil || len(results) != 1 || len(results[0].Hits) != 1 {
		t.Fatalf("MultiSearch = %+v, %v", results, err)
	}
	id, ok := HitUintID(results[0].Hits[0])
	if !ok || id != 7 {
		t.Fatalf("HitUintID = %d, %v", id, ok)
	}
}
