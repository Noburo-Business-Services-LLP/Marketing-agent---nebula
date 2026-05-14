package services

import (
	"context"
	"errors"

	"nebulaa/backend-go/internal/models"
	"nebulaa/backend-go/internal/realtime"
	"nebulaa/backend-go/internal/repositories"
)

type InboxService struct {
	repos         repositories.Repositories
	hub           *realtime.Hub
	socialClients SocialClients
	ai            AIService
}

func NewInboxService(repos repositories.Repositories, hub *realtime.Hub, socialClients SocialClients, ai AIService) *InboxService {
	return &InboxService{repos: repos, hub: hub, socialClients: socialClients, ai: ai}
}

func (s *InboxService) Ingest(ctx context.Context, event models.NormalizedEvent) (models.Conversation, models.Message, models.AIInsights, error) {
	insights := s.ai.Analyze(event.Body)
	conversation, err := s.repos.Conversations.UpsertFromEvent(ctx, event, insights)
	if err != nil {
		return conversation, models.Message{}, insights, err
	}
	message, err := s.repos.Messages.CreateFromEvent(ctx, conversation.ID, event, insights)
	if err != nil {
		return conversation, message, insights, err
	}
	_ = s.repos.Notifications.Create(ctx, models.Notification{
		UserID: conversation.UserID, ConversationID: conversation.ID, MessageID: message.ID,
		Title: string(conversation.Platform) + " message", Body: message.Body,
	})
	s.hub.Broadcast(realtime.Event{
		UserID: conversation.UserID,
		Type:   "inbox.message.created",
		Data: map[string]any{
			"conversation": conversation,
			"message":      message,
			"ai":           insights,
		},
	})
	return conversation, message, insights, nil
}

func (s *InboxService) Reply(ctx context.Context, userID, conversationID, body string) (models.Message, error) {
	conversation, err := s.repos.Conversations.Get(ctx, userID, conversationID)
	if err != nil {
		return models.Message{}, err
	}
	account, err := s.repos.SocialAccounts.Get(ctx, conversation.SocialAccountID)
	if err != nil {
		return models.Message{}, err
	}
	client := s.socialClients[conversation.Platform]
	if client == nil {
		return models.Message{}, errors.New("unsupported platform")
	}
	providerID, err := client.SendReply(ctx, account, conversation, body)
	if err != nil {
		return models.Message{}, err
	}
	message, err := s.repos.Messages.CreateOutbound(ctx, conversation, providerID, body)
	if err != nil {
		return models.Message{}, err
	}
	_ = s.repos.Conversations.UpdateStatus(ctx, userID, conversationID, string(models.StatusReplied))
	s.hub.Broadcast(realtime.Event{UserID: userID, Type: "inbox.message.replied", Data: message})
	return message, nil
}

func (s *InboxService) SyncAccount(ctx context.Context, accountID string) error {
	account, err := s.repos.SocialAccounts.Get(ctx, accountID)
	if err != nil {
		return err
	}
	client := s.socialClients[account.Platform]
	if client == nil {
		return errors.New("unsupported platform")
	}
	events, err := client.Poll(ctx, account)
	if err != nil {
		return err
	}
	for _, event := range events {
		if _, _, _, err := s.Ingest(ctx, event); err != nil {
			return err
		}
	}
	return nil
}
