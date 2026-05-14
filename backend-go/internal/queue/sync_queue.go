package queue

import (
	"context"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type SyncProcessor interface {
	SyncAccount(context.Context, string) error
}

type SyncQueue struct {
	redis     *redis.Client
	processor SyncProcessor
}

func NewRedisClient(redisURL string) *redis.Client {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		opt = &redis.Options{Addr: "localhost:6379"}
	}
	return redis.NewClient(opt)
}

func NewSyncQueue(redis *redis.Client, processor SyncProcessor) *SyncQueue {
	return &SyncQueue{redis: redis, processor: processor}
}

func (q *SyncQueue) Enqueue(ctx context.Context, accountID string) error {
	return q.redis.LPush(ctx, "nebulaa:inbox:sync", accountID).Err()
}

func (q *SyncQueue) Start(ctx context.Context, workers int) {
	for i := 0; i < workers; i++ {
		go func(workerID int) {
			for {
				result, err := q.redis.BRPop(ctx, 5*time.Second, "nebulaa:inbox:sync").Result()
				if err != nil {
					if err != redis.Nil {
						log.Printf("sync worker %d: %v", workerID, err)
					}
					continue
				}
				if len(result) != 2 {
					continue
				}
				if err := q.processor.SyncAccount(ctx, result[1]); err != nil {
					log.Printf("sync account %s: %v", result[1], err)
				}
			}
		}(i)
	}
}
