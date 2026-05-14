package repositories

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"nebulaa/backend-go/internal/models"
)

type SocialAccountRepository struct {
	db *pgxpool.Pool
}

func NewSocialAccountRepository(db *pgxpool.Pool) *SocialAccountRepository {
	return &SocialAccountRepository{db: db}
}

func (r *SocialAccountRepository) Upsert(ctx context.Context, account models.SocialAccount) error {
	_, err := r.db.Exec(ctx, `
		insert into social_accounts (
			id, user_id, platform, provider_account_id, display_name, username,
			access_token_encrypted, refresh_token_encrypted, scopes, token_expires_at, is_active
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
		on conflict (user_id, platform, provider_account_id) do update set
			display_name = excluded.display_name,
			username = excluded.username,
			access_token_encrypted = excluded.access_token_encrypted,
			refresh_token_encrypted = excluded.refresh_token_encrypted,
			scopes = excluded.scopes,
			token_expires_at = excluded.token_expires_at,
			is_active = true,
			updated_at = now()
	`, account.ID, account.UserID, account.Platform, account.ProviderAccountID, account.DisplayName,
		account.Username, account.AccessTokenEncrypted, account.RefreshTokenEncrypted, account.Scopes, account.TokenExpiresAt)
	return err
}

func (r *SocialAccountRepository) Get(ctx context.Context, id string) (models.SocialAccount, error) {
	var account models.SocialAccount
	err := r.db.QueryRow(ctx, `
		select id, user_id, platform, provider_account_id, display_name, username,
		       access_token_encrypted, refresh_token_encrypted, scopes, token_expires_at, connected_at, is_active
		from social_accounts where id = $1 and is_active = true
	`, id).Scan(&account.ID, &account.UserID, &account.Platform, &account.ProviderAccountID,
		&account.DisplayName, &account.Username, &account.AccessTokenEncrypted,
		&account.RefreshTokenEncrypted, &account.Scopes, &account.TokenExpiresAt,
		&account.ConnectedAt, &account.IsActive)
	return account, err
}

func (r *SocialAccountRepository) ListByUser(ctx context.Context, userID string) ([]models.SocialAccount, error) {
	rows, err := r.db.Query(ctx, `
		select id, user_id, platform, provider_account_id, display_name, username,
		       access_token_encrypted, refresh_token_encrypted, scopes, token_expires_at, connected_at, is_active
		from social_accounts where user_id = $1 and is_active = true order by connected_at desc
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []models.SocialAccount
	for rows.Next() {
		var account models.SocialAccount
		if err := rows.Scan(&account.ID, &account.UserID, &account.Platform, &account.ProviderAccountID,
			&account.DisplayName, &account.Username, &account.AccessTokenEncrypted,
			&account.RefreshTokenEncrypted, &account.Scopes, &account.TokenExpiresAt,
			&account.ConnectedAt, &account.IsActive); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}
