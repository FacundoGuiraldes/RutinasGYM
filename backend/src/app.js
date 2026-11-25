// API + archivos estáticos. Todo se arma con createApp para poder testearlo sin red ni base real.

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");

const { AppError } = require("./errors");
const { randomToken, safeEqual, localDate, weekStart, addDays } = require("./util");
const { createRoutine, getActiveRoutine, buildMemberView, WEEKS_PER_CYCLE } = require("./routines");
const { replaceRoutineExercise, replaceEverywhereInSede } = require("./replace");
const { closeDueCycles } = require("./progression");
const { runAgent } = require("./adminAgent");
const { FOCUSES } = require("./generator");
const { EQUIPMENT, equipmentInfo } = require("./equipment");

const ROLES = ["compound", "isolation", "core", "cardio", "mobility", "other"];

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function int(v, name, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, "VALIDATION", `${name} debe ser un número entre ${min} y ${max}`);
  return n;
}

function text(v, name, { max = 200, required = false } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw new AppError(400, "VALIDATION", `Falta ${name}`);
  if (s.length > max) throw new AppError(400, "VALIDATION", `${name} es demasiado largo (máximo ${max})`);
  return s;
}

// Limitador en memoria (suficiente para una sola instancia). Cuenta intentos por IP.
function makeLimiter({ windowMs, max }) {
  const hits = new Map();
  const prune = (now) => {
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  };
  return {
    // true = todavía puede intentar
    allow(key) {
      const now = Date.now();
      if (hits.size > 5000) prune(now);
      const e = hits.get(key);
      return !e || e.reset <= now || e.count < max;
    },
    hit(key) {
      const now = Date.now();
      const e = hits.get(key);
      if (!e || e.reset <= now) hits.set(key, { count: 1, reset: now + windowMs });
      else e.count += 1;
    },
  };
}

