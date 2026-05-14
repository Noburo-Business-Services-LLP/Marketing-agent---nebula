package controllers

import (
	"context"

	"github.com/gofiber/fiber/v2"

	"nebulaa/backend-go/internal/models"
	"nebulaa/backend-go/internal/repositories"
	"nebulaa/backend-go/internal/services"
)

type OAuthController struct {
	OAuth      *services.OAuthService
	Repos      repositories.Repositories
	Authorizer services.Authorizer
}

func (ctl OAuthController) Accounts(c *fiber.Ctx) error {
	userID, _ := ctl.Authorizer.UserID(c)
	accounts, err := ctl.Repos.SocialAccounts.ListByUser(context.Background(), userID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "accounts": accounts})
}

func (ctl OAuthController) Begin(c *fiber.Ctx) error {
	userID, _ := ctl.Authorizer.UserID(c)
	platform := models.Platform(c.Params("platform"))
	return c.JSON(fiber.Map{"success": true, "auth_url": ctl.OAuth.AuthURL(userID, platform)})
}

func (ctl OAuthController) Callback(c *fiber.Ctx) error {
	platform := models.Platform(c.Params("platform"))
	userID := c.Query("state", "demo-user")
	code := c.Query("code")
	if code == "" {
		return fiber.ErrBadRequest
	}
	account, err := ctl.OAuth.ConnectCallback(context.Background(), userID, platform, code)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "account": account})
}
