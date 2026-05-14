# Nebulaa Unified Social Inbox Service

Go Fiber service for a centralized social inbox across Instagram, Facebook, LinkedIn, X, and YouTube.

## Run

```bash
cd backend-go
go mod download
go run ./cmd/server
```

Required production environment:

```env
DATABASE_URL=postgres://...
REDIS_URL=redis://...
TOKEN_ENCRYPTION_KEY=32+ byte secret
PUBLIC_BASE_URL=https://api.nebulaa.com
META_CLIENT_ID=
META_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

## Real-Time Flow

1. Platform webhook posts to `/api/inbox/webhooks/:platform`.
2. `NormalizeWebhook` converts provider payloads into `NormalizedEvent`.
3. `InboxService.Ingest` upserts the conversation, stores the message, runs AI sentiment/spam/priority analysis, creates a notification, and broadcasts through `/ws/inbox`.
4. React receives `inbox.message.created` and updates the sidebar/thread instantly.
5. User replies from Nebulaa.
6. `/api/inbox/conversations/:id/reply` calls the correct provider client and stores the outbound message.

## Example Webhook Payload

```json
{
  "id": "ig-mid-001",
  "thread_id": "ig-thread-42",
  "type": "comment",
  "author_id": "1789",
  "author_name": "Priya Sharma",
  "author_username": "priya.shop",
  "text": "Is this available in blue?",
  "permalink": "https://instagram.com/p/example",
  "media_urls": []
}
```

## Example Conversation Response

```json
{
  "success": true,
  "conversations": [
    {
      "id": "c9f4...",
      "platform": "instagram",
      "participant_name": "Priya Sharma",
      "last_message_preview": "Is this available in blue?",
      "status": "unread",
      "priority": "normal",
      "tags": ["lead"],
      "sentiment": "neutral",
      "spam_score": 0.05
    }
  ]
}
```
