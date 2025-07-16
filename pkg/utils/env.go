package utils

import (
	"github.com/joho/godotenv"
	"os"
	"strconv"
)

func init() {
	_ = godotenv.Load()
}

func Getenv(key string, defaultValue ...string) string {
	value := os.Getenv(key)
	if value == "" && len(defaultValue) > 0 {
		return defaultValue[0]
	}
	return value
}

func GetenvAsInt(key string, defaultValue ...int) int {
	value := os.Getenv(key)
	if value == "" && len(defaultValue) > 0 {
		return defaultValue[0]
	}
	intValue, err := strconv.Atoi(value)
	if err != nil && len(defaultValue) > 0 {
		return defaultValue[0]
	}
	return intValue
}

func GetenvAsBool(key string, defaultValue ...bool) bool {
	value := os.Getenv(key)
	if value == "" && len(defaultValue) > 0 {
		return defaultValue[0]
	}
	boolValue, err := strconv.ParseBool(value)
	if err != nil {
		if len(defaultValue) > 0 {
			return defaultValue[0]
		}
		return false
	}
	return boolValue
}
