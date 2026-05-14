package controllers

import (
	"context"

	"github.com/gofiber/fiber/v2"

	"nebulaa/backend-go/internal/models"
	"nebulaa/backend-go/internal/repositories"
	"nebulaa/backend-go/internal/services"
)

type WebhookController struct {
	Repos repositories.Repositories
	Inbox *services.InboxService
}

func (ctl WebhookController) Verify(c *fiber.Ctx) error {
	if challenge := c.Query("hub.challenge"); challenge != "" {
		return c.SendString(challenge)
	}
	return c.SendStatus(fiber.StatusOK)
}

func (ctl WebhookController) Receive(c *fiber.Ctx) error {
	platform := models.Platform(c.Params("platform"))
	accountID := c.Query("account_id")
	if accountID == "" {
		accountID = c.Get("X-Social-Account-ID")
	}
	ctx := context.Background()
	account, err := ctl.Repos.SocialAccounts.Get(ctx, accountID)
	if err != nil {
		return fiber.ErrNotFound
	}
	var payload map[string]any
	if err := c.BodyParser(&payload); err != nil {
		return fiber.ErrBadRequest
	}
	events := services.NormalizeWebhook(platform, account, payload)
	for _, event := range events {
		if _, _, _, err := ctl.Inbox.Ingest(ctx, event); err != nil {
			return err
		}
	}
	return c.JSON(fiber.Map{"success": true, "received": len(events)})
}
