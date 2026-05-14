package main

import (
	"context"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"

	"nebulaa/backend-go/internal/config"
	"nebulaa/backend-go/internal/database"
	"nebulaa/backend-go/internal/queue"
	"nebulaa/backend-go/internal/realtime"
	"nebulaa/backend-go/internal/repositories"
	"nebulaa/backend-go/internal/routes"
	"nebulaa/backend-go/internal/services"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()

	db, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer db.Close()

	redisClient := queue.NewRedisClient(cfg.RedisURL)
	hub := realtime.NewHub()
	go hub.Run()

	repos := repositories.New(db)
	crypto := services.NewTokenCipher(cfg.TokenEncryptionKey)
	socialClients := services.NewSocialClients(cfg)
	ai := services.NewAIService()
	inbox := services.NewInboxService(repos, hub, socialClients, ai)
	oauth := services.NewOAuthService(repos.SocialAccounts, crypto, cfg)
	syncQueue := queue.NewSyncQueue(redisClient, inbox)
	go syncQueue.Start(ctx, 4)

	app := fiber.New(fiber.Config{
		AppName:      "Nebulaa Unified Inbox",
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
	})
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: cfg.CORSOrigins,
		AllowHeaders: "Origin, Content-Type, Accept, Authorization, X-Hub-Signature-256",
		AllowMethods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
	}))

	routes.Register(app, routes.Dependencies{
		Config:     cfg,
		Repos:      repos,
		Inbox:      inbox,
		OAuth:      oauth,
		Queue:      syncQueue,
		Hub:        hub,
		AI:         ai,
		Authorizer: services.BearerAuthorizer{},
	})

	log.Printf("inbox service listening on %s", cfg.Port)
	log.Fatal(app.Listen(":" + cfg.Port))
}
