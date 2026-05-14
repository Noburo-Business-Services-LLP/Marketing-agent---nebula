package repositories

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"nebulaa/backend-go/internal/models"
)

type NotificationRepository struct {
	db *pgxpool.Pool
}

func NewNotificationRepository(db *pgxpool.Pool) *NotificationRepository {
	return &NotificationRepository{db: db}
}

func (r *NotificationRepository) Create(ctx context.Context, n models.Notification) error {
	_, err := r.db.Exec(ctx, `
		insert into notifications (user_id, conversation_id, message_id, title, body)
		values ($1,$2,$3,$4,$5)
	`, n.UserID, n.ConversationID, n.MessageID, n.Title, n.Body)
	return err
}
