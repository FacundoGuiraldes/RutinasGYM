-- ============================================================
-- Esquema PostgreSQL – App de rutinas (sedes Martínez y Olivos)
-- Es idempotente: se puede correr varias veces (npm run migrate).
-- ============================================================

-- ---------- Sedes y equipamiento ----------

CREATE TABLE IF NOT EXISTS sedes (
  id     SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL            -- "Martínez", "Olivos"
);

-- Tipos de equipamiento tal cual vienen en el dataset ("dumbbell", "cable", ...)
CREATE TABLE IF NOT EXISTS equipment (
  id  SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL
);

-- Qué equipamiento tiene cada sede
CREATE TABLE IF NOT EXISTS sede_equipment (
  sede_id      INT NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  equipment_id INT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  available    BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (sede_id, equipment_id)
);

-- ---------- Catálogo de ejercicios (importado de exercises-dataset) ----------

CREATE TABLE IF NOT EXISTS exercises (
  id                TEXT PRIMARY KEY,          -- id del dataset, ej. '0001' (el nombre NO es único)
  name              TEXT NOT NULL,             -- en inglés, tal cual el dataset
  body_part         TEXT NOT NULL,
  target            TEXT NOT NULL,             -- músculo principal
  muscle_group      TEXT,
  secondary_muscles JSONB NOT NULL DEFAULT '[]',
  equipment_id      INT NOT NULL REFERENCES equipment(id),
  steps_es          JSONB NOT NULL DEFAULT '[]',
  steps_en          JSONB NOT NULL DEFAULT '[]',
  image_path        TEXT NOT NULL,
  gif_path          TEXT NOT NULL,
  attribution       TEXT,
  media_id          TEXT,

  -- Campos propios (el dataset no los trae). Los completa classify.js y vos los podés corregir.
  role              TEXT,                      -- compound | isolation | core | cardio | mobility
  movement_pattern  TEXT,                      -- horizontal_push, vertical_pull, squat, hinge, ...
  level             INT,                       -- 1 principiante, 2 intermedio, 3 avanzado
  classified_by     TEXT NOT NULL DEFAULT 'rules',  -- 'rules' | 'admin' (si es 'admin', reimportar no lo pisa)
  enabled           BOOLEAN NOT NULL DEFAULT TRUE   -- apagalo para sacarlo de todas las rutinas
);
CREATE INDEX IF NOT EXISTS exercises_target_idx ON exercises (target, role);
CREATE INDEX IF NOT EXISTS exercises_equipment_idx ON exercises (equipment_id);

-- "Esta sede no usa este ejercicio": la memoria permanente del agente admin.
CREATE TABLE IF NOT EXISTS sede_exclusions (
  sede_id     INT  NOT NULL REFERENCES sedes(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sede_id, exercise_id)
);

-- ---------- Socios (acceso por link personal, sin registro) ----------

