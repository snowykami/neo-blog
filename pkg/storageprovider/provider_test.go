package storageprovider

import (
	"context"
	"io"
	"strings"
	"testing"
)

type plainProvider struct {
	StorageProvider
	saved string
}

func (p *plainProvider) Save(_ context.Context, path string, _ io.Reader) error {
	p.saved = path
	return nil
}

type typedProvider struct {
	plainProvider
	contentType string
}

func (p *typedProvider) SaveWithContentType(_ context.Context, path string, _ io.Reader, contentType string) error {
	p.saved, p.contentType = path, contentType
	return nil
}

// 支持指定类型的存储按给出的类型保存，其他存储（或没有给出类型时）照常 Save
func TestSaveWithContentType(t *testing.T) {
	typed := &typedProvider{}
	if err := SaveWithContentType(context.Background(), typed, "ab/abc", strings.NewReader("x"), "image/png"); err != nil || typed.contentType != "image/png" || typed.saved != "ab/abc" {
		t.Fatalf("typed: %v %+v", err, typed)
	}
	typed = &typedProvider{}
	if err := SaveWithContentType(context.Background(), typed, "page/index.html", strings.NewReader("x"), ""); err != nil || typed.contentType != "" || typed.plainProvider.saved != "page/index.html" {
		t.Fatalf("typed without content type: %v %+v", err, typed)
	}
	plain := &plainProvider{}
	if err := SaveWithContentType(context.Background(), plain, "ab/abc", strings.NewReader("x"), "image/png"); err != nil || plain.saved != "ab/abc" {
		t.Fatalf("plain: %v %+v", err, plain)
	}
}
