create extension if not exists "uuid-ossp";

do $$ begin
	create type social_platform as enum ('instagram', 'facebook', 'linkedin', 'x', 'youtube');
exception when duplicate_object then null; end $$;

do $$ begin
	create type conversation_status as enum ('unread', 'read', 'replied', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
	create type conversation_priority as enum ('low', 'normal', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
	create type message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null; end $$;

create table if not exists social_accounts (
	id uuid primary key default uuid_generate_v4(),
	user_id text not null,
	platform social_platform not null,
	provider_account_id text not null,
	display_name text not null default '',
	username text not null default '',
	access_token_encrypted text not null,
	refresh_token_encrypted text not null default '',
	scopes text[] not null default '{}',
	token_expires_at timestamptz,
	connected_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	is_active boolean not null default true,
	unique (user_id, platform, provider_account_id)
);

create table if not exists conversations (
	id uuid primary key default uuid_generate_v4(),
	user_id text not null,
	social_account_id uuid not null references social_accounts(id) on delete cascade,
	platform social_platform not null,
	provider_thread_id text not null,
	participant_id text not null default '',
	participant_name text not null default '',
	participant_username text not null default '',
	avatar_url text not null default '',
	subject text not null default '',
	last_message_preview text not null default '',
	last_message_at timestamptz not null default now(),
	status conversation_status not null default 'unread',
	priority conversation_priority not null default 'normal',
	tags text[] not null default '{}',
	sentiment text not null default 'neutral',
	spam_score numeric(5,4) not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (social_account_id, provider_thread_id)
);

create table if not exists messages (
	id uuid primary key default uuid_generate_v4(),
	conversation_id uuid not null references conversations(id) on delete cascade,
	social_account_id uuid not null references social_accounts(id) on delete cascade,
	platform social_platform not null,
	provider_message_id text not null,
	provider_parent_id text not null default '',
	direction message_direction not null,
	message_type text not null default 'message',
	author_id text not null default '',
	author_name text not null default '',
	body text not null default '',
	media_urls text[] not null default '{}',
	permalink text not null default '',
	sentiment text not null default 'neutral',
	spam_score numeric(5,4) not null default 0,
	raw_payload jsonb not null default '{}',
	created_at timestamptz not null default now(),
	unique (social_account_id, provider_message_id)
);

create table if not exists mentions (
	id uuid primary key default uuid_generate_v4(),
	conversation_id uuid references conversations(id) on delete cascade,
	social_account_id uuid not null references social_accounts(id) on delete cascade,
	provider_mention_id text not null,
	platform social_platform not null,
	author_id text not null default '',
	body text not null default '',
	permalink text not null default '',
	created_at timestamptz not null default now(),
	unique (social_account_id, provider_mention_id)
);

create table if not exists replies (
	id uuid primary key default uuid_generate_v4(),
	message_id uuid references messages(id) on delete cascade,
	conversation_id uuid not null references conversations(id) on delete cascade,
	provider_reply_id text not null,
	platform social_platform not null,
	body text not null,
	status text not null default 'sent',
	created_at timestamptz not null default now()
);

create table if not exists notifications (
	id uuid primary key default uuid_generate_v4(),
	user_id text not null,
	conversation_id uuid references conversations(id) on delete cascade,
	message_id uuid references messages(id) on delete cascade,
	title text not null,
	body text not null,
	is_read boolean not null default false,
	created_at timestamptz not null default now()
);

create index if not exists idx_conversations_user_last_message on conversations(user_id, last_message_at desc);
create index if not exists idx_conversations_filters on conversations(user_id, status, platform, priority);
create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at asc);
create index if not exists idx_notifications_user_unread on notifications(user_id, is_read, created_at desc);