CREATE TABLE IF NOT EXISTS members (
  id            SERIAL PRIMARY KEY,
  nombre        TEXT NOT NULL,
  sede_id       INT  NOT NULL REFERENCES sedes(id),
  access_token  TEXT UNIQUE NOT NULL,          -- va en el link: /s/<access_token>
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  level         INT,                           -- 1..3 (se completa en el onboarding)
  days_per_week INT,                           -- 2..6
  focus         TEXT,                          -- general | hipertrofia | fuerza | bajar_grasa
  notes         TEXT,                          -- lesiones / limitaciones
  onboarded_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Rutinas ----------

-- Una rutina = un ciclo de 28 días. Cada ciclo se genera uno nuevo.
CREATE TABLE IF NOT EXISTS routines (
  id           SERIAL PRIMARY KEY,
  member_id    INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  cycle_number INT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | FINISHED
  starts_on    DATE NOT NULL,
  ends_on      DATE NOT NULL,                    -- el ciclo se cierra cuando hoy >= ends_on
  params       JSONB NOT NULL DEFAULT '{}',      -- nivel, días, enfoque y estado de progresión (prog)
  UNIQUE (member_id, cycle_number)
);

CREATE TABLE IF NOT EXISTS routine_days (
  id         SERIAL PRIMARY KEY,
  routine_id INT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  day_index  INT NOT NULL,
  label      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_exercises (
  id               SERIAL PRIMARY KEY,
  day_id           INT  NOT NULL REFERENCES routine_days(id) ON DELETE CASCADE,
  exercise_id      TEXT NOT NULL REFERENCES exercises(id),
  position         INT  NOT NULL,
  sets             INT  NOT NULL,
  reps             TEXT NOT NULL,                -- "8-12", "30-45 s", "10-15 min"
  rest_sec         INT,
  note             TEXT,
  replaced_from_id TEXT REFERENCES exercises(id) -- si es un reemplazo, de cuál vino
);
CREATE INDEX IF NOT EXISTS routine_exercises_day_idx ON routine_exercises (day_id, position);

-- ---------- Cumplimiento ----------

-- Una sesión = un día de rutina hecho (o empezado) en una fecha.
-- El mismo "Día 1" se repite cada semana, por eso hay una sesión por fecha.
CREATE TABLE IF NOT EXISTS sessions (
  id             SERIAL PRIMARY KEY,
  routine_day_id INT  NOT NULL REFERENCES routine_days(id) ON DELETE CASCADE,
  member_id      INT  NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_date   DATE NOT NULL,
  completed_at   TIMESTAMPTZ,                   -- se completa con "Día completo"
  UNIQUE (routine_day_id, session_date)
);

-- Ejercicios tildados dentro de una sesión
CREATE TABLE IF NOT EXISTS session_exercises (
  session_id          INT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  routine_exercise_id INT NOT NULL REFERENCES routine_exercises(id) ON DELETE CASCADE,
  done_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, routine_exercise_id)
);

-- Resultado de cada ciclo: la base de la progresión del siguiente
CREATE TABLE IF NOT EXISTS cycle_summaries (
  id                SERIAL PRIMARY KEY,
  routine_id        INT UNIQUE NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  planned_sessions  INT NOT NULL,
  completed_sessions INT NOT NULL,
  partial_sessions  INT NOT NULL,
  adherence_pct     REAL NOT NULL,
  decision          TEXT NOT NULL,              -- PROGRESS | MAINTAIN | SIMPLIFY
  changes           JSONB NOT NULL DEFAULT '[]'
);

-- ---------- Historial de cambios ----------

CREATE TABLE IF NOT EXISTS change_logs (
  id         SERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,                     -- MEMBER | ADMIN | SYSTEM
  member_id  INT REFERENCES members(id) ON DELETE SET NULL,
  sede_id    INT REFERENCES sedes(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,  -- ej: el socio mencionó dolor o lesión
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_logs_review_idx ON change_logs (needs_review, reviewed_at);

-- Segundo requisito de un ejercicio además del equipamiento principal (banco, rack). Opcional.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS extra_equipment_id INT REFERENCES equipment(id);
CREATE INDEX IF NOT EXISTS exercises_extra_equipment_idx ON exercises (extra_equipment_id);

-- Datos para planificar mejor la rutina (se piden en el onboarding)
ALTER TABLE members ADD COLUMN IF NOT EXISTS gender TEXT;                         -- mujer | hombre | otro
ALTER TABLE members ADD COLUMN IF NOT EXISTS priorities JSONB;                    -- zonas a priorizar en hipertrofia; NULL = no se preguntó, [] = parejo
ALTER TABLE members ADD COLUMN IF NOT EXISTS session_minutes INT;                 -- 45 | 60 | 75

ALTER TABLE exercises ADD COLUMN IF NOT EXISTS name_es TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS limitations JSONB NOT NULL DEFAULT '[]'::jsonb;
