-- 001_init: tenant catalogue and nightly inventory.
-- Every row below belongs to exactly one hotel (the tenant). Isolation is enforced twice:
-- every query filters on hotel_id (application layer) and composite foreign keys make it
-- impossible to link a row to another hotel's room type (database layer).

CREATE TABLE hotels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Public identifier embedded in the widget script tag (data-hotel-key). Not a secret.
  public_key      TEXT NOT NULL UNIQUE CHECK (public_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  -- IANA zone. "Today" for past-date checks is evaluated in this zone, not in UTC.
  timezone        TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'TRY' CHECK (currency ~ '^[A-Z]{3}$'),
  -- Exact browser origins (scheme + host + port) allowed to call the public API (CORS).
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE room_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id         UUID NOT NULL REFERENCES hotels (id),
  code             TEXT NOT NULL CHECK (code ~ '^[a-z0-9_-]+$'),
  name_tr          TEXT NOT NULL,
  name_en          TEXT NOT NULL,
  total_rooms      INTEGER NOT NULL CHECK (total_rooms > 0),
  max_guests       INTEGER NOT NULL CHECK (max_guests > 0),
  -- Money is stored as integer minor units (kurus) to avoid floating point errors.
  base_price_minor INTEGER NOT NULL CHECK (base_price_minor >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, code),
  -- Redundant with the primary key on purpose: target of inventory's composite foreign key.
  UNIQUE (hotel_id, id)
);

-- One row per hotel, room type and night. `booked` is incremented atomically by the
-- reservation use case (day 2); the CHECK constraint is the last line of defence against
-- overbooking even if application code is wrong.
CREATE TABLE inventory (
  hotel_id     UUID NOT NULL,
  room_type_id UUID NOT NULL,
  stay_date    DATE NOT NULL,
  -- Copied from room_types.total_rooms when the row is created; can be lowered per night
  -- (stop-sell, maintenance) without touching other dates.
  total        INTEGER NOT NULL CHECK (total >= 0),
  booked       INTEGER NOT NULL DEFAULT 0 CHECK (booked >= 0),
  PRIMARY KEY (hotel_id, room_type_id, stay_date),
  CONSTRAINT inventory_no_overbooking CHECK (booked <= total),
  FOREIGN KEY (hotel_id, room_type_id) REFERENCES room_types (hotel_id, id)
);
