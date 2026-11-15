-- 001_init: the CRM's own database. Everything here is built from reservation events (ADR-0007);
-- the only data that originates here is staff users, notes and tags.

-- Hotels are learned from events (id, public key and name travel in every event).
CREATE TABLE hotels (
  id         UUID PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per real person per hotel. Identity = hotel + normalized email (ADR-0007).
CREATE TABLE guests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               UUID NOT NULL REFERENCES hotels (id),
  email                  TEXT NOT NULL,
  first_name             TEXT NOT NULL,
  last_name              TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  kvkk_accepted_at       TIMESTAMPTZ NOT NULL,
  marketing_consent      BOOLEAN NOT NULL,
  marketing_consented_at TIMESTAMPTZ,
  -- `created_at` of the reservation that supplied the contact details and consents above.
  -- A later event from an OLDER reservation (e.g. its cancellation) must not overwrite them.
  profile_as_of          TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (marketing_consent = (marketing_consented_at IS NOT NULL)),
  UNIQUE (hotel_id, id),
  UNIQUE (hotel_id, email)
);

CREATE INDEX guests_by_hotel_name ON guests (hotel_id, lower(last_name), lower(first_name));
CREATE INDEX guests_by_phone ON guests (hotel_id, phone);

-- Projection of the reservation aggregate: always the snapshot with the highest `version` seen.
CREATE TABLE guest_reservations (
  reservation_id    UUID PRIMARY KEY,
  hotel_id          UUID NOT NULL,
  guest_id          UUID NOT NULL,
  code              TEXT NOT NULL,
  status            TEXT NOT NULL,
  version           INTEGER NOT NULL,
  room_type_id      UUID NOT NULL,
  room_type_code    TEXT NOT NULL,
  room_type_name_tr TEXT NOT NULL,
  room_type_name_en TEXT NOT NULL,
  check_in          DATE NOT NULL,
  check_out         DATE NOT NULL,
  nights            INTEGER NOT NULL CHECK (nights >= 1),
  adults            INTEGER NOT NULL,
  children          INTEGER NOT NULL,
  total_price_minor INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  booked_at         TIMESTAMPTZ NOT NULL,
  cancelled_at      TIMESTAMPTZ,
  last_event_id     UUID NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id)
);

CREATE INDEX guest_reservations_by_guest ON guest_reservations (guest_id, check_in DESC);

CREATE TABLE guest_tags (
  hotel_id   UUID NOT NULL,
  guest_id   UUID NOT NULL,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guest_id, tag),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id) ON DELETE CASCADE
);

CREATE INDEX guest_tags_by_tag ON guest_tags (hotel_id, tag);

CREATE TABLE guest_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   UUID NOT NULL,
  guest_id   UUID NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  author     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, guest_id) REFERENCES guests (hotel_id, id) ON DELETE CASCADE
);

CREATE INDEX guest_notes_by_guest ON guest_notes (guest_id, created_at DESC);

-- Inbox: every handled event id, written in the SAME transaction as its effects. A redelivered
-- event finds its id here and does nothing, which makes the consumer idempotent.
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Panel users. The bearer token is stored only as a SHA-256 hash. A user belongs to one hotel,
-- referenced by its public key so staff can be created before the hotel's first event arrives.
CREATE TABLE staff_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_key  TEXT NOT NULL,
  name       TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
