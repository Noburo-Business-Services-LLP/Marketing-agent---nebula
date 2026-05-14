package repositories

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"nebulaa/backend-go/internal/models"
)

type ConversationRepository struct {
	db *pgxpool.Pool
}

func NewConversationRepository(db *pgxpool.Pool) *ConversationRepository {
	return &ConversationRepository{db: db}
}

func (r *ConversationRepository) UpsertFromEvent(ctx context.Context, event models.NormalizedEvent, insights models.AIInsights) (models.Conversation, error) {
	var c models.Conversation
	err := r.db.QueryRow(ctx, `
		insert into conversations (
			user_id, social_account_id, platform, provider_thread_id, participant_id,
			participant_name, participant_username, avatar_url, last_message_preview,
			last_message_at, status, priority, sentiment, spam_score
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unread',$11,$12,$13)
		on conflict (social_account_id, provider_thread_id) do update set
			participant_name = excluded.participant_name,
			participant_username = excluded.participant_username,
			avatar_url = excluded.avatar_url,
			last_message_preview = excluded.last_message_preview,
			last_message_at = excluded.last_message_at,
			status = case when conversations.status = 'closed' then 'closed' else 'unread' end,
			priority = excluded.priority,
			sentiment = excluded.sentiment,
			spam_score = excluded.spam_score,
			updated_at = now()
		returning id, user_id, social_account_id, platform, provider_thread_id, participant_id,
		          participant_name, participant_username, avatar_url, subject, last_message_preview,
		          last_message_at, status, priority, tags, sentiment, spam_score, created_at, updated_at
	`, event.UserID, event.SocialAccountID, event.Platform, event.ProviderThreadID, event.ParticipantID,
		event.ParticipantName, event.ParticipantUsername, event.AvatarURL, event.Body, event.OccurredAt,
		insights.Priority, insights.Sentiment, insights.SpamScore).Scan(
		&c.ID, &c.UserID, &c.SocialAccountID, &c.Platform, &c.ProviderThreadID, &c.ParticipantID,
		&c.ParticipantName, &c.ParticipantUsername, &c.AvatarURL, &c.Subject, &c.LastMessagePreview,
		&c.LastMessageAt, &c.Status, &c.Priority, &c.Tags, &c.Sentiment, &c.SpamScore, &c.CreatedAt, &c.UpdatedAt,
	)
	return c, err
}

func (r *ConversationRepository) List(ctx context.Context, filters models.InboxFilters) ([]models.Conversation, error) {
	if filters.Limit <= 0 || filters.Limit > 100 {
		filters.Limit = 50
	}
	rows, err := r.db.Query(ctx, `
		select id, user_id, social_account_id, platform, provider_thread_id, participant_id,
		       participant_name, participant_username, avatar_url, subject, last_message_preview,
		       last_message_at, status, priority, tags, sentiment, spam_score, created_at, updated_at
		from conversations
		where user_id = $1
		  and ($2 = '' or status = $2)
		  and ($3 = '' or platform = $3)
		  and ($4 = '' or priority = $4)
		  and ($5 = '' or participant_name ilike '%' || $5 || '%' or last_message_preview ilike '%' || $5 || '%')
		order by last_message_at desc
		limit $6 offset $7
	`, filters.UserID, filters.Status, filters.Platform, filters.Priority, filters.Search, filters.Limit, filters.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conversations []models.Conversation
	for rows.Next() {
		var c models.Conversation
		if err := rows.Scan(&c.ID, &c.UserID, &c.SocialAccountID, &c.Platform, &c.ProviderThreadID, &c.ParticipantID,
			&c.ParticipantName, &c.ParticipantUsername, &c.AvatarURL, &c.Subject, &c.LastMessagePreview,
			&c.LastMessageAt, &c.Status, &c.Priority, &c.Tags, &c.Sentiment, &c.SpamScore, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		conversations = append(conversations, c)
	}
	return conversations, rows.Err()
}

func (r *ConversationRepository) Get(ctx context.Context, userID, id string) (models.Conversation, error) {
	var c models.Conversation
	err := r.db.QueryRow(ctx, `
		select id, user_id, social_account_id, platform, provider_thread_id, participant_id,
		       participant_name, participant_username, avatar_url, subject, last_message_preview,
		       last_message_at, status, priority, tags, sentiment, spam_score, created_at, updated_at
		from conversations where user_id = $1 and id = $2
	`, userID, id).Scan(&c.ID, &c.UserID, &c.SocialAccountID, &c.Platform, &c.ProviderThreadID, &c.ParticipantID,
		&c.ParticipantName, &c.ParticipantUsername, &c.AvatarURL, &c.Subject, &c.LastMessagePreview,
		&c.LastMessageAt, &c.Status, &c.Priority, &c.Tags, &c.Sentiment, &c.SpamScore, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (r *ConversationRepository) UpdateStatus(ctx context.Context, userID, id, status string) error {
	_, err := r.db.Exec(ctx, `update conversations set status = $3, updated_at = now() where user_id = $1 and id = $2`, userID, id, status)
	return err
}

func (r *ConversationRepository) UpdateTagsPriority(ctx context.Context, userID, id string, tags []string, priority string) error {
	_, err := r.db.Exec(ctx, `update conversations set tags = $3, priority = $4, updated_at = now() where user_id = $1 and id = $2`, userID, id, tags, priority)
	return err
}
