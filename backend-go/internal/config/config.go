package config

import (
	"os"
)

type Config struct {
	Port               string
	DatabaseURL        string
	RedisURL           string
	CORSOrigins        string
	TokenEncryptionKey string
	PublicBaseURL      string

	MetaClientID     string
	MetaClientSecret string
	LinkedInClientID string
	LinkedInSecret   string
	XClientID        string
	XClientSecret    string
	YouTubeClientID  string
	YouTubeSecret    string
}

func Load() Config {
	return Config{
		Port:               env("PORT", "8080"),
		DatabaseURL:        env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/nebulaa?sslmode=disable"),
		RedisURL:           env("REDIS_URL", "redis://localhost:6379/0"),
		CORSOrigins:        env("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"),
		TokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY", "change-me-32-byte-minimum-key"),
		PublicBaseURL:      env("PUBLIC_BASE_URL", "http://localhost:8080"),
		MetaClientID:       os.Getenv("META_CLIENT_ID"),
		MetaClientSecret:   os.Getenv("META_CLIENT_SECRET"),
		LinkedInClientID:   os.Getenv("LINKEDIN_CLIENT_ID"),
		LinkedInSecret:     os.Getenv("LINKEDIN_CLIENT_SECRET"),
		XClientID:          os.Getenv("X_CLIENT_ID"),
		XClientSecret:      os.Getenv("X_CLIENT_SECRET"),
		YouTubeClientID:    os.Getenv("YOUTUBE_CLIENT_ID"),
		YouTubeSecret:      os.Getenv("YOUTUBE_CLIENT_SECRET"),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
