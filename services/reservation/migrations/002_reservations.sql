-- 002_reservations: reservations, idempotency keys and the transactional outbox.

CREATE TABLE reservations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               UUID NOT NULL REFERENCES hotels (id),
  room_type_id           UUID NOT NULL,
  -- Human-facing booking code shown on the confirmation screen, unique per hotel.
  code                   TEXT NOT NULL CHECK (code ~ '^[A-Z0-9-]{6,20}$'),
  status                 TEXT NOT NULL CHECK (status IN
                           ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW')),
  check_in               DATE NOT NULL,
  check_out              DATE NOT NULL,
  adults                 INTEGER NOT NULL CHECK (adults >= 1),
  children               INTEGER NOT NULL CHECK (children >= 0),
  total_price_minor      INTEGER NOT NULL CHECK (total_price_minor >= 0),
  currency               TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  guest_first_name       TEXT NOT NULL,
  guest_last_name        TEXT NOT NULL,
  guest_email            TEXT NOT NULL,
  guest_phone            TEXT NOT NULL,
  -- KVKK notice acknowledgement and marketing permission are separate, timestamped consents.
  kvkk_accepted_at       TIMESTAMPTZ NOT NULL,
  marketing_consent      BOOLEAN NOT NULL,
  marketing_consented_at TIMESTAMPTZ,
  -- Bumped on every state change; consumers use it to order events and ignore stale ones.
  version                INTEGER NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at           TIMESTAMPTZ,
  CHECK (check_out > check_in),
  CHECK (marketing_consent = (marketing_consented_at IS NOT NULL)),
  UNIQUE (hotel_id, code),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, room_type_id) REFERENCES room_types (hotel_id, id)
);

CREATE INDEX reservations_by_hotel_status ON reservations (hotel_id, status, check_in);
CREATE INDEX reservations_by_guest_email ON reservations (hotel_id, guest_email);

-- One row per (hotel, Idempotency-Key). It is inserted in the SAME transaction as the
-- reservation, so a rolled-back attempt (e.g. sold out) leaves no key behind and may be retried.
CREATE TABLE idempotency_keys (
  hotel_id         UUID NOT NULL REFERENCES hotels (id),
  key              TEXT NOT NULL,
  -- SHA-256 of the canonical request. Same key with a different body is rejected.
  request_hash     TEXT NOT NULL,
  -- NULL while the owning transaction is still running; set before it commits, so every
  -- committed row is complete and can be replayed verbatim.
  response_status  INTEGER,
  response_body    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, key),
  CHECK ((response_status IS NULL) = (response_body IS NULL))
);

-- Transactional outbox: events are written in the same transaction as the state change and
-- published to the broker by a separate relay (day 3). `seq` is the global publish order,
-- (aggregate_id, aggregate_version) the per-reservation order.
CREATE TABLE outbox_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               BIGSERIAL NOT NULL UNIQUE,
  hotel_id          UUID NOT NULL REFERENCES hotels (id),
  aggregate_type    TEXT NOT NULL,
  aggregate_id      UUID NOT NULL,
  aggregate_version INTEGER NOT NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at      TIMESTAMPTZ,
  UNIQUE (aggregate_type, aggregate_id, aggregate_version)
);

CREATE INDEX outbox_unpublished ON outbox_events (seq) WHERE published_at IS NULL;
