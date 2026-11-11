package utils

// Deref 取指针的值，nil 时返回零值
func Deref[T any](src *T) T {
	var zero T
	if src == nil {
		return zero
	}
	return *src
}
