package utils

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
	"github.com/sirupsen/logrus"
	"github.com/snowykami/neo-blog/pkg/constant"
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
	if !IsDevMode && !isTestBinary() {
		validateProductionSecrets()
	}
	if logrus.GetLevel() == logrus.DebugLevel {
		logrus.Debug("Debug mode is enabled; environment values are hidden to avoid leaking secrets")
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

func validateProductionSecrets() {
	if isWeakSecret(Env.Get(constant.EnvKeyJwtSecrete), 32, "1234567890") {
		logrus.Fatalf("%s must be set to a non-default value with at least 32 characters in production", constant.EnvKeyJwtSecrete)
	}
	if isWeakSecret(Env.Get(constant.EnvKeyPasswordSalt), 16, "1234567890", constant.DefaultPasswordSalt) {
		logrus.Fatalf("%s must be set to a non-default value with at least 16 characters in production", constant.EnvKeyPasswordSalt)
	}
}

func isWeakSecret(value string, minLength int, knownWeakValues ...string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) < minLength {
		return true
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "change-me") || strings.Contains(lower, "change_me") {
		return true
	}
	for _, weak := range knownWeakValues {
		if trimmed == weak {
			return true
		}
	}
	return false
}

func isTestBinary() bool {
	return strings.HasSuffix(os.Args[0], ".test")
}
