package utils

import (
	"github.com/joho/godotenv"
	"github.com/snowykami/neo-blog/pkg/constant"
	"os"
	"strconv"
)

var (
	IsDevMode = false
)

func init() {
	_ = godotenv.Load()

	// Init env
	IsDevMode = Env.Get(constant.EnvKeyMode, constant.ModeDev) == constant.ModeDev
}

type envUtils struct{}

var Env envUtils

func (e *envUtils) Get(key string, defaultValue ...string) string {
	value := os.Getenv(key)
	if value == "" && len(defaultValue) > 0 {
		return defaultValue[0]
	}
	return value
}

func (e *envUtils) GetenvAsInt(key string, defaultValue ...int) int {
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

func (e *envUtils) GetenvAsBool(key string, defaultValue ...bool) bool {
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
