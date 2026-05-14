# Unified Social Inbox Architecture

## Backend Structure

```text
backend-go/
  cmd/server/main.go
  internal/config
  internal/controllers
  internal/database
  internal/models
  internal/queue
  internal/realtime
  internal/repositories
  internal/routes
  internal/services
  migrations/001_unified_inbox.sql
```

## Database Schema

The migration creates:

- `social_accounts`: connected Instagram, Facebook, LinkedIn, X, and YouTube accounts with encrypted tokens.
- `conversations`: normalized inbox threads with unread/read/replied status, tags, priority, sentiment, and spam score.
- `messages`: inbound and outbound messages/comments/replies/mentions.
- `mentions`: platform mentions that may or may not become full conversations.
- `replies`: provider reply audit records.
- `notifications`: unread inbox notifications for the product shell.

## API Routes

```text
GET    /api/inbox/accounts
GET    /api/inbox/oauth/:platform
GET    /api/inbox/oauth/:platform/callback
GET    /api/inbox/conversations
GET    /api/inbox/conversations/:id/messages
POST   /api/inbox/conversations/:id/reply
PATCH  /api/inbox/conversations/:id/status
PATCH  /api/inbox/conversations/:id/meta
POST   /api/inbox/sync/:accountID
GET    /api/inbox/webhooks/:platform
POST   /api/inbox/webhooks/:platform
GET    /ws/inbox
```

## Provider Boundaries

The service uses the `SocialClient` interface:

```go
type SocialClient interface {
  Platform() models.Platform
  SendReply(ctx context.Context, account models.SocialAccount, conversation models.Conversation, body string) (string, error)
  Poll(ctx context.Context, account models.SocialAccount) ([]models.NormalizedEvent, error)
}
```

Implementations are registered for:

- Meta Graph API: Instagram messages/comments and Facebook messages/comments.
- LinkedIn API: comments and mentions.
- X API v2: replies and mentions.
- YouTube Data API: comments and replies.

The current scaffold includes production call sites and comments for the exact provider operations; the final HTTP calls should be filled in after the Nebulaa apps have approved scopes, webhook subscriptions, and provider secrets.

## Normalized Message Shape

```json
{
  "platform": "instagram",
  "provider_thread_id": "ig-thread-42",
  "provider_message_id": "ig-message-1001",
  "message_type": "comment",
  "participant_name": "Priya Sharma",
  "participant_username": "priya.shop",
  "author_name": "Priya Sharma",
  "body": "Is the blue variant available this week?",
  "media_urls": [],
  "permalink": "https://instagram.com/p/example",
  "occurred_at": "2026-05-14T10:30:00Z"
}
```

## Real-Time Workflow

1. Social platform sends webhook to `/api/inbox/webhooks/:platform`.
2. Webhook controller loads the connected `social_account`.
3. Normalizer converts platform payload into `NormalizedEvent`.
4. Inbox service runs AI sentiment, spam, reply suggestions, and priority tagging.
5. Repository upserts `conversations`, inserts `messages`, and creates `notifications`.
6. WebSocket hub broadcasts `inbox.message.created` to `/ws/inbox`.
7. React updates the Gmail/chat-style inbox immediately.
8. User replies in Nebulaa.
9. Fiber reply route calls the matching provider client and stores the outbound message.
10. WebSocket broadcasts `inbox.message.replied`.

## Example Responses

Conversation list:

```json
{
  "success": true,
  "conversations": [
    {
      "id": "9e6d5d1e-7d32-4d5a-a979-f31f3a7a24b1",
      "platform": "instagram",
      "participant_name": "Priya Sharma",
      "participant_username": "priya.shop",
      "last_message_preview": "Is the blue variant available this week?",
      "status": "unread",
      "priority": "high",
      "tags": ["lead", "product"],
      "sentiment": "neutral",
      "spam_score": 0.03
    }
  ]
}
```

Thread:

```json
{
  "success": true,
  "messages": [
    {
      "id": "56dd7f74-6873-4e09-bc8a-83ac4fe63d38",
      "direction": "inbound",
      "message_type": "comment",
      "author_name": "Priya Sharma",
      "body": "Is the blue variant available this week?",
      "sentiment": "neutral",
      "spam_score": 0.03
    }
  ],
  "ai": {
    "suggestions": [
      "Thanks for reaching out. We can help you choose the right option.",
      "Happy to clarify. Could you share your preferred size or budget range?"
    ],
    "sentiment": "neutral",
    "priority": "normal"
  }
}
```

## Frontend

`frontend/pages/UnifiedInbox.tsx` provides:

- Conversation sidebar.
- Thread panel.
- Platform icons.
- Unread state.
- Filters for unread/read/replied, platform, and priority.
- Search.
- Reply composer.
- AI reply suggestions.
- Sentiment, spam, and priority summary.
- WebSocket live updates.
- Demo fallback data when the Go service is not running.
