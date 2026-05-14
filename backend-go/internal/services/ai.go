package services

import (
	"strings"

	"nebulaa/backend-go/internal/models"
)

type AIService struct{}

func NewAIService() AIService {
	return AIService{}
}

func (AIService) Analyze(text string) models.AIInsights {
	lower := strings.ToLower(text)
	insights := models.AIInsights{
		Sentiment: "neutral",
		SpamScore: 0.05,
		Priority:  models.PriorityNormal,
		Suggestions: []string{
			"Thanks for reaching out. We appreciate your message and will help you with this.",
			"Absolutely, happy to help. Could you share one more detail so we can guide you better?",
		},
	}
	if strings.Contains(lower, "angry") || strings.Contains(lower, "refund") || strings.Contains(lower, "bad") {
		insights.Sentiment = "negative"
		insights.Priority = models.PriorityHigh
	}
	if strings.Contains(lower, "urgent") || strings.Contains(lower, "asap") {
		insights.Priority = models.PriorityUrgent
	}
	if strings.Contains(lower, "free money") || strings.Contains(lower, "crypto") {
		insights.SpamScore = 0.92
		insights.Priority = models.PriorityLow
	}
	return insights
}
