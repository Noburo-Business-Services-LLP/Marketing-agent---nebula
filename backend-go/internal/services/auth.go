package services

import (
	"strings"

	"github.com/gofiber/fiber/v2"
)

type Authorizer interface {
	UserID(*fiber.Ctx) (string, error)
}

type BearerAuthorizer struct{}

func (BearerAuthorizer) UserID(c *fiber.Ctx) (string, error) {
	// In production, validate the existing Nebulaa JWT and extract the subject.
	auth := c.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") && len(auth) > 16 {
		return "user-" + auth[len(auth)-8:], nil
	}
	if userID := c.Get("X-User-ID"); userID != "" {
		return userID, nil
	}
	return "demo-user", nil
}
