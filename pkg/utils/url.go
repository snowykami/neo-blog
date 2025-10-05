package utils

import "net/url"

type urlUtils struct{}

var Url = &urlUtils{}

func (u *urlUtils) BuildUrl(baseUrl string, queryParams map[string]string) string {
	newUrl, err := url.Parse(baseUrl)
	if err != nil {
		return baseUrl
	}
	q := newUrl.Query()
	for key, value := range queryParams {
		q.Set(key, value)
	}
	newUrl.RawQuery = q.Encode()
	return newUrl.String()
}

func (u *urlUtils) IsValidUrl(toTest string) bool {
	_, err := url.ParseRequestURI(toTest)
	return err == nil
}
