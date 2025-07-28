package utils

import (
	"fmt"
	"github.com/joho/godotenv"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
	"os"
	"strconv"
)

var (
	IsDevMode = false
)

func init() {
	err := godotenv.Load()
	if err != nil {
		logrus.Warnf("Error loading .env file: %v", err)
	}

	logrus.Infof("env loaded")
	// Init env
	IsDevMode = Env.Get(constant.EnvKeyMode, constant.ModeProd) == constant.ModeDev
	// Set log level
	logrus.SetLevel(getLogLevel(Env.Get(constant.EnvKeyLogLevel, "info")))
	if logrus.GetLevel() == logrus.DebugLevel {
		logrus.Debug("Debug mode is enabled, printing environment variables:")
		for _, e := range os.Environ() {
			if len(e) > 0 && e[0] == '_' {
				// Skip environment variables that start with '_'
				continue
			}
			fmt.Printf("%s ", e)
		}
	}
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

func (e *envUtils) GetAsInt(key string, defaultValue ...int) int {
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

func (e *envUtils) GetAsBool(key string, defaultValue ...bool) bool {
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

func getLogLevel(levelString string) logrus.Level {
	switch levelString {
	case "debug":
		return logrus.DebugLevel
	case "info":
		return logrus.InfoLevel
	case "warn":
		return logrus.WarnLevel
	case "error":
		return logrus.ErrorLevel
	case "fatal":
		return logrus.FatalLevel
	case "panic":
		return logrus.PanicLevel
	default:
		logrus.Warnf("Unknown log level: %s, defaulting to InfoLevel", levelString)
		return logrus.InfoLevel
	}
}
