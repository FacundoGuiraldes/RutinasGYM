// Panel del administrador (profe). Sin dependencias; todo el contenido se arma con textContent.
(() => {
  "use strict";

  const $app = document.getElementById("app");
  const dlg = document.getElementById("dlg");
  const FOCUS = { general: "General", hipertrofia: "Ganar músculo", fuerza: "Fuerza", bajar_grasa: "Bajar grasa" };
  const GENDER_OPTS = [{ v: "", t: "Sin dato" }, { v: "mujer", t: "Mujer" }, { v: "hombre", t: "Hombre" }, { v: "otro", t: "Otro" }];
  const MIN_OPTS = [{ v: 45, t: "45 min" }, { v: 60, t: "60 min" }, { v: 75, t: "75 min" }];
  const ZONE_OPTS = [{ v: "pecho", t: "Pecho" }, { v: "espalda", t: "Espalda" }, { v: "hombros", t: "Hombros" }, { v: "brazos", t: "Brazos" }, { v: "piernas", t: "Piernas" }, { v: "gluteos", t: "Glúteos" }, { v: "abdomen", t: "Abdomen" }];
  let key = sessionStorage.getItem("adminKey");
  let tab = "socios";
  let sedes = [];
  let chat = []; // historial del agente: [{role, content, actions?}]

  // ---------- Utilidades ----------

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  function toast(msg, isErr = false) {
    document.querySelector(".toast")?.remove();
    const t = h("div", { class: "toast" + (isErr ? " err" : ""), role: "status" }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), isErr ? 7000 : 4000);
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      sessionStorage.removeItem("adminKey");
      key = null;
      renderLogin("La clave no es correcta.");
      throw new Error("No autorizado");
    }
    if (!res.ok) throw new Error(data?.error?.message || "Algo salió mal");
    return data;
  }

  const attempt = async (fn) => {
    try { return await fn(); } catch (e) { if (e.message !== "No autorizado") toast(e.message, true); return null; }
  };

  const setLoading = (btn, on) => { btn.classList.toggle("is-loading", on); btn.disabled = on; };
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const fmtDate = (d) => new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  function modal(title, bodyNodes, buttons) {
    dlg.replaceChildren(h("h3", { text: title }), h("div", { class: "stack", style: "margin:10px 0" }, ...bodyNodes),
      h("div", { class: "row" }, ...buttons.map((b) => h("button", { class: (b.primary ? "primary " : "ghost ") + "grow", type: "button", text: b.text, onclick: async () => { if ((await b.run?.()) !== false) dlg.close(); } }))));
    dlg.showModal();
  }
  dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });

  const select = (options, value, attrs = {}) => {
    const s = h("select", attrs, ...options.map((o) => h("option", { value: String(o.v), text: o.t, selected: String(o.v) === String(value) })));
    return s;
  };
  // Campos de perfil para hipertrofia: género, minutos y hasta 2 zonas a priorizar.
  // Zona 1 = "Automático" (según género) o "Parejo" o una zona; zona 2 es opcional.
  function profileFields(m = {}) {
    const gender = select(GENDER_OPTS, m.gender ?? "");
    const minutes = select(MIN_OPTS, m.sessionMinutes ?? 60);
    const cur = Array.isArray(m.priorities) ? m.priorities : null;
    const z1 = select([{ v: "auto", t: "Zona 1: automática" }, { v: "parejo", t: "Zona 1: parejo" }, ...ZONE_OPTS.map((z) => ({ v: z.v, t: `Zona 1: ${z.t}` }))], cur === null ? "auto" : cur.length === 0 ? "parejo" : cur[0]);
    const z2 = select([{ v: "", t: "Zona 2: ninguna" }, ...ZONE_OPTS.map((z) => ({ v: z.v, t: `Zona 2: ${z.t}` }))], cur?.[1] ?? "");
    const wrap = h("div", { class: "row wrap" }, gender, minutes, z1, z2);
    const body = (focus) => {
      const b = { sessionMinutes: Number(minutes.value) };
      if (gender.value) b.gender = gender.value;
      if (focus === "hipertrofia" && z1.value !== "auto") b.priorities = z1.value === "parejo" ? [] : [...new Set([z1.value, z2.value].filter(Boolean))];
      return b;
    };
    return { wrap, body };
  }
  const sedeOptions = () => sedes.map((s) => ({ v: s.id, t: s.nombre }));

  // ---------- Marca y carga ----------

  const SVG_NS = "http://www.w3.org/2000/svg";
  // Logo: un disco de pesas visto de frente
  function brandMark() {
    const s = (tag, attrs) => { const el = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
    const svg = s("svg", { viewBox: "0 0 40 40", "aria-hidden": "true" });
    svg.append(s("circle", { cx: 20, cy: 20, r: 19, fill: "var(--ink)" }), s("circle", { cx: 20, cy: 20, r: 14, fill: "var(--accent)" }), s("circle", { cx: 20, cy: 20, r: 8.5, fill: "var(--ink)" }), s("circle", { cx: 20, cy: 20, r: 3.2, fill: "var(--bg)" }));
    return svg;
  }
  const brand = () => h("div", { class: "brand" }, brandMark(), h("h1", { style: "font-size:2.2rem", text: "Panel del profe" }));
  const skeletonRows = (n = 5) => h("div", { class: "card", role: "status", "aria-label": "Cargando" }, ...Array.from({ length: n }, () => h("div", { class: "sk", style: "height:46px;margin:10px 0" })));

  // ---------- Login ----------

  function renderLogin(msg) {
    const input = h("input", { type: "password", autocomplete: "current-password", placeholder: "Clave de administrador" });
    const go = async () => {
      key = input.value.trim();
      if (!key) return;
      try {
        await api("GET", "/api/admin/overview");
        sessionStorage.setItem("adminKey", key);
        boot();
      } catch { /* api() ya mostró el login */ }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
    document.body.classList.remove("wide");
    $app.removeAttribute("aria-busy");
    $app.replaceChildren(h("div", { class: "card" }, brand(), msg ? h("p", { class: "pill bad", text: msg }) : null, h("label", { text: "Clave" }), input, h("button", { class: "primary full", style: "margin-top:12px", type: "button", text: "Entrar", onclick: go })));
    input.focus();
  }

  // ---------- Estructura ----------

  async function boot() {
    document.body.classList.add("wide");
    // Mientras llegan los datos: el disco gira y se ve la forma de lo que viene
    $app.replaceChildren(h("div", { class: "boot", role: "status", "aria-label": "Cargando" }, h("div", { class: "boot-head" }, h("div", { class: "plate-spinner" }), h("div", { class: "sk", style: "height:34px;width:40%" })), skeletonRows(4)));
    const [ov, sd] = await Promise.all([api("GET", "/api/admin/overview"), api("GET", "/api/admin/sedes")]).catch(() => [null, null]);
    if (!ov) return;
    sedes = sd;
    const tabs = [["socios", "Socios"], ["sedes", "Sedes"], ["catalogo", "Catálogo"], ["agente", "Agente IA"], ["revisar", `Revisar${ov.to_review ? ` (${ov.to_review})` : ""}`]];
    const nav = h("div", { class: "tabs", role: "tablist" }, ...tabs.map(([id, label]) => h("button", { role: "tab", "aria-selected": String(tab === id), text: label, onclick: () => { tab = id; boot(); } })));
    const head = h("div", { class: "topbar" },
      brand(),
      h("div", { class: "row wrap" }, h("span", { class: "pill", text: `${ov.members} socios` }), h("span", { class: "pill", text: `${ov.active_routines} rutinas activas` }), h("span", { class: "pill " + (ov.aiEnabled ? "ok" : "warn"), text: ov.aiEnabled ? "IA activa" : "IA apagada" }),
        h("button", { class: "small ghost", text: "Cerrar ciclos vencidos", onclick: () => attempt(async () => { const r = await api("POST", "/api/admin/cycles/run"); toast(`Ciclos procesados: ${r.results.length}`); boot(); }) }),
        h("button", { class: "small ghost", text: "Salir", onclick: () => { sessionStorage.removeItem("adminKey"); key = null; renderLogin(); } })));
    const body = h("div");
    $app.removeAttribute("aria-busy");
    $app.replaceChildren(head, nav, body);
    ({ socios: viewMembers, sedes: viewSedes, catalogo: viewCatalog, agente: viewAgent, revisar: viewReview })[tab](body, ov);
  }

  // ---------- Socios ----------

  async function viewMembers(root) {
    const q = h("input", { type: "search", placeholder: "Buscar socio…" });
    const list = h("div");
    const load = async () => {
      list.replaceChildren(skeletonRows(5));
      const rows = await attempt(() => api("GET", `/api/admin/members?q=${encodeURIComponent(q.value)}`));
      if (!rows) return;
      list.replaceChildren(h("div", { class: "card", style: "overflow-x:auto" }, h("table", {},
        h("thead", {}, h("tr", {}, ...["Socio", "Sede", "Plan", "Semana", "Mes", ""].map((t) => h("th", { text: t })))),
        h("tbody", {}, ...rows.map((m) => h("tr", {},
          h("td", {}, h("b", { text: m.nombre }), m.active ? null : h("span", { class: "pill bad", text: " inactivo" })),
          h("td", { text: m.sede }),
          h("td", { text: m.onboarded_at ? `Nv ${m.level} · ${m.days_per_week}d · ${FOCUS[m.focus] ?? m.focus}` : "Sin completar" }),
          h("td", { text: m.onboarded_at ? `${m.week_done}/${m.days_per_week}` : "—" }),
          h("td", { text: m.onboarded_at ? `${m.cycle_done}/${m.cyclePlanned}` : "—" }),
          h("td", {}, h("button", { class: "small", text: "Abrir", onclick: () => viewMember(root, m.id) }))))))));
      if (!rows.length) list.replaceChildren(h("p", { class: "muted", text: "No hay socios todavía. Creá el primero con “Nuevo socio”." }));
    };
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
    root.append(h("div", { class: "row", style: "margin-top:12px" }, q, h("button", { class: "primary", text: "Nuevo socio", onclick: newMember })), list);
    load();
  }

  function newMember() {
    const nombre = h("input", { placeholder: "Nombre y apellido", maxlength: "80" });
    const sede = select(sedeOptions(), sedes[0]?.id);
    const withPrefs = h("input", { type: "checkbox" });
    const level = select([{ v: 1, t: "Principiante" }, { v: 2, t: "Intermedio" }, { v: 3, t: "Avanzado" }], 1);
    const days = select([2, 3, 4, 5, 6].map((d) => ({ v: d, t: `${d} días` })), 3);
    const focus = select(Object.entries(FOCUS).map(([v, t]) => ({ v, t })), "general");
    const pf = profileFields();
    const prefs = h("div", { class: "stack hidden" }, h("label", { text: "Nivel" }), level, h("label", { text: "Días por semana" }), days, h("label", { text: "Enfoque" }), focus,
      h("label", { text: "Género, duración y zonas a priorizar (las zonas solo cuentan en Ganar músculo)" }), pf.wrap);
    withPrefs.addEventListener("change", () => prefs.classList.toggle("hidden", !withPrefs.checked));
    modal("Nuevo socio", [h("label", { text: "Nombre" }), nombre, h("label", { text: "Sede" }), sede,
      h("label", { class: "row", style: "font-weight:500" }, withPrefs, " Cargar nivel, días y enfoque yo (si no, los elige el socio)"), prefs], [
      { text: "Cancelar" },
      { text: "Crear y obtener link", primary: true, run: async () => {
        const body = { nombre: nombre.value, sedeId: Number(sede.value) };
        if (withPrefs.checked) Object.assign(body, { level: Number(level.value), daysPerWeek: Number(days.value), focus: focus.value }, pf.body(focus.value));
        const r = await attempt(() => api("POST", "/api/admin/members", body));
        if (!r) return false;
        showLink(r.nombre, r.link);
        boot();
      } },
    ]);
  }

  function showLink(nombre, link) {
    setTimeout(() => modal(`Link de ${nombre}`, [
      h("p", { class: "muted", text: "Mandáselo por WhatsApp. Es personal: quien lo tenga entra a esa rutina. Si se filtra, generá uno nuevo desde la ficha del socio." }),
      h("input", { value: link, readonly: true, onclick: (e) => e.target.select() }),
    ], [{ text: "Cerrar" }, { text: "Copiar link", primary: true, run: async () => { try { await navigator.clipboard.writeText(link); toast("Link copiado"); } catch { toast("Copialo a mano: seleccioná el texto", true); return false; } } }]), 50);
  }

  async function viewMember(root, id) {
    const d = await attempt(() => api("GET", `/api/admin/members/${id}`));
    if (!d) return;
    const m = d.member;
    const rep = (re, opts = {}) => async () => {
      const reason = prompt("Motivo (opcional):", opts.exclude ? "La sede no tiene este ejercicio" : "") ?? null;
      if (reason === null) return;
      const r = await attempt(() => api("POST", `/api/admin/routine-exercises/${re.id}/replace`, { reason, excludeInSede: Boolean(opts.exclude) }));
      if (r) { toast(`${cap(r.result.from.name)} → ${cap(r.result.to.name)}${opts.exclude ? " (regla de sede guardada)" : ""}`); viewMember(root, id); }
    };
    // Una fila por ejercicio, con acciones para el profe
    const exerciseRow = (e) =>
      h("div", { class: "ex-admin" },
        h("img", { class: "ex-thumb", src: e.exercise.imageUrl, alt: "", loading: "lazy", style: "width:56px;height:56px" }),
        h("div", { class: "grow" },
          h("div", { class: "ex-name", text: e.exercise.name }),
          h("div", { class: "ex-meta", text: `${e.sets} × ${e.reps} · ${cap(e.exercise.target)} · ${e.exercise.equipmentLabel || e.exercise.equipment}${e.replaced ? " · cambiado" : ""}` }),
          h("div", { class: "ex-actions" },
            h("button", { class: "small", text: "Cambiar", onclick: rep(e) }),
            h("button", { class: "small danger", text: "No hay en la sede", onclick: rep(e, { exclude: true }) }))));
    const dayCard = (day) => h("div", { class: "card" }, h("h3", { text: day.estMinutes ? `${day.label} (unos ${day.estMinutes} min)` : day.label }), ...day.exercises.map(exerciseRow));
    const days = d.view.routine
      ? d.view.routine.days.map(dayCard)
      : [h("p", { class: "muted", text: "Todavía no armó su rutina (tiene que elegir nivel, días y enfoque desde su link)." })];

    const level = select([{ v: 1, t: "Principiante" }, { v: 2, t: "Intermedio" }, { v: 3, t: "Avanzado" }], m.level ?? 1);
    const dsel = select([2, 3, 4, 5, 6].map((x) => ({ v: x, t: `${x} días` })), m.daysPerWeek ?? 3);
    const focus = select(Object.entries(FOCUS).map(([v, t]) => ({ v, t })), m.focus ?? "general");
    const pf = profileFields({ gender: m.gender, sessionMinutes: m.sessionMinutes, priorities: m.priorities });
    const notes = h("textarea", { maxlength: "500", value: m.notes ?? "" });

    root.replaceChildren(...[
      h("button", { class: "ghost", text: "← Volver", onclick: boot }),
      h("div", { class: "card" }, h("div", { class: "row spread wrap" }, h("h2", { style: "margin:0", text: m.nombre }), h("span", { class: "pill", text: `Sede ${m.sede}` })),
        h("div", { class: "row wrap", style: "margin-top:10px" },
          h("button", { class: "small", text: "Ver link", onclick: () => showLink(m.nombre, d.link) }),
          h("button", { class: "small", text: "Generar link nuevo", onclick: async () => { if (!confirm("El link anterior dejará de funcionar. ¿Seguro?")) return; const r = await attempt(() => api("POST", `/api/admin/members/${id}/rotate-token`)); if (r) showLink(m.nombre, r.link); } }),
          h("button", { class: "small " + (m.active ? "danger" : ""), text: m.active ? "Desactivar" : "Reactivar", onclick: async () => { await attempt(() => api("PATCH", `/api/admin/members/${id}`, { active: !m.active })); viewMember(root, id); } }))),
      h("div", { class: "card stack" }, h("h3", { text: "Preferencias y rutina" }), h("div", { class: "row wrap" }, level, dsel, focus), pf.wrap,
        h("p", { class: "muted small", text: "Rehacer genera un ciclo nuevo desde cero con estas preferencias (el actual queda cerrado sin evaluación)." }),
        h("button", { text: d.view.routine ? "Rehacer rutina" : "Armar rutina", onclick: async () => { if (d.view.routine && !confirm("Se reemplaza la rutina actual por una nueva. ¿Seguro?")) return; const r = await attempt(() => api("POST", `/api/admin/members/${id}/regenerate`, { level: Number(level.value), daysPerWeek: Number(dsel.value), focus: focus.value, ...pf.body(focus.value) })); if (r) { toast("Rutina generada"); viewMember(root, id); } } }),
        h("label", { text: "Notas del socio (lesiones, limitaciones)" }), notes,
        h("button", { class: "small", text: "Guardar notas", onclick: async () => { if (await attempt(() => api("PATCH", `/api/admin/members/${id}`, { notes: notes.value }))) toast("Notas guardadas"); } })),
      d.view.progress ? h("div", { class: "card" }, h("b", { text: `Este mes: ${d.view.progress.cycle.done} de ${d.view.progress.cycle.planned} días completos` }), h("span", { class: "muted", text: ` · semana: ${d.view.progress.week.done}/${d.view.progress.week.planned}` })) : null,
      ...days,
      d.history.length ? h("div", { class: "card" }, h("h3", { text: "Ciclos anteriores" }), ...d.history.map((c) => h("div", { class: "ex-admin" }, h("div", { class: "grow" }, h("b", { text: `Mes ${c.cycle_number}: ${c.adherence_pct}% (${c.completed_sessions}/${c.planned_sessions})` }), h("span", { class: "pill " + ({ PROGRESS: "ok", MAINTAIN: "warn", SIMPLIFY: "bad" })[c.decision], text: ({ PROGRESS: "Progresó", MAINTAIN: "Se mantuvo", SIMPLIFY: "Se simplificó" })[c.decision] }), h("div", { class: "muted small", text: c.changes.join(" ") }))))) : null
    ].filter(Boolean));
  }

  // ---------- Sedes ----------

  function viewSedes(root) {
    root.append(h("p", { class: "muted", text: "Lo que desmarques acá no se le asigna a nadie de esa sede, ni en rutinas nuevas ni en los reemplazos. Al desmarcar equipamiento o excluir un ejercicio, las rutinas activas se corrigen solas." }));
    for (const s of sedes) {
      const box = (e) => h("label", {}, h("input", { type: "checkbox", checked: e.available, onchange: async (ev) => {
        const cb = ev.target;
        const r = await attempt(() => api("PUT", `/api/admin/sedes/${s.id}/equipment`, { equipment: e.key, available: cb.checked }));
        if (!r) { cb.checked = !cb.checked; return; }
        toast(cb.checked ? `${s.nombre}: ${e.label} disponible` : `${s.nombre}: sin ${e.label}. Rutinas corregidas: ${r.replaced}`);
        e.available = cb.checked;
      } }), " ", e.label);
      // Un bloque por tipo (máquinas / elementos) y, adentro, un sub-bloque por grupo (Piernas, Espalda, etc.)
      const group = (title, kind) => {
        const items = s.equipment.filter((e) => e.kind === kind);
        const groups = [...new Set(items.map((e) => e.group))];
        return [h("h3", { text: title }), ...groups.map((g) => h("div", { class: "stack" }, h("div", { class: "muted small group-title", text: g }), h("div", { class: "toggle-list" }, ...items.filter((e) => e.group === g).map(box))))];
      };
      root.append(h("div", { class: "card stack" }, h("h2", { style: "margin:0", text: `Sede ${s.nombre}` }),
        ...group("Máquinas (marcá las que hay)", "machine"), ...group("Elementos (marcá los que hay)", "implement"),
        h("p", { class: "muted small", text: "Los ejercicios de peso corporal sin elementos no necesitan nada: están siempre disponibles." }),
        h("h3", { text: "Ejercicios excluidos" }),
        s.exclusions.length ? h("div", {}, ...s.exclusions.map((x) => h("div", { class: "row spread", style: "padding:6px 0;border-top:1px solid var(--line)" }, h("div", { class: "grow" }, h("b", { text: cap(x.name) }), x.reason ? h("span", { class: "muted small", text: ` · ${x.reason}` }) : null), h("button", { class: "small ghost", text: "Quitar", onclick: async () => { await attempt(() => api("DELETE", `/api/admin/sedes/${s.id}/exclusions/${x.id}`)); sedes = await api("GET", "/api/admin/sedes"); boot(); } })))) : h("p", { class: "muted", text: "Ninguno." }),
        h("p", { class: "muted small", text: "Para excluir un ejercicio puntual: buscalo en el Catálogo, o decile al Agente IA “en Olivos no tenemos la máquina X”." })));
    }
  }

  // ---------- Catálogo ----------

  async function viewCatalog(root) {
    const facets = await attempt(() => api("GET", "/api/admin/exercise-facets"));
    if (!facets) return;
    const q = h("input", { type: "search", placeholder: "Buscar ejercicio (en inglés)…" });
    const target = select([{ v: "", t: "Todos los músculos" }, ...facets.targets.map((t) => ({ v: t, t: facets.targetLabels?.[t] ?? t }))], "");
    const role = select([{ v: "", t: "Todos los roles" }, ...facets.roles.map((t) => ({ v: t, t }))], "");
    const needs = select([{ v: "", t: "Cualquier equipamiento" }, { v: "none", t: "No necesitan nada" }, { v: "machine", t: "Necesitan máquina" }, { v: "implement", t: "Necesitan elemento" }], "");
    const enabled = select([{ v: "", t: "Habilitados y no" }, { v: "1", t: "Solo habilitados" }, { v: "0", t: "Solo deshabilitados" }], "");
    const out = h("div");
    let page = 1;
    const load = async () => {
      out.replaceChildren(skeletonRows(6));
      const qs = new URLSearchParams({ q: q.value, target: target.value, role: role.value, needs: needs.value, enabled: enabled.value, page });
      const r = await attempt(() => api("GET", `/api/admin/exercises?${qs}`));
      if (!r) return;
      const patch = (id, body, okMsg) => attempt(async () => { await api("PATCH", `/api/admin/exercises/${id}`, body); toast(okMsg); });

      // Botón para excluir un ejercicio en una sede
      const excludeButton = (e, s) =>
        h("button", {
          class: "small ghost",
          text: `No hay en ${s.nombre}`,
          onclick: async () => {
            const reason = prompt(`Motivo para excluir en ${s.nombre} (opcional):`, "No tenemos este equipo");
            if (reason === null) return;
            const x = await attempt(() => api("POST", `/api/admin/sedes/${s.id}/exclusions`, { exerciseId: e.id, reason }));
            if (x) {
              toast(`Excluido en ${s.nombre}. Rutinas corregidas: ${x.replaced}`);
              sedes = await api("GET", "/api/admin/sedes");
            }
          },
        });

      // Una tarjeta por ejercicio del catálogo
      const itemCard = (e) => {
        const roleSel = select(facets.roles.map((x) => ({ v: x, t: x })), e.role, {
          style: "width:auto", "aria-label": "Rol", onchange: (ev) => patch(e.id, { role: ev.target.value }, "Rol guardado"),
        });
        const levelSel = select([1, 2, 3].map((n) => ({ v: n, t: `Nivel ${n}` })), e.level, {
          style: "width:auto", "aria-label": "Nivel", onchange: (ev) => patch(e.id, { level: Number(ev.target.value) }, "Nivel guardado"),
        });
        const enabledBox = h("label", { class: "row", style: "margin:0;font-weight:500" },
          h("input", { type: "checkbox", checked: e.enabled, onchange: (ev) => patch(e.id, { enabled: ev.target.checked }, ev.target.checked ? "Habilitado" : "Deshabilitado: ya no se asigna") }),
          " Habilitado");
        const info = h("div", {},
          h("b", { text: cap(e.name) }),
          h("div", { class: "muted small", text: `${e.targetLabel ?? cap(e.target)} · ${e.equipmentLabel} · ${e.pattern}${e.classified_by === "admin" ? " · corregido por vos" : ""}` }));
        // Si no necesita equipamiento no tiene sentido marcar "no hay en la sede"
        const sedeButtons = e.needs === "none"
          ? [h("span", { class: "pill ok", text: "No necesita equipamiento" })]
          : sedes.map((s) => excludeButton(e, s));
        const controls = h("div", { class: "row wrap" }, roleSel, levelSel, enabledBox, ...sedeButtons);
        return h("div", { class: "card row", style: "align-items:flex-start" },
          h("img", { class: "ex-thumb", src: e.imageUrl, alt: "", loading: "lazy", style: "width:64px;height:64px" }),
          h("div", { class: "grow stack" }, info, controls));
      };

      const pager = h("div", { class: "row spread" },
        h("button", { class: "ghost", disabled: page <= 1, text: "← Anterior", onclick: () => { page--; load(); } }),
        h("button", { class: "ghost", disabled: page * r.pageSize >= r.total, text: "Siguiente →", onclick: () => { page++; load(); } }));

      out.replaceChildren(
        h("p", { class: "muted small", text: `${r.total} ejercicios · página ${r.page} de ${Math.max(1, Math.ceil(r.total / r.pageSize))}` }),
        ...r.items.map(itemCard),
        pager);
    };
    let t;
    const reset = () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 250); };
    [q, target, role, needs, enabled].forEach((el) => el.addEventListener(el === q ? "input" : "change", reset));
    root.append(h("p", { class: "muted", text: "Acá hacés tu limpieza: deshabilitá lo que no quieras ofrecer y corregí rol y nivel. Lo que corrijas no se pisa al reimportar el catálogo." }), h("div", { class: "stack" }, q, h("div", { class: "row wrap" }, target, role, needs, enabled)), out);
    load();
  }

  // ---------- Agente ----------

  function viewAgent(root, ov) {
    if (!ov.aiEnabled) { root.append(h("div", { class: "card" }, h("p", { text: "El agente está apagado: falta configurar OPENROUTER_API_KEY en el servidor." }))); return; }
    const log = h("div", { class: "chat", "aria-live": "polite" });
    const input = h("textarea", { placeholder: "Ej: A Karen sacale la prensa de piernas, en Olivos no tenemos esa máquina", maxlength: "1000" });
    let pending = false;
    const draw = () => {
      log.replaceChildren(...chat.map((m) => h("div", { class: "msg " + (m.role === "user" ? "user" : "bot") }, m.content, ...(m.actions ?? []).map((a) => h("div", { class: "action" + (a.ok ? "" : " bad"), text: `${a.ok ? "Hecho" : "No se pudo"}: ${a.tool}${a.ok ? "" : `. ${a.result?.error ?? "Falló"}`}` })))),
        ...(pending ? [h("div", { class: "msg bot", role: "status", "aria-label": "El agente está trabajando" }, h("span", { class: "typing" }, h("i"), h("i"), h("i")))] : []));
      log.scrollTop = log.scrollHeight;
    };
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      chat.push({ role: "user", content: text });
      input.value = "";
      pending = true;
      draw();
      setLoading(btn, true);
      const r = await attempt(() => api("POST", "/api/admin/agent", { messages: chat.map(({ role, content }) => ({ role, content })) }));
      pending = false;
      setLoading(btn, false);
      chat.push({ role: "assistant", content: r?.reply ?? "No pude completar el pedido.", actions: r?.actions });
      draw();
      if (r?.actions?.length) sedes = await api("GET", "/api/admin/sedes");
    };
    const btn = h("button", { class: "primary", text: "Enviar", onclick: send });
    root.append(h("div", { class: "card stack" },
      h("p", { class: "muted", text: "Pedile cambios en lenguaje normal. Cada regla de sede que el agente guarda queda en la base y se respeta siempre; la ves en la solapa Sedes." }),
      log, input, h("div", { class: "row" }, h("button", { class: "ghost", text: "Nueva conversación", onclick: () => { chat = []; draw(); } }), btn)));
    draw();
  }

  // ---------- Revisar ----------

  async function viewReview(root) {
    const [pend, all] = await Promise.all([attempt(() => api("GET", "/api/admin/changes?review=1")), attempt(() => api("GET", "/api/admin/changes"))]);
    if (!pend) return;
    const describe = (c) => {
      const p = c.payload ?? {};
      if (c.action === "replace_exercise") return `${cap(p.fromName)} → ${cap(p.toName)}${p.reason ? ` · “${p.reason}”` : ""}`;
      if (c.action === "onboarding_notes") return `Notas al registrarse: “${p.notes}”`;
      if (c.action === "monthly_progression") return `Mes ${p.cycle}: ${p.adherencePct}% → ${p.decision}`;
      if (c.action === "exclude_exercise") return `Excluido: ${(p.names ?? []).join(", ") || p.exerciseId}${p.reason ? ` (${p.reason})` : ""}`;
      if (c.action === "set_equipment") return `${(sedes[0]?.equipment.find((q) => q.key === p.equipment)?.label) ?? p.equipment}: ${p.available ? "disponible" : "no disponible"}`;
      return c.action;
    };
    const row = (c, withBtn) => h("div", { class: "ex-admin" }, h("div", { class: "grow" }, h("b", { text: `${c.member ?? c.sede ?? "—"}` }), h("span", { class: "muted small", text: ` · ${c.actor} · ${fmtDate(c.created_at)}` }), h("div", { text: describe(c) })),
      withBtn ? h("button", { class: "small", text: "Revisado", onclick: async () => { await attempt(() => api("POST", `/api/admin/changes/${c.id}/review`)); boot(); } }) : null);
    root.append(h("h2", { text: "A revisar" }), h("p", { class: "muted small", text: "Cambios donde el socio mencionó dolor o lesión, y notas de registro." }),
      h("div", { class: "card" }, pend.length ? pend.map((c) => row(c, true)) : h("p", { class: "muted", text: "Nada pendiente." })),
      h("h2", { text: "Últimos movimientos" }), h("div", { class: "card" }, (all ?? []).length ? all.slice(0, 40).map((c) => row(c, false)) : h("p", { class: "muted", text: "Todavía no hay movimientos." })));
  }

  // ---------- Arranque ----------
  if (key) boot(); else renderLogin();
})();
