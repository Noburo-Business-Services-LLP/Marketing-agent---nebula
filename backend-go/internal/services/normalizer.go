package services

import (
	"fmt"
	"time"

	"nebulaa/backend-go/internal/models"
)

func NormalizeWebhook(platform models.Platform, account models.SocialAccount, payload map[string]any) []models.NormalizedEvent {
	now := time.Now().UTC()
	id := stringValue(payload, "id", fmt.Sprintf("%s-%d", platform, now.UnixNano()))
	threadID := stringValue(payload, "thread_id", id)
	authorName := stringValue(payload, "author_name", "Social user")
	body := stringValue(payload, "text", stringValue(payload, "message", ""))

	return []models.NormalizedEvent{{
		UserID:              account.UserID,
		SocialAccountID:     account.ID,
		Platform:            platform,
		ProviderThreadID:    threadID,
		ProviderMessageID:   id,
		ProviderParentID:    stringValue(payload, "parent_id", ""),
		MessageType:         stringValue(payload, "type", "message"),
		ParticipantID:       stringValue(payload, "author_id", "unknown"),
		ParticipantName:     authorName,
		ParticipantUsername: stringValue(payload, "author_username", ""),
		AvatarURL:           stringValue(payload, "avatar_url", ""),
		AuthorID:            stringValue(payload, "author_id", "unknown"),
		AuthorName:          authorName,
		Body:                body,
		MediaURLs:           stringSlice(payload, "media_urls"),
		Permalink:           stringValue(payload, "permalink", ""),
		RawPayload:          payload,
		OccurredAt:          now,
	}}
}

func stringValue(m map[string]any, key, fallback string) string {
	if value, ok := m[key].(string); ok && value != "" {
		return value
	}
	return fallback
}

func stringSlice(m map[string]any, key string) []string {
	raw, ok := m[key].([]any)
	if !ok {
		return []string{}
	}
	values := make([]string, 0, len(raw))
	for _, item := range raw {
		if value, ok := item.(string); ok {
			values = append(values, value)
		}
	}
	return values
}
