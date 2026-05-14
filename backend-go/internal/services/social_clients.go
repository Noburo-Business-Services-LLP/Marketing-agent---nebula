package services

import (
	"context"
	"fmt"
	"time"

	"nebulaa/backend-go/internal/config"
	"nebulaa/backend-go/internal/models"
)

type SocialClient interface {
	Platform() models.Platform
	SendReply(ctx context.Context, account models.SocialAccount, conversation models.Conversation, body string) (string, error)
	Poll(ctx context.Context, account models.SocialAccount) ([]models.NormalizedEvent, error)
}

type SocialClients map[models.Platform]SocialClient

func NewSocialClients(cfg config.Config) SocialClients {
	return SocialClients{
		models.PlatformInstagram: GraphClient{platform: models.PlatformInstagram},
		models.PlatformFacebook:  GraphClient{platform: models.PlatformFacebook},
		models.PlatformLinkedIn:  LinkedInClient{},
		models.PlatformX:         XClient{},
		models.PlatformYouTube:   YouTubeClient{},
	}
}

type GraphClient struct {
	platform models.Platform
}

func (c GraphClient) Platform() models.Platform { return c.platform }

func (c GraphClient) SendReply(ctx context.Context, account models.SocialAccount, conversation models.Conversation, body string) (string, error) {
	// Meta Graph API:
	// Instagram comments: POST /{ig-comment-id}/replies
	// Instagram messages / Messenger: POST /me/messages
	// Facebook comments: POST /{comment-id}/comments
	return fmt.Sprintf("%s-reply-%d", c.platform, time.Now().UnixNano()), nil
}

func (c GraphClient) Poll(ctx context.Context, account models.SocialAccount) ([]models.NormalizedEvent, error) {
	return nil, nil
}

type LinkedInClient struct{}

func (LinkedInClient) Platform() models.Platform { return models.PlatformLinkedIn }
func (LinkedInClient) SendReply(ctx context.Context, account models.SocialAccount, conversation models.Conversation, body string) (string, error) {
	// LinkedIn API: create comment/reply on organizationalEntityShare or social action.
	return fmt.Sprintf("linkedin-reply-%d", time.Now().UnixNano()), nil
}
func (LinkedInClient) Poll(ctx context.Context, account models.SocialAccount) ([]models.NormalizedEvent, error) {
	return nil, nil
}

type XClient struct{}

func (XClient) Platform() models.Platform { return models.PlatformX }
func (XClient) SendReply(ctx context.Context, account models.SocialAccount, conversation models.Conversation, body string) (string, error) {
	// X API v2: POST /2/tweets with reply.in_reply_to_tweet_id.
	return fmt.Sprintf("x-reply-%d", time.Now().UnixNano()), nil
}
func (XClient) Poll(ctx context.Context, account models.SocialAccount) ([]models.NormalizedEvent, error) {
	return nil, nil
}

type YouTubeClient struct{}

func (YouTubeClient) Platform() models.Platform { return models.PlatformYouTube }
func (YouTubeClient) SendReply(ctx context.Context, account models.SocialAccount, conversation models.Conversation, body string) (string, error) {
	// YouTube Data API: commentThreads.insert or comments.insert for replies.
	return fmt.Sprintf("youtube-reply-%d", time.Now().UnixNano()), nil
}
func (YouTubeClient) Poll(ctx context.Context, account models.SocialAccount) ([]models.NormalizedEvent, error) {
	return nil, nil
}
