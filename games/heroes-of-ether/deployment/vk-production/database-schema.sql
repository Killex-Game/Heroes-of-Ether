-- ПРОЕКТ схемы PostgreSQL 17/18. Локальная игра не выполняет этот файл.
-- Применять через отдельную миграцию только к новой тестовой БД.
-- Встроены ограничения уникальности; игровая валидация и транзакционный адаптер
-- ProfileStore ещё должны быть реализованы. Этот DDL не переносит profiles.json.
BEGIN;
CREATE SCHEMA sferorumiya;

CREATE TABLE sferorumiya.players (
  id uuid PRIMARY KEY,
  vk_app_id bigint NOT NULL CHECK (vk_app_id > 0),
  vk_user_id bigint NOT NULL CHECK (vk_user_id > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vk_app_id, vk_user_id)
);

-- Начальный переход сохраняет структуру профиля (wallet, inventory, progress,
-- activity, account, cosmetics) в JSONB, но каждый игрок имеет отдельную строку.
-- state.wallet является единственным источником балансов; ledger лишь журнал.
-- Перед изменением SELECT ... FOR UPDATE; COMMIT до ответа об успехе.
CREATE TABLE sferorumiya.player_state (
  player_id uuid PRIMARY KEY REFERENCES sferorumiya.players(id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sferorumiya.clans (
  id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
);
CREATE TABLE sferorumiya.clan_members (
  player_id uuid PRIMARY KEY REFERENCES sferorumiya.players(id),
  clan_id uuid NOT NULL REFERENCES sferorumiya.clans(id),
  role text NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX clan_members_by_clan ON sferorumiya.clan_members(clan_id);
-- Лимит 15..50 проверять под блокировкой строки clans. members — источник состава;
-- старые clanId/memberIds в JSON при миграции удалить или собирать только в ответе.

CREATE TABLE sferorumiya.operations (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES sferorumiya.players(id),
  request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  action text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  result jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, request_id)
);
CREATE TABLE sferorumiya.currency_ledger (
  operation_id uuid NOT NULL REFERENCES sferorumiya.operations(id),
  currency text NOT NULL CHECK (currency IN ('coins', 'crystals', 'bucks')),
  delta bigint NOT NULL,
  balance_after bigint NOT NULL CHECK (balance_after BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (operation_id, currency)
);
CREATE TABLE sferorumiya.payment_orders (
  vk_app_id bigint NOT NULL,
  provider_order_id text NOT NULL,
  player_id uuid NOT NULL REFERENCES sferorumiya.players(id),
  product_id text NOT NULL,
  votes integer NOT NULL CHECK (votes > 0),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  grant_operation_id uuid UNIQUE REFERENCES sferorumiya.operations(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vk_app_id, provider_order_id)
);
CREATE TABLE sferorumiya.daily_bonus_claims (
  player_id uuid NOT NULL REFERENCES sferorumiya.players(id),
  account_kind text NOT NULL CHECK (account_kind IN ('vip', 'premium')),
  currency text NOT NULL CHECK (currency IN ('coins', 'crystals', 'bucks')),
  moscow_day date NOT NULL,
  operation_id uuid NOT NULL REFERENCES sferorumiya.operations(id),
  PRIMARY KEY (player_id, account_kind, currency, moscow_day)
);
-- moscow_day = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date.
-- Проверка срока VIP/Premium и выдача выполняются одной транзакцией.

CREATE TABLE sferorumiya.arena_progress_receipts (
  arena_id text NOT NULL,
  worker_epoch uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (arena_id, worker_epoch, sequence)
);
-- Один progressReceipt на весь сервер из старого JSON для нескольких арен не подходит.
CREATE TABLE sferorumiya.active_arena_sessions (
  player_id uuid PRIMARY KEY REFERENCES sferorumiya.players(id),
  arena_id text NOT NULL,
  worker_epoch uuid NOT NULL,
  session_id uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX arena_session_expiry ON sferorumiya.active_arena_sessions(expires_at);
-- После окончания lease старый worker обязан прекратить мутации/симуляцию игрока.

CREATE TABLE sferorumiya.outbox (
  event_id uuid PRIMARY KEY,
  operation_id uuid REFERENCES sferorumiya.operations(id),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX pending_outbox ON sferorumiya.outbox(created_at) WHERE delivered_at IS NULL;
COMMIT;
