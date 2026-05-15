# Unified Social Inbox Architecture

Nebulaa Social Inbox now follows the existing MERN architecture:

- MongoDB and Mongoose for inbox persistence.
- Express routes under the existing `/api/social/inbox` namespace.
- React UI embedded inside Connect Socials at `/connect-socials/inbox`.
- Existing OAuth connection flow in `backend/routes/social.js`.
- This module uses only Express, React, Node.js, and MongoDB/Mongoose.

## Backend Structure

```text
backend/
  models/SocialInboxConversation.js
  services/socialInboxService.js
  routes/social.js
```

## API Routes

```text
GET    /api/social/inbox/summary
GET    /api/social/inbox/conversations
GET    /api/social/inbox/conversations/:id/messages
POST   /api/social/inbox/conversations/:id/reply
PATCH  /api/social/inbox/conversations/:id/status
PATCH  /api/social/inbox/conversations/:id/meta
POST   /api/social/inbox/sync/:platform
GET    /api/social/inbox/webhooks/:platform
POST   /api/social/inbox/webhooks/:platform
```

## Flow

```text
Connect Socials
  -> OAuth Authentication
  -> Webhook Registration
  -> Social Inbox Access
```

## Data Model

`SocialInboxConversation` stores normalized conversations and embeds messages:

- `platform`: `instagram`, `facebook`, `linkedin`, `x`, `youtube`
- `status`: `unread`, `read`, `replied`, `closed`
- `priority`: `low`, `normal`, `high`, `urgent`
- `tags`
- `sentiment`
- `spamScore`
- `messages[]`

## AI Engagement

`socialInboxService` provides the first production hook for:

- AI reply suggestions.
- Sentiment analysis.
- Spam scoring.
- Priority conversation tagging.
- Unread engagement alerts through summary counts.

Provider-specific reply dispatch for Meta Graph, LinkedIn, X, and YouTube should be added inside the existing Express reply route using the stored OAuth/Ayrshare account tokens.
