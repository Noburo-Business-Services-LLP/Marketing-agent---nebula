package routes

import (
	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"

	"nebulaa/backend-go/internal/config"
	"nebulaa/backend-go/internal/controllers"
	"nebulaa/backend-go/internal/queue"
	"nebulaa/backend-go/internal/realtime"
	"nebulaa/backend-go/internal/repositories"
	"nebulaa/backend-go/internal/services"
)

type Dependencies struct {
	Config     config.Config
	Repos      repositories.Repositories
	Inbox      *services.InboxService
	OAuth      *services.OAuthService
	Queue      *queue.SyncQueue
	Hub        *realtime.Hub
	AI         services.AIService
	Authorizer services.Authorizer
}

func Register(app *fiber.App, deps Dependencies) {
	app.Get("/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"ok": true}) })

	api := app.Group("/api/inbox")
	inbox := controllers.InboxController{Repos: deps.Repos, Inbox: deps.Inbox, AI: deps.AI, Authorizer: deps.Authorizer}
	oauth := controllers.OAuthController{OAuth: deps.OAuth, Repos: deps.Repos, Authorizer: deps.Authorizer}
	webhooks := controllers.WebhookController{Repos: deps.Repos, Inbox: deps.Inbox}
	sync := controllers.SyncController{Queue: deps.Queue}

	api.Get("/accounts", oauth.Accounts)
	api.Get("/oauth/:platform", oauth.Begin)
	api.Get("/oauth/:platform/callback", oauth.Callback)
	api.Get("/conversations", inbox.List)
	api.Get("/conversations/:id/messages", inbox.Messages)
	api.Post("/conversations/:id/reply", inbox.Reply)
	api.Patch("/conversations/:id/status", inbox.UpdateStatus)
	api.Patch("/conversations/:id/meta", inbox.UpdateMeta)
	api.Post("/sync/:accountID", sync.Enqueue)

	api.Get("/webhooks/:platform", webhooks.Verify)
	api.Post("/webhooks/:platform", webhooks.Receive)

	app.Get("/ws/inbox", websocket.New(func(conn *websocket.Conn) {
		userID := conn.Query("user_id", "demo-user")
		deps.Hub.Serve(userID, conn)
	}))
}
