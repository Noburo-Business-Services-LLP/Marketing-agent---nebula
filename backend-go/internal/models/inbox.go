package models

import "time"

type Platform string

const (
	PlatformInstagram Platform = "instagram"
	PlatformFacebook  Platform = "facebook"
	PlatformLinkedIn  Platform = "linkedin"
	PlatformX         Platform = "x"
	PlatformYouTube   Platform = "youtube"
)

type ConversationStatus string

const (
	StatusUnread  ConversationStatus = "unread"
	StatusRead    ConversationStatus = "read"
	StatusReplied ConversationStatus = "replied"
	StatusClosed  ConversationStatus = "closed"
)

type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityNormal Priority = "normal"
	PriorityHigh   Priority = "high"
	PriorityUrgent Priority = "urgent"
)

type Direction string

const (
	DirectionInbound  Direction = "inbound"
	DirectionOutbound Direction = "outbound"
)

type SocialAccount struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"user_id"`
	Platform              Platform  `json:"platform"`
	ProviderAccountID     string    `json:"provider_account_id"`
	DisplayName           string    `json:"display_name"`
	Username              string    `json:"username"`
	AccessTokenEncrypted  string    `json:"-"`
	RefreshTokenEncrypted string    `json:"-"`
	Scopes                []string  `json:"scopes"`
	TokenExpiresAt        time.Time `json:"token_expires_at"`
	ConnectedAt           time.Time `json:"connected_at"`
	IsActive              bool      `json:"is_active"`
}

type Conversation struct {
	ID                  string             `json:"id"`
	UserID              string             `json:"user_id"`
	SocialAccountID     string             `json:"social_account_id"`
	Platform            Platform           `json:"platform"`
	ProviderThreadID    string             `json:"provider_thread_id"`
	ParticipantID       string             `json:"participant_id"`
	ParticipantName     string             `json:"participant_name"`
	ParticipantUsername string             `json:"participant_username"`
	AvatarURL           string             `json:"avatar_url"`
	Subject             string             `json:"subject"`
	LastMessagePreview  string             `json:"last_message_preview"`
	LastMessageAt       time.Time          `json:"last_message_at"`
	Status              ConversationStatus `json:"status"`
	Priority            Priority           `json:"priority"`
	Tags                []string           `json:"tags"`
	Sentiment           string             `json:"sentiment"`
	SpamScore           float64            `json:"spam_score"`
	CreatedAt           time.Time          `json:"created_at"`
	UpdatedAt           time.Time          `json:"updated_at"`
}

type Message struct {
	ID                string    `json:"id"`
	ConversationID    string    `json:"conversation_id"`
	SocialAccountID   string    `json:"social_account_id"`
	Platform          Platform  `json:"platform"`
	ProviderMessageID string    `json:"provider_message_id"`
	ProviderParentID  string    `json:"provider_parent_id"`
	Direction         Direction `json:"direction"`
	MessageType       string    `json:"message_type"`
	AuthorID          string    `json:"author_id"`
	AuthorName        string    `json:"author_name"`
	Body              string    `json:"body"`
	MediaURLs         []string  `json:"media_urls"`
	Permalink         string    `json:"permalink"`
	Sentiment         string    `json:"sentiment"`
	SpamScore         float64   `json:"spam_score"`
	RawPayload        any       `json:"raw_payload,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

type Notification struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	ConversationID string    `json:"conversation_id"`
	MessageID      string    `json:"message_id"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	IsRead         bool      `json:"is_read"`
	CreatedAt      time.Time `json:"created_at"`
}

type InboxFilters struct {
	UserID   string
	Status   string
	Platform string
	Priority string
	Search   string
	Limit    int
	Offset   int
}

type NormalizedEvent struct {
	UserID              string
	SocialAccountID     string
	Platform            Platform
	ProviderThreadID    string
	ProviderMessageID   string
	ProviderParentID    string
	MessageType         string
	ParticipantID       string
	ParticipantName     string
	ParticipantUsername string
	AvatarURL           string
	AuthorID            string
	AuthorName          string
	Body                string
	MediaURLs           []string
	Permalink           string
	RawPayload          any
	OccurredAt          time.Time
}

type ReplyRequest struct {
	Body string `json:"body"`
}

type AIInsights struct {
	Suggestions []string `json:"suggestions"`
	Sentiment   string   `json:"sentiment"`
	SpamScore   float64  `json:"spam_score"`
	Priority    Priority `json:"priority"`
}