function createApp({
  db,
  ai,
  adminKey,
  mediaDir = null,
  mediaBase = "/media",
  publicUrl = "",
  publicDir = path.join(__dirname, "../public"),
  trustProxy = false,
}) {
  if (!adminKey || adminKey.length < 12) throw new Error("ADMIN_KEY debe tener al menos 12 caracteres");
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use(express.json({ limit: "50kb" }));

  // Cabeceras de seguridad. Referrer-Policy evita que el token del link viaje a otros sitios.
  let mediaOrigin = "";
  try {
    if (/^https?:/.test(mediaBase)) mediaOrigin = new URL(mediaBase).origin;
  } catch {
    /* mediaBase relativo */
  }
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'self'; img-src 'self' data: ${mediaOrigin}; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'`,
    });
    next();
  });

  const adminFails = makeLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
  const memberFails = makeLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
  const aiLimit = makeLimiter({ windowMs: 60 * 1000, max: 20 });

  const linkFor = (req, token) => `${publicUrl || `${req.protocol}://${req.get("host")}`}/s/${token}`;

  // ---------- Autenticación ----------

  const requireAdmin = (req, res, next) => {
    if (!adminFails.allow(req.ip)) return next(new AppError(429, "RATE_LIMIT", "Demasiados intentos. Esperá unos minutos."));
    const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    if (!m || !safeEqual(m[1], adminKey)) {
      adminFails.hit(req.ip);
      return next(new AppError(401, "UNAUTHORIZED", "Clave de administrador incorrecta"));
    }
    next();
  };

  const requireMember = h(async (req, res, next) => {
    if (!memberFails.allow(req.ip)) throw new AppError(429, "RATE_LIMIT", "Demasiados intentos. Esperá unos minutos.");
    const token = req.get("x-member-token") || "";
    const { rows } = token.length >= 20
      ? await db.query(
          `SELECT m.*, s.nombre AS sede_nombre FROM members m JOIN sedes s ON s.id = m.sede_id
           WHERE m.access_token = $1 AND m.active`,
          [token]
        )
      : { rows: [] };
    if (!rows[0]) {
      memberFails.hit(req.ip);
      throw new AppError(401, "UNAUTHORIZED", "Link inválido o desactivado. Pedile uno nuevo a tu profe.");
    }
    req.member = rows[0];
    next();
  });

  const aiRateLimit = (req, res, next) => {
    if (!aiLimit.allow(req.ip)) return next(new AppError(429, "RATE_LIMIT", "Vas muy rápido. Probá de nuevo en un minuto."));
    aiLimit.hit(req.ip);
    next();
  };

  // ---------- Estáticos ----------

  app.get("/healthz", (req, res) => res.json({ ok: true }));
  if (mediaDir) {
    // Solo las carpetas de medios (no el resto del dataset)
    for (const sub of ["images", "videos"]) {
      const dir = path.join(mediaDir, sub);
      if (fs.existsSync(dir)) {
        app.use(`/media/${sub}`, express.static(dir, { maxAge: "30d", index: false, dotfiles: "ignore" }));
      }
    }
  }
  app.get("/s/:token", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
  // Sin caché largo: así el panel y la app siempre muestran la versión nueva tras un deploy (el navegador revalida con ETag)
  app.use(express.static(publicDir, { index: "index.html", maxAge: 0 }));

  // ============================================================
  // API DEL SOCIO
  // ============================================================

  const memberView = (member) => buildMemberView(db, member, { mediaBase });

  app.get("/api/me", requireMember, h(async (req, res) => res.json(await memberView(req.member))));

  // Primera vez: el socio elige nivel, días y enfoque -> se genera su rutina
  app.post("/api/me/onboarding", requireMember, h(async (req, res) => {
    if (req.member.onboarded_at) throw new AppError(409, "ALREADY_ONBOARDED", "Ya tenés una rutina. Para cambiar tus datos hablá con tu profe.");
    const level = int(req.body.level, "level", 1, 3);
    const days = int(req.body.daysPerWeek, "daysPerWeek", 2, 6);
    const focus = text(req.body.focus, "focus", { required: true });
    if (!FOCUSES.includes(focus)) throw new AppError(400, "VALIDATION", `focus debe ser uno de: ${FOCUSES.join(", ")}`);
    const notes = text(req.body.notes, "notes", { max: 500 });

    const { rows } = await db.query(
      `UPDATE members SET level = $1, days_per_week = $2, focus = $3, notes = $4, onboarded_at = now()
       WHERE id = $5 RETURNING *`,
      [level, days, focus, notes || null, req.member.id]
    );
    const member = { ...rows[0], sede_nombre: req.member.sede_nombre };
    await createRoutine(db, member, { cycleNumber: 1 });
    if (notes) {
      await db.query(
        `INSERT INTO change_logs (actor, member_id, sede_id, action, payload, needs_review) VALUES ('MEMBER', $1, $2, 'onboarding_notes', $3::jsonb, TRUE)`,
        [member.id, member.sede_id, JSON.stringify({ notes })]
      );
    }
    res.status(201).json(await memberView(member));
  }));

  // Devuelve la sesión de hoy para un día de la rutina activa del socio (la crea si no existe)
  async function todaySession(member, dayId) {
    const { rows: ok } = await db.query(
      `SELECT d.id FROM routine_days d JOIN routines r ON r.id = d.routine_id
       WHERE d.id = $1 AND r.member_id = $2 AND r.status = 'ACTIVE'`,
      [dayId, member.id]
    );
    if (!ok[0]) throw new AppError(404, "NOT_FOUND", "Día no encontrado");
    const { rows } = await db.query(
      `INSERT INTO sessions (routine_day_id, member_id, session_date) VALUES ($1, $2, $3::date)
       ON CONFLICT (routine_day_id, session_date) DO UPDATE SET routine_day_id = EXCLUDED.routine_day_id
       RETURNING id, completed_at`,
      [dayId, member.id, localDate()]
    );
    return rows[0];
  }

  // Tildar / destildar un ejercicio hecho hoy
  app.post("/api/me/days/:dayId/exercises/:reId/toggle", requireMember, h(async (req, res) => {
    const dayId = int(req.params.dayId, "dayId", 1, 2 ** 31 - 1);
    const reId = int(req.params.reId, "reId", 1, 2 ** 31 - 1);
    const session = await todaySession(req.member, dayId);
    const { rows: own } = await db.query("SELECT 1 FROM routine_exercises WHERE id = $1 AND day_id = $2", [reId, dayId]);
    if (!own[0]) throw new AppError(404, "NOT_FOUND", "Ejercicio no encontrado en ese día");
    const { rowCount } = await db.query("DELETE FROM session_exercises WHERE session_id = $1 AND routine_exercise_id = $2", [session.id, reId]);
    if (rowCount) return res.json({ done: false });
    await db.query("INSERT INTO session_exercises (session_id, routine_exercise_id) VALUES ($1, $2)", [session.id, reId]);
    res.json({ done: true });
  }));

  // "Día completo"
  app.post("/api/me/days/:dayId/complete", requireMember, h(async (req, res) => {
    const dayId = int(req.params.dayId, "dayId", 1, 2 ** 31 - 1);
    const session = await todaySession(req.member, dayId);
    await db.query("UPDATE sessions SET completed_at = COALESCE(completed_at, now()) WHERE id = $1", [session.id]);
    res.json(await memberView(req.member));
  }));

  app.delete("/api/me/days/:dayId/complete", requireMember, h(async (req, res) => {
    const dayId = int(req.params.dayId, "dayId", 1, 2 ** 31 - 1);
    const session = await todaySession(req.member, dayId);
    await db.query("UPDATE sessions SET completed_at = NULL WHERE id = $1", [session.id]);
    res.json(await memberView(req.member));
  }));

  // Pedir otro ejercicio
  app.post("/api/me/exercises/:reId/replace", requireMember, aiRateLimit, h(async (req, res) => {
    const reId = int(req.params.reId, "reId", 1, 2 ** 31 - 1);
    const reason = text(req.body.reason, "reason", { max: 300 });
    const result = await replaceRoutineExercise(db, ai, { routineExerciseId: reId, memberId: req.member.id, actor: "MEMBER", reason });
    res.json({ result, view: await memberView(req.member) });
  }));

  // ============================================================
  // API ADMIN
  // ============================================================

  const admin = express.Router();
  admin.use(requireAdmin);
  app.use("/api/admin", admin);

  admin.get("/overview", h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM members WHERE active) AS members,
              (SELECT COUNT(*)::int FROM routines WHERE status = 'ACTIVE') AS active_routines,
              (SELECT COUNT(*)::int FROM change_logs WHERE needs_review AND reviewed_at IS NULL) AS to_review,
              (SELECT COUNT(*)::int FROM exercises WHERE enabled) AS exercises`
    );
    res.json({ ...rows[0], aiEnabled: Boolean(ai?.enabled), aiModel: ai?.model ?? null });
  }));

  // ----- Sedes y reglas -----

  admin.get("/sedes", h(async (req, res) => {
    const { rows: sedes } = await db.query("SELECT id, nombre FROM sedes ORDER BY id");
    const { rows: eq } = await db.query(
      `SELECT se.sede_id, q.key, se.available FROM sede_equipment se JOIN equipment q ON q.id = se.equipment_id ORDER BY q.key`
    );
    const { rows: ex } = await db.query(
      `SELECT x.sede_id, e.id, e.name, x.reason FROM sede_exclusions x JOIN exercises e ON e.id = x.exercise_id ORDER BY e.name`
    );
    res.json(sedes.map((s) => ({
      ...s,
      // Solo lo que se puede marcar por sede: máquinas y elementos (el peso corporal no necesita nada)
      equipment: eq
        .filter((e) => e.sede_id === s.id && equipmentInfo(e.key).kind !== "none")
        .map(({ key, available }) => ({ ...equipmentInfo(key), available }))
        .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label, "es") : a.kind === "machine" ? -1 : 1)),
      exclusions: ex.filter((e) => e.sede_id === s.id).map(({ id, name, reason }) => ({ id, name, reason })),
    })));
  }));

  admin.put("/sedes/:id/equipment", h(async (req, res) => {
    const sedeId = int(req.params.id, "id", 1, 2 ** 31 - 1);
    const key = text(req.body.equipment, "equipment", { required: true });
    const available = Boolean(req.body.available);
    if (EQUIPMENT[key]?.kind === "none") throw new AppError(400, "VALIDATION", "El peso corporal no necesita equipamiento: siempre está disponible");
    const { rows: eq } = await db.query("SELECT id FROM equipment WHERE key = $1", [key]);
    if (!eq[0]) throw new AppError(404, "NOT_FOUND", "Equipamiento inexistente");
    const { rowCount } = await db.query(
      `INSERT INTO sede_equipment (sede_id, equipment_id, available) SELECT id, $2::int, $3::boolean FROM sedes WHERE id = $1
       ON CONFLICT (sede_id, equipment_id) DO UPDATE SET available = EXCLUDED.available`,
      [sedeId, eq[0].id, available]
    );
    if (!rowCount) throw new AppError(404, "NOT_FOUND", "Sede inexistente");
    await db.query(`INSERT INTO change_logs (actor, sede_id, action, payload) VALUES ('ADMIN', $1, 'set_equipment', $2::jsonb)`, [sedeId, JSON.stringify({ equipment: key, available })]);
    let applied = null;
    if (!available && req.body.apply !== false) {
      const { rows: ex } = await db.query("SELECT id FROM exercises WHERE equipment_id = $1", [eq[0].id]);
      applied = await replaceEverywhereInSede(db, ai, { sedeId, exerciseIds: ex.map((e) => e.id), reason: `La sede no tiene ${key}` });
    }
    res.json({ ok: true, replaced: applied?.replaced.length ?? 0, failed: applied?.failed.length ?? 0 });
  }));

  admin.post("/sedes/:id/exclusions", h(async (req, res) => {
    const sedeId = int(req.params.id, "id", 1, 2 ** 31 - 1);
    const exerciseId = text(req.body.exerciseId, "exerciseId", { required: true });
    const reason = text(req.body.reason, "reason", { max: 200 });
    const { rows: ex } = await db.query("SELECT id, name FROM exercises WHERE id = $1", [exerciseId]);
    if (!ex[0]) throw new AppError(404, "NOT_FOUND", "Ejercicio inexistente");
    const { rowCount } = await db.query(
      `INSERT INTO sede_exclusions (sede_id, exercise_id, reason) SELECT id, $2::text, $3::text FROM sedes WHERE id = $1
       ON CONFLICT (sede_id, exercise_id) DO UPDATE SET reason = EXCLUDED.reason`,
      [sedeId, exerciseId, reason || null]
    );
    if (!rowCount) throw new AppError(404, "NOT_FOUND", "Sede inexistente");
    await db.query(`INSERT INTO change_logs (actor, sede_id, action, payload) VALUES ('ADMIN', $1, 'exclude_exercise', $2::jsonb)`, [sedeId, JSON.stringify({ exerciseIds: [exerciseId], names: [ex[0].name], reason })]);
    const applied = req.body.apply === false ? null : await replaceEverywhereInSede(db, ai, { sedeId, exerciseIds: [exerciseId], reason });
    res.status(201).json({ ok: true, replaced: applied?.replaced.length ?? 0, failed: applied?.failed.length ?? 0 });
  }));

  admin.delete("/sedes/:id/exclusions/:exerciseId", h(async (req, res) => {
    const sedeId = int(req.params.id, "id", 1, 2 ** 31 - 1);
    await db.query("DELETE FROM sede_exclusions WHERE sede_id = $1 AND exercise_id = $2", [sedeId, req.params.exerciseId]);
    res.json({ ok: true });
  }));

  // ----- Catálogo -----

  admin.get("/exercises", h(async (req, res) => {
    const params = [];
    const where = [];
    for (const word of text(req.query.q, "q", { max: 80 }).split(/\s+/).filter(Boolean).slice(0, 5)) {
      params.push(`%${word.replace(/[%_]/g, "")}%`);
      where.push(`e.name ILIKE $${params.length}`);
    }
    if (req.query.target) { params.push(String(req.query.target)); where.push(`e.target = $${params.length}`); }
    if (req.query.role) { params.push(String(req.query.role)); where.push(`e.role = $${params.length}`); }
    if (req.query.equipment) { params.push(String(req.query.equipment)); where.push(`q.key = $${params.length}`); }
    // needs = none | machine | implement: filtra por tipo de equipamiento que necesita el ejercicio
    if (["none", "machine", "implement"].includes(req.query.needs)) {
      const kind = req.query.needs;
      // "elemento" = todo lo que no es "none" ni "machine" (incluye claves nuevas desconocidas)
      const keys = Object.keys(EQUIPMENT).filter((k) => (kind === "implement" ? EQUIPMENT[k].kind !== "none" && EQUIPMENT[k].kind !== "machine" : EQUIPMENT[k].kind === kind));
      const marks = keys.map((k) => { params.push(k); return `$${params.length}`; });
      where.push(`q.key ${kind === "implement" ? "IN" : "IN"} (${marks.join(",")})`);
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = 40;
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const { rows: total } = await db.query(`SELECT COUNT(*)::int AS n FROM exercises e JOIN equipment q ON q.id = e.equipment_id ${w}`, params);
    const { rows } = await db.query(
      `SELECT e.id, e.name, e.target, e.role, e.movement_pattern AS pattern, e.level, e.enabled, e.classified_by,
              q.key AS equipment, e.image_path
       FROM exercises e JOIN equipment q ON q.id = e.equipment_id ${w}
       ORDER BY e.name, e.id LIMIT ${size} OFFSET ${(page - 1) * size}`,
      params
    );
    res.json({ total: total[0].n, page, pageSize: size, items: rows.map((r) => ({ ...r, equipmentLabel: equipmentInfo(r.equipment).label, needs: equipmentInfo(r.equipment).kind, imageUrl: `${mediaBase.replace(/\/$/, "")}/${r.image_path}` })) });
  }));

  admin.get("/exercise-facets", h(async (req, res) => {
    const { rows: t } = await db.query("SELECT DISTINCT target FROM exercises ORDER BY target");
    const { rows: q } = await db.query("SELECT key FROM equipment ORDER BY key");
    res.json({ targets: t.map((x) => x.target), equipment: q.map((x) => equipmentInfo(x.key)), roles: ROLES });
  }));

  admin.patch("/exercises/:id", h(async (req, res) => {
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (req.body.enabled !== undefined) add("enabled", Boolean(req.body.enabled));
    let classified = false;
    if (req.body.role !== undefined) {
      if (!ROLES.includes(req.body.role)) throw new AppError(400, "VALIDATION", `role debe ser uno de: ${ROLES.join(", ")}`);
      add("role", req.body.role); classified = true;
    }
    if (req.body.level !== undefined) { add("level", int(req.body.level, "level", 1, 3)); classified = true; }
    if (req.body.movementPattern !== undefined) { add("movement_pattern", text(req.body.movementPattern, "movementPattern", { max: 40, required: true })); classified = true; }
    if (!sets.length) throw new AppError(400, "VALIDATION", "Nada para cambiar");
    if (classified) sets.push("classified_by = 'admin'"); // así reimportar el catálogo no pisa tu corrección
    params.push(req.params.id);
    const { rowCount } = await db.query(`UPDATE exercises SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    if (!rowCount) throw new AppError(404, "NOT_FOUND", "Ejercicio inexistente");
    res.json({ ok: true });
  }));

  // ----- Socios -----

  admin.get("/members", h(async (req, res) => {
    const params = [];
    let where = "";
    const q = text(req.query.q, "q", { max: 80 });
    if (q) { params.push(`%${q.replace(/[%_]/g, "")}%`); where = "WHERE m.nombre ILIKE $1"; }
    const wk = weekStart(localDate());
    const { rows } = await db.query(
      `SELECT m.id, m.nombre, m.active, m.level, m.days_per_week, m.focus, m.onboarded_at, s.nombre AS sede,
              r.cycle_number, r.ends_on::text AS ends_on,
              (SELECT COUNT(*)::int FROM sessions x JOIN routine_days d ON d.id = x.routine_day_id
                WHERE d.routine_id = r.id AND x.completed_at IS NOT NULL) AS cycle_done,
              (SELECT COUNT(*)::int FROM sessions x JOIN routine_days d ON d.id = x.routine_day_id
                WHERE d.routine_id = r.id AND x.completed_at IS NOT NULL AND x.session_date >= '${wk}'::date AND x.session_date <= '${addDays(wk, 6)}'::date) AS week_done
       FROM members m JOIN sedes s ON s.id = m.sede_id
       LEFT JOIN routines r ON r.member_id = m.id AND r.status = 'ACTIVE'
       ${where} ORDER BY m.active DESC, m.nombre LIMIT 200`,
      params
    );
    res.json(rows.map((m) => ({ ...m, cyclePlanned: (m.days_per_week ?? 0) * WEEKS_PER_CYCLE })));
  }));

  admin.post("/members", h(async (req, res) => {
    const nombre = text(req.body.nombre, "nombre", { required: true, max: 80 });
    const sedeId = int(req.body.sedeId, "sedeId", 1, 2 ** 31 - 1);
    const { rows: sede } = await db.query("SELECT id FROM sedes WHERE id = $1", [sedeId]);
    if (!sede[0]) throw new AppError(404, "NOT_FOUND", "Sede inexistente");
    const notes = text(req.body.notes, "notes", { max: 500 });

    // Si el profe ya conoce nivel, días y enfoque, la rutina se genera al instante;
    // si no, el socio los elige él mismo al abrir su link.
    const hasPrefs = req.body.level && req.body.daysPerWeek && req.body.focus;
    let level = null, days = null, focus = null;
    if (hasPrefs) {
      level = int(req.body.level, "level", 1, 3);
      days = int(req.body.daysPerWeek, "daysPerWeek", 2, 6);
      focus = text(req.body.focus, "focus", { required: true });
      if (!FOCUSES.includes(focus)) throw new AppError(400, "VALIDATION", `focus debe ser uno de: ${FOCUSES.join(", ")}`);
    }
    const { rows } = await db.query(
      `INSERT INTO members (nombre, sede_id, access_token, level, days_per_week, focus, notes, onboarded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${hasPrefs ? "now()" : "NULL"}) RETURNING *`,
      [nombre, sedeId, randomToken(), level, days, focus, notes || null]
    );
    if (hasPrefs) await createRoutine(db, rows[0], { cycleNumber: 1 });
    res.status(201).json({ id: rows[0].id, nombre, link: linkFor(req, rows[0].access_token), onboarded: Boolean(hasPrefs) });
  }));

  async function loadMember(id) {
    const { rows } = await db.query(
      "SELECT m.*, s.nombre AS sede_nombre FROM members m JOIN sedes s ON s.id = m.sede_id WHERE m.id = $1",
      [id]
    );
    if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Socio inexistente");
    return rows[0];
  }

  admin.get("/members/:id", h(async (req, res) => {
    const m = await loadMember(int(req.params.id, "id", 1, 2 ** 31 - 1));
    const { rows: history } = await db.query(
      `SELECT r.cycle_number, c.adherence_pct, c.decision, c.changes, c.completed_sessions, c.planned_sessions
       FROM cycle_summaries c JOIN routines r ON r.id = c.routine_id WHERE r.member_id = $1 ORDER BY r.cycle_number DESC`,
      [m.id]
    );
    res.json({
      member: { id: m.id, nombre: m.nombre, sedeId: m.sede_id, sede: m.sede_nombre, active: m.active, level: m.level, daysPerWeek: m.days_per_week, focus: m.focus, notes: m.notes },
      link: linkFor(req, m.access_token),
      view: await memberView(m),
      history,
    });
  }));

  admin.patch("/members/:id", h(async (req, res) => {
    const id = int(req.params.id, "id", 1, 2 ** 31 - 1);
    await loadMember(id);
    const sets = [];
    const params = [];
    const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (req.body.nombre !== undefined) add("nombre", text(req.body.nombre, "nombre", { required: true, max: 80 }));
    if (req.body.notes !== undefined) add("notes", text(req.body.notes, "notes", { max: 500 }) || null);
    if (req.body.active !== undefined) add("active", Boolean(req.body.active));
    if (!sets.length) throw new AppError(400, "VALIDATION", "Nada para cambiar");
    params.push(id);
    await db.query(`UPDATE members SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
    res.json({ ok: true });
  }));

  // Rehace la rutina con nuevas preferencias (el ciclo anterior queda cerrado sin evaluación)
  admin.post("/members/:id/regenerate", h(async (req, res) => {
    const id = int(req.params.id, "id", 1, 2 ** 31 - 1);
    const m = await loadMember(id);
    const level = int(req.body.level ?? m.level, "level", 1, 3);
    const days = int(req.body.daysPerWeek ?? m.days_per_week, "daysPerWeek", 2, 6);
    const focus = text(req.body.focus ?? m.focus, "focus", { required: true });
    if (!FOCUSES.includes(focus)) throw new AppError(400, "VALIDATION", `focus debe ser uno de: ${FOCUSES.join(", ")}`);
    const { rows } = await db.query(
      `UPDATE members SET level = $1, days_per_week = $2, focus = $3, onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $4 RETURNING *`,
      [level, days, focus, id]
    );
    const { rows: last } = await db.query("SELECT COALESCE(MAX(cycle_number), 0)::int AS n FROM routines WHERE member_id = $1", [id]);
    await db.query("UPDATE routines SET status = 'FINISHED' WHERE member_id = $1 AND status = 'ACTIVE'", [id]);
    const r = await createRoutine(db, rows[0], { cycleNumber: last[0].n + 1 });
    await db.query(`INSERT INTO change_logs (actor, member_id, sede_id, action, payload) VALUES ('ADMIN', $1, $2, 'regenerate_routine', $3::jsonb)`, [id, m.sede_id, JSON.stringify({ level, days, focus })]);
    res.json({ ok: true, routineId: r.routineId, warnings: r.warnings });
  }));

  admin.post("/members/:id/rotate-token", h(async (req, res) => {
    const id = int(req.params.id, "id", 1, 2 ** 31 - 1);
    await loadMember(id);
    const token = randomToken();
    await db.query("UPDATE members SET access_token = $1 WHERE id = $2", [token, id]);
    res.json({ link: linkFor(req, token) });
  }));

  admin.post("/routine-exercises/:id/replace", h(async (req, res) => {
    const id = int(req.params.id, "id", 1, 2 ** 31 - 1);
    const reason = text(req.body.reason, "reason", { max: 300 });
    const result = await replaceRoutineExercise(db, ai, {
      routineExerciseId: id, actor: "ADMIN", reason, forcedExerciseId: req.body.exerciseId || null,
    });
    if (req.body.excludeInSede) {
      const { rows } = await db.query(
        `SELECT m.sede_id FROM routine_exercises re JOIN routine_days d ON d.id = re.day_id JOIN routines r ON r.id = d.routine_id JOIN members m ON m.id = r.member_id WHERE re.id = $1`,
        [id]
      );
      await db.query(
        `INSERT INTO sede_exclusions (sede_id, exercise_id, reason) VALUES ($1, $2, $3) ON CONFLICT (sede_id, exercise_id) DO UPDATE SET reason = EXCLUDED.reason`,
        [rows[0].sede_id, result.from.id, reason || null]
      );
    }
    res.json({ result });
  }));

  // ----- Historial y revisión -----

  admin.get("/changes", h(async (req, res) => {
    const review = req.query.review === "1";
    const { rows } = await db.query(
      `SELECT c.id, c.actor, c.action, c.payload, c.needs_review, c.reviewed_at, c.created_at, m.nombre AS member, s.nombre AS sede
       FROM change_logs c LEFT JOIN members m ON m.id = c.member_id LEFT JOIN sedes s ON s.id = c.sede_id
       ${review ? "WHERE c.needs_review AND c.reviewed_at IS NULL" : ""}
       ORDER BY c.id DESC LIMIT 100`
    );
    res.json(rows);
  }));

  admin.post("/changes/:id/review", h(async (req, res) => {
    await db.query("UPDATE change_logs SET reviewed_at = now() WHERE id = $1", [int(req.params.id, "id", 1, 2 ** 31 - 1)]);
    res.json({ ok: true });
  }));

  // ----- Agente y mantenimiento -----

  admin.post("/agent", aiRateLimit, h(async (req, res) => {
    res.json(await runAgent(db, ai, req.body.messages));
  }));

  admin.post("/cycles/run", h(async (req, res) => {
    res.json({ results: await closeDueCycles(db) });
  }));

  // ---------- Errores ----------

  app.use("/api", (req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta inexistente" } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: { code: "BAD_JSON", message: "JSON inválido" } });
    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL", message: "Error interno" } });
  });

  return app;
}

module.exports = { createApp };
