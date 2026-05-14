package controllers

import (
	"context"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"nebulaa/backend-go/internal/models"
	"nebulaa/backend-go/internal/repositories"
	"nebulaa/backend-go/internal/services"
)

type InboxController struct {
	Repos      repositories.Repositories
	Inbox      *services.InboxService
	AI         services.AIService
	Authorizer services.Authorizer
}

func (ctl InboxController) List(c *fiber.Ctx) error {
	userID, err := ctl.Authorizer.UserID(c)
	if err != nil {
		return fiber.ErrUnauthorized
	}
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	offset, _ := strconv.Atoi(c.Query("offset", "0"))
	ctx := context.Background()
	items, err := ctl.Repos.Conversations.List(ctx, models.InboxFilters{
		UserID: userID, Status: c.Query("status"), Platform: c.Query("platform"),
		Priority: c.Query("priority"), Search: c.Query("search"), Limit: limit, Offset: offset,
	})
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "conversations": items})
}

func (ctl InboxController) Messages(c *fiber.Ctx) error {
	userID, err := ctl.Authorizer.UserID(c)
	if err != nil {
		return fiber.ErrUnauthorized
	}
	ctx := context.Background()
	conversation, err := ctl.Repos.Conversations.Get(ctx, userID, c.Params("id"))
	if err != nil {
		return fiber.ErrNotFound
	}
	messages, err := ctl.Repos.Messages.ListByConversation(ctx, conversation.ID)
	if err != nil {
		return err
	}
	insights := ctl.AI.Analyze(conversation.LastMessagePreview)
	return c.JSON(fiber.Map{"success": true, "conversation": conversation, "messages": messages, "ai": insights})
}

func (ctl InboxController) Reply(c *fiber.Ctx) error {
	userID, err := ctl.Authorizer.UserID(c)
	if err != nil {
		return fiber.ErrUnauthorized
	}
	var req models.ReplyRequest
	if err := c.BodyParser(&req); err != nil || req.Body == "" {
		return fiber.ErrBadRequest
	}
	message, err := ctl.Inbox.Reply(context.Background(), userID, c.Params("id"), req.Body)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "message": message})
}

func (ctl InboxController) UpdateStatus(c *fiber.Ctx) error {
	userID, err := ctl.Authorizer.UserID(c)
	if err != nil {
		return fiber.ErrUnauthorized
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := c.BodyParser(&req); err != nil || req.Status == "" {
		return fiber.ErrBadRequest
	}
	if err := ctl.Repos.Conversations.UpdateStatus(context.Background(), userID, c.Params("id"), req.Status); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (ctl InboxController) UpdateMeta(c *fiber.Ctx) error {
	userID, err := ctl.Authorizer.UserID(c)
	if err != nil {
		return fiber.ErrUnauthorized
	}
	var req struct {
		Tags     []string `json:"tags"`
		Priority string   `json:"priority"`
	}
	if err := c.BodyParser(&req); err != nil {
		return fiber.ErrBadRequest
	}
	if req.Priority == "" {
		req.Priority = string(models.PriorityNormal)
	}
	if err := ctl.Repos.Conversations.UpdateTagsPriority(context.Background(), userID, c.Params("id"), req.Tags, req.Priority); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}
