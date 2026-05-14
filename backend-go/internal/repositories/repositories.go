package repositories

import "github.com/jackc/pgx/v5/pgxpool"

type Repositories struct {
	SocialAccounts *SocialAccountRepository
	Conversations  *ConversationRepository
	Messages       *MessageRepository
	Notifications  *NotificationRepository
}

func New(db *pgxpool.Pool) Repositories {
	return Repositories{
		SocialAccounts: NewSocialAccountRepository(db),
		Conversations:  NewConversationRepository(db),
		Messages:       NewMessageRepository(db),
		Notifications:  NewNotificationRepository(db),
	}
}
