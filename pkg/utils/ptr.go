package utils

// 字符串更新函数
func UpdateNonEmpty(dst *string, src string) {
	if src != "" {
		*dst = src
	}
}

// 数值更新函数
func UpdatePtrUint(dst **uint, src *uint) {
	if src != nil && *src != 0 {
		*dst = src
	}
}

func UpdatePtrInt(dst **int, src *int) {
	if src != nil && *src != 0 {
		*dst = src
	}
}

// 布尔值更新（通常总是更新）
func UpdateBool(dst *bool, src bool) {
	*dst = src
}

func UpdatePtrBool(dst **bool, src *bool) {
	if src != nil {
		*dst = src
	}
}

// 泛型版本
func UpdateNonZero[T comparable](dst *T, src T) {
	var zero T
	if src != zero {
		*dst = src
	}
}

// Deref 取指针的值，nil 时返回零值
func Deref[T any](src *T) T {
	var zero T
	if src == nil {
		return zero
	}
	return *src
}

func UpdatePtr[T any](dst **T, src *T) {
	if src != nil {
		*dst = src
	}
}

func UpdatePtrNonZero[T comparable](dst **T, src *T) {
	if src != nil {
		var zero T
		if *src != zero {
			*dst = src
		}
	}
}

// 切片更新
func UpdateSlice[T any](dst *[]T, src []T) {
	if len(src) > 0 {
		*dst = src
	}
}
