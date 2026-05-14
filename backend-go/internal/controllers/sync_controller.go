package controllers

import (
	"context"

	"github.com/gofiber/fiber/v2"

	"nebulaa/backend-go/internal/queue"
)

type SyncController struct {
	Queue *queue.SyncQueue
}

func (ctl SyncController) Enqueue(c *fiber.Ctx) error {
	if err := ctl.Queue.Enqueue(context.Background(), c.Params("accountID")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "queued": true})
}
