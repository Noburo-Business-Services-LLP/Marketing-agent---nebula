package services

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/google/uuid"

	"nebulaa/backend-go/internal/config"
	"nebulaa/backend-go/internal/models"
	"nebulaa/backend-go/internal/repositories"
)

type OAuthService struct {
	accounts *repositories.SocialAccountRepository
	cipher   TokenCipher
	cfg      config.Config
}

func NewOAuthService(accounts *repositories.SocialAccountRepository, cipher TokenCipher, cfg config.Config) *OAuthService {
	return &OAuthService{accounts: accounts, cipher: cipher, cfg: cfg}
}

func (s *OAuthService) AuthURL(userID string, platform models.Platform) string {
	redirect := url.QueryEscape(fmt.Sprintf("%s/api/inbox/oauth/%s/callback", s.cfg.PublicBaseURL, platform))
	state := url.QueryEscape(userID)
	switch platform {
	case models.PlatformInstagram, models.PlatformFacebook:
		return "https://www.facebook.com/v19.0/dialog/oauth?client_id=" + s.cfg.MetaClientID + "&redirect_uri=" + redirect + "&state=" + state + "&scope=pages_messaging,pages_read_engagement,instagram_manage_comments,instagram_basic"
	case models.PlatformLinkedIn:
		return "https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=" + s.cfg.LinkedInClientID + "&redirect_uri=" + redirect + "&state=" + state + "&scope=r_liteprofile%20w_member_social"
	case models.PlatformX:
		return "https://twitter.com/i/oauth2/authorize?response_type=code&client_id=" + s.cfg.XClientID + "&redirect_uri=" + redirect + "&state=" + state + "&scope=tweet.read%20tweet.write%20users.read%20offline.access"
	case models.PlatformYouTube:
		return "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=" + s.cfg.YouTubeClientID + "&redirect_uri=" + redirect + "&state=" + state + "&scope=https://www.googleapis.com/auth/youtube.force-ssl"
	default:
		return ""
	}
}

func (s *OAuthService) ConnectCallback(ctx context.Context, userID string, platform models.Platform, code string) (models.SocialAccount, error) {
	// Exchange `code` for access/refresh tokens with the provider token endpoint.
	// This scaffold stores encrypted placeholder tokens so the module can be run locally.
	access, err := s.cipher.Encrypt("oauth-access-token-from-" + string(platform) + "-" + code)
	if err != nil {
		return models.SocialAccount{}, err
	}
	refresh, err := s.cipher.Encrypt("oauth-refresh-token-from-" + string(platform) + "-" + code)
	if err != nil {
		return models.SocialAccount{}, err
	}
	account := models.SocialAccount{
		ID:                    uuid.NewString(),
		UserID:                userID,
		Platform:              platform,
		ProviderAccountID:     string(platform) + "-account",
		DisplayName:           "Connected " + string(platform),
		Username:              "nebulaa_" + string(platform),
		AccessTokenEncrypted:  access,
		RefreshTokenEncrypted: refresh,
		Scopes:                []string{"read", "write", "webhook"},
		TokenExpiresAt:        time.Now().Add(55 * time.Minute),
		IsActive:              true,
	}
	return account, s.accounts.Upsert(ctx, account)
}
