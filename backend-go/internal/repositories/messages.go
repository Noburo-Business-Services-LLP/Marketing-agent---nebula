package repositories

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"

	"nebulaa/backend-go/internal/models"
)

type MessageRepository struct {
	db *pgxpool.Pool
}

func NewMessageRepository(db *pgxpool.Pool) *MessageRepository {
	return &MessageRepository{db: db}
}

func (r *MessageRepository) CreateFromEvent(ctx context.Context, conversationID string, event models.NormalizedEvent, insights models.AIInsights) (models.Message, error) {
	raw, _ := json.Marshal(event.RawPayload)
	var m models.Message
	err := r.db.QueryRow(ctx, `
		insert into messages (
			conversation_id, social_account_id, platform, provider_message_id, provider_parent_id,
			direction, message_type, author_id, author_name, body, media_urls, permalink,
			sentiment, spam_score, raw_payload, created_at
		) values ($1,$2,$3,$4,$5,'inbound',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		on conflict (social_account_id, provider_message_id) do update set raw_payload = excluded.raw_payload
		returning id, conversation_id, social_account_id, platform, provider_message_id, provider_parent_id,
		          direction, message_type, author_id, author_name, body, media_urls, permalink,
		          sentiment, spam_score, created_at
	`, conversationID, event.SocialAccountID, event.Platform, event.ProviderMessageID, event.ProviderParentID,
		event.MessageType, event.AuthorID, event.AuthorName, event.Body, event.MediaURLs, event.Permalink,
		insights.Sentiment, insights.SpamScore, raw, event.OccurredAt).Scan(
		&m.ID, &m.ConversationID, &m.SocialAccountID, &m.Platform, &m.ProviderMessageID, &m.ProviderParentID,
		&m.Direction, &m.MessageType, &m.AuthorID, &m.AuthorName, &m.Body, &m.MediaURLs, &m.Permalink,
		&m.Sentiment, &m.SpamScore, &m.CreatedAt,
	)
	return m, err
}

func (r *MessageRepository) CreateOutbound(ctx context.Context, conversation models.Conversation, providerMessageID, body string) (models.Message, error) {
	var m models.Message
	err := r.db.QueryRow(ctx, `
		insert into messages (
			conversation_id, social_account_id, platform, provider_message_id,
			direction, message_type, author_id, author_name, body, created_at
		) values ($1,$2,$3,$4,'outbound','reply','nebulaa','Nebulaa',$5,now())
		returning id, conversation_id, social_account_id, platform, provider_message_id, provider_parent_id,
		          direction, message_type, author_id, author_name, body, media_urls, permalink,
		          sentiment, spam_score, created_at
	`, conversation.ID, conversation.SocialAccountID, conversation.Platform, providerMessageID, body).Scan(
		&m.ID, &m.ConversationID, &m.SocialAccountID, &m.Platform, &m.ProviderMessageID, &m.ProviderParentID,
		&m.Direction, &m.MessageType, &m.AuthorID, &m.AuthorName, &m.Body, &m.MediaURLs, &m.Permalink,
		&m.Sentiment, &m.SpamScore, &m.CreatedAt,
	)
	return m, err
}

func (r *MessageRepository) ListByConversation(ctx context.Context, conversationID string) ([]models.Message, error) {
	rows, err := r.db.Query(ctx, `
		select id, conversation_id, social_account_id, platform, provider_message_id, provider_parent_id,
		       direction, message_type, author_id, author_name, body, media_urls, permalink,
		       sentiment, spam_score, created_at
		from messages where conversation_id = $1 order by created_at asc
	`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []models.Message
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SocialAccountID, &m.Platform, &m.ProviderMessageID, &m.ProviderParentID,
			&m.Direction, &m.MessageType, &m.AuthorID, &m.AuthorName, &m.Body, &m.MediaURLs, &m.Permalink,
			&m.Sentiment, &m.SpamScore, &m.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, m)
	}
	return messages, rows.Err()
}
