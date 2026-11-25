// Pantalla del socio. Todo el contenido dinámico se arma con textContent (nunca innerHTML)
// para que ningún texto de la base pueda inyectar HTML.
(() => {
  "use strict";

  const LEVELS = [
    { v: 1, t: "Principiante", d: "Menos de 6 meses entrenando" },
    { v: 2, t: "Intermedio", d: "Entreno hace 6 meses a 2 años" },
    { v: 3, t: "Avanzado", d: "Más de 2 años con constancia" },
  ];
  const FOCUS = [
    { v: "general", t: "General", d: "Estar en forma y con energía" },
    { v: "hipertrofia", t: "Ganar músculo", d: "Más series por músculo y descansos de 1 a 2 minutos" },
    { v: "fuerza", t: "Fuerza", d: "Pocas repeticiones, pesos altos y descansos largos" },
    { v: "bajar_grasa", t: "Bajar grasa", d: "Más series, descansos cortos y cardio al final" },
  ];
  const GENDERS = [
    { v: "mujer", t: "Mujer" },
    { v: "hombre", t: "Hombre" },
    { v: "no_decir", t: "Prefiero no decirlo" },
  ];
  const MINUTES = [
    { v: 45, t: "45 min", d: "Sesión corta" },
    { v: 60, t: "60 min", d: "Lo más común" },
    { v: 75, t: "75 min", d: "Con más volumen" },
  ];
  const ZONES = [
    { v: "pecho", t: "Pecho" },
    { v: "espalda", t: "Espalda" },
    { v: "hombros", t: "Hombros" },
    { v: "brazos", t: "Brazos" },
    { v: "piernas", t: "Piernas" },
    { v: "gluteos", t: "Glúteos" },
    { v: "abdomen", t: "Abdomen" },
  ];
  const MAX_PRIORITIES = 2;
  const DAYS = [2, 3, 4, 5, 6];
  const BUILDING_MESSAGES = ["Mirando tu nivel", "Eligiendo ejercicios de tu sede", "Armando tus días", "Ajustando series y descansos"];

  const $app = document.getElementById("app");
  let token = null;
  let state = null; // última vista que devolvió el servidor
  let lastWeekDone = null; // para animar el disco nuevo cuando completás un día
  let lastToggled = null; // para animar el tilde que acabás de tocar

  // ---------- Utilidades ----------

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs = {}, ...kids) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
    el.append(...kids.flat().filter(Boolean));
    return el;
  }

  function toast(msg, isErr = false) {
    document.querySelector(".toast")?.remove();
    const t = h("div", { class: "toast" + (isErr ? " err" : ""), role: "status" }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), isErr ? 6000 : 3500);
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", "x-member-token": token || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || "Algo salió mal");
      err.status = res.status;
      err.code = data?.error?.code;
      throw err;
    }
    return data;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const setLoading = (btn, on) => { btn.classList.toggle("is-loading", on); btn.disabled = on; };
  // Datos sueltos en una línea (sin puntos medios): cada dato es su propio span
  const metaRow = (...parts) => h("div", { class: "ex-meta" }, ...parts.filter(Boolean).map((t) => h("span", { text: t })));

  // ---------- La barra cargada ----------
  // Un disco por día completo de la semana (los que faltan, en línea punteada).
  // Los colores son los de los discos olímpicos: rojo, azul, amarillo, verde, acero, negro.

  const PLATE_COLORS = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--p5)", "var(--p6)"];
  const PLATE_HEIGHT = [112, 104, 94, 82, 68, 56];
  const PLATE_W = 14;
  const PLATE_STEP = 16;
  const FIRST_X = 248;

  function barbell({ planned, done, newIndex = -1, loading = false }) {
    const slots = Math.min(6, Math.max(2, planned));
    const parts = [
      svg("rect", { class: "sleeve", x: 6, y: 66, width: 348, height: 10, rx: 5 }),
      svg("rect", { class: "steel", x: 132, y: 64, width: 96, height: 14, rx: 2 }),
      svg("rect", { class: "steel", x: 236, y: 56, width: 6, height: 30, rx: 2 }),
      svg("rect", { class: "steel", x: 118, y: 56, width: 6, height: 30, rx: 2 }),
    ];
    for (let i = 0; i < slots; i++) {
      const hgt = PLATE_HEIGHT[i];
      const y = 71 - hgt / 2;
      const xr = FIRST_X + i * PLATE_STEP;
      const xl = 360 - xr - PLATE_W;
      const filled = loading || i < done;
      for (const side of ["right", "left"]) {
        const x = side === "right" ? xr : xl;
        const cls = filled
          ? `plate ${side === "left" ? "left" : ""} ${!loading && i === newIndex ? "new" : ""}`
          : "ghost";
        const el = svg("rect", { class: cls.trim(), x, y, width: PLATE_W, height: hgt, rx: 3, fill: filled ? PLATE_COLORS[i] : null });
        if (loading) { el.style.setProperty("--i", String(i)); el.style.setProperty("--from", side === "right" ? "70px" : "-70px"); }
        parts.push(el);
      }
    }
    return svg("svg", { class: "bar-art", viewBox: "0 0 360 142", role: "img", "aria-label": loading ? "Cargando" : `${done} de ${planned} días completos esta semana` }, parts);
  }

  // ---------- Pantallas ----------

  function renderMessage(title, text) {
    $app.removeAttribute("aria-busy");
    $app.replaceChildren(h("div", { class: "card" }, h("h1", { text: title }), h("p", { class: "muted", style: "margin-top:12px", text })));
  }

  // Pantalla de espera: la barra se va cargando mientras el servidor arma la rutina
  function buildingScreen() {
    const line = h("div", { class: "msg-line", role: "status", text: BUILDING_MESSAGES[0] });
    const node = h("div", { class: "building" }, barbell({ planned: 6, done: 6, loading: true }), line, h("p", { class: "muted", text: "Esto tarda unos segundos." }));
    let i = 0;
    const timer = setInterval(() => {
      if (!document.contains(node)) return clearInterval(timer);
      i = (i + 1) % BUILDING_MESSAGES.length;
      line.textContent = BUILDING_MESSAGES[i];
    }, 1100);
    return node;
  }

  function choiceGroup(name, options, current, onPick, cols = false) {
    const wrap = h("div", { class: "choices" + (cols ? " cols" : "") + (cols === "words" ? " words" : ""), role: "group", "aria-label": name });
    const buttons = options.map((o) => {
      const b = h("button", { type: "button", class: "choice", "aria-pressed": String(o.v === current.value) },
        h("b", { text: String(o.t ?? o.v) }), o.d ? h("span", { class: "muted small", text: o.d }) : null);
      b.addEventListener("click", () => {
        current.value = o.v;
        buttons.forEach((x, i) => x.setAttribute("aria-pressed", String(options[i].v === o.v)));
        onPick?.();
      });
      return b;
    });
    wrap.append(...buttons);
    return wrap;
  }

  // Elección múltiple con tope (para las zonas a priorizar). "Parejo" limpia la selección.
  function zonePicker(selected, onChange) {
    const wrap = h("div", { class: "choices cols words", role: "group", "aria-label": "Zonas a priorizar" });
    const note = h("p", { class: "muted small", style: "margin-top:8px" });
    const buttons = [];
    const paint = () => {
      buttons.forEach(({ b, v }) => b.setAttribute("aria-pressed", String(v === "parejo" ? selected.length === 0 : selected.includes(v))));
      note.textContent = selected.length === 0
        ? "Sin prioridad: el volumen se reparte parejo entre todos los músculos."
        : `Elegiste ${selected.length} de ${MAX_PRIORITIES}. Esas zonas entran primero y con más series.`;
      onChange?.();
    };
    for (const z of [...ZONES, { v: "parejo", t: "Parejo" }]) {
      const b = h("button", { type: "button", class: "choice", "aria-pressed": "false" }, h("b", { text: z.t }));
      b.addEventListener("click", () => {
        if (z.v === "parejo") selected.length = 0;
        else if (selected.includes(z.v)) selected.splice(selected.indexOf(z.v), 1);
        else if (selected.length < MAX_PRIORITIES) selected.push(z.v);
        else { selected.shift(); selected.push(z.v); } // al elegir una tercera, sale la más vieja
        paint();
      });
      buttons.push({ b, v: z.v });
      wrap.append(b);
    }
    paint();
    return h("div", {}, wrap, note);
  }

  function renderOnboarding(view) {
    const sel = { level: { value: null }, days: { value: null }, focus: { value: null }, gender: { value: null }, minutes: { value: 60 } };
    const zones = [];
    const notes = h("textarea", { id: "notes", maxlength: "500", placeholder: "Ej: operación de rodilla, dolor lumbar… (lo ve tu profe)" });
    const go = h("button", { class: "primary full", disabled: true, type: "button", text: "Armar mi rutina", style: "margin-top:22px" });
    const check = () => { go.disabled = !(sel.level.value && sel.days.value && sel.focus.value && sel.gender.value); };

    // Solo aparece si elige "Ganar músculo": ahí la rutina se vuelve más específica
    const zoneBlock = h("div", { class: "zone-block", hidden: true },
      h("div", { class: "q", text: "¿Qué querés priorizar?" }),
      h("p", { class: "muted small", style: "margin-bottom:10px", text: "Elegí hasta 2 zonas. Van primero en cada sesión, con más series y 2 veces por semana como mínimo." }),
      zonePicker(zones));
    const onFocus = () => { zoneBlock.hidden = sel.focus.value !== "hipertrofia"; check(); };

    const form = [
      h("h1", { text: `Hola, ${view.member.nombre}` }),
      h("p", { class: "muted", style: "margin-top:10px", text: `Sede ${view.member.sede}. Contanos cómo entrenás y te armamos la rutina.` }),
      h("div", { class: "q", text: "¿Cuál es tu nivel?" }), choiceGroup("Nivel", LEVELS, sel.level, check),
      h("div", { class: "q", text: "¿Cuántos días por semana vas a venir?" }), choiceGroup("Días por semana", DAYS.map((d) => ({ v: d, t: d, d: null })), sel.days, check, true),
      h("div", { class: "q", text: "¿Cuánto dura tu sesión?" }), choiceGroup("Duración de la sesión", MINUTES, sel.minutes, check, true),
      h("div", { class: "q", text: "¿Cuál es tu objetivo principal?" }), choiceGroup("Objetivo", FOCUS, sel.focus, onFocus),
      zoneBlock,
      h("div", { class: "q", text: "¿Cuál es tu género?" }),
      h("p", { class: "muted small", style: "margin-bottom:10px", text: "Solo lo usamos para sugerir qué zonas reforzar cuando no elegís ninguna. Podés cambiarlas igual." }),
      choiceGroup("Género", GENDERS, sel.gender, check, "words"),
      h("label", { for: "notes", text: "¿Alguna lesión o limitación? (opcional)" }), notes,
      go,
    ];

    go.addEventListener("click", async () => {
      const t0 = Date.now();
      $app.replaceChildren(buildingScreen());
      try {
        const body = { level: sel.level.value, daysPerWeek: sel.days.value, focus: sel.focus.value, notes: notes.value, sessionMinutes: sel.minutes.value };
        if (sel.gender.value !== "no_decir") body.gender = sel.gender.value;
        if (sel.focus.value === "hipertrofia") body.priorities = [...zones]; // [] = parejo
        state = await api("POST", "/api/me/onboarding", body);
        await sleep(Math.max(0, 1600 - (Date.now() - t0))); // que se llegue a ver cómo se carga la barra
        render();
      } catch (e) {
        toast(e.message, true);
        $app.replaceChildren(...form);
      }
    });

    $app.removeAttribute("aria-busy");
    $app.replaceChildren(...form);
  }

  function renderRoutine(view) {
    const { routine, progress } = view;
    const openIdx = Math.max(0, routine.days.findIndex((d) => !d.completedToday));
    const { done, planned } = progress.week;
    const newIndex = lastWeekDone !== null && done > lastWeekDone ? done - 1 : -1;
    lastWeekDone = done;

    const monthSegments = h("div", { class: "segments", role: "img", "aria-label": `${progress.cycle.done} de ${progress.cycle.planned} días completos este mes` },
      ...Array.from({ length: Math.min(progress.cycle.planned, 31) }, (_, i) => h("i", { class: i < progress.cycle.done ? "on" : "" })));

    const deloadBanner = routine.deload ? h("div", { class: "notice", role: "note" }, h("b", { text: "Esta semana es de descarga" }), h("span", { class: "muted small", text: routine.deloadNote })) : null;

    const header = h("section", { class: "week" },
      h("h1", { text: `Hola, ${view.member.nombre}` }),
      metaRow(`Sede ${view.member.sede}`, `Mes ${routine.cycleNumber}`, `hasta el ${fmtDate(routine.endsOn)}`),
      h("div", { class: "week-top", style: "margin-top:18px" },
        h("div", { class: "week-count" }, String(done), h("small", { text: `de ${planned}` })),
        h("p", { class: "week-label", text: done >= planned ? "Semana completa" : "días esta semana" })),
      barbell({ planned, done, newIndex }),
      h("div", { class: "month" }, h("div", { class: "row spread small" }, h("span", { text: "Este mes" }), h("b", { text: `${progress.cycle.done} de ${progress.cycle.planned} días` })), monthSegments),
      h("p", { class: "muted small", style: "margin-top:14px", text: "Tildá cada ejercicio al terminarlo y cerrá el día con “Día completo”. Con eso tu rutina del mes que viene se ajusta a cómo venís." })
    );

    const days = routine.days.map((d, i) => {
      const doneCount = d.exercises.filter((e) => e.done).length;
      const det = h("details", { class: "day" + (d.completedToday ? " is-done" : ""), open: i === openIdx });
      det.append(
        h("summary", {},
          h("span", { class: "num", "aria-hidden": "true", text: String(i + 1) }),
          h("div", { class: "grow" }, h("h3", { text: d.label.replace(/^D[ií]a\s*\d+\s*[—–-]\s*/i, "") }), h("span", { class: "muted small", text: `${d.exercises.length} ejercicios${d.estMinutes ? `, unos ${d.estMinutes} min` : ""}, ${doneCount} tildados` })),
          d.completedToday ? h("span", { class: "pill ok", text: "Completo hoy" }) : null,
          h("span", { class: "chev", "aria-hidden": "true" })
        ),
        h("div", { class: "body" },
          ...d.exercises.map((e) => exerciseRow(d, e)),
          h("div", { style: "margin-top:14px" },
            d.completedToday
              ? h("button", { class: "ghost full", type: "button", text: "Desmarcar día completo", onclick: (ev) => completeDay(d, false, ev.currentTarget) })
              : h("button", { class: "primary full", type: "button", text: "Día completo", onclick: (ev) => completeDay(d, true, ev.currentTarget) })
          ))
      );
      return det;
    });

    $app.removeAttribute("aria-busy");
    $app.replaceChildren(header, deloadBanner, ...days, limitationsCard(view), h("footer", { class: "attr", text: view.attribution }));
  }

  // "¿Te duele algo?": el socio lo cuenta con sus palabras y la rutina se ajusta sola
  function limitationsCard(view) {
    const current = view.member.limitations ?? [];
    const input = h("textarea", { id: "limit-text", maxlength: "500", placeholder: "Ej: me molesta la rodilla derecha al bajar escaleras. O: ya no me duele el hombro." });
    const btn = h("button", { class: "ghost full", type: "button", text: "Avisar a mi profe y ajustar la rutina", style: "margin-top:10px" });
    btn.addEventListener("click", async () => {
      if (!input.value.trim()) return toast("Contanos qué te molesta", true);
      setLoading(btn, true);
      try {
        const r = await api("POST", "/api/me/limitations", { text: input.value });
        state = r.view;
        toast(r.swapped.length ? `${r.reply} Cambiamos ${r.swapped.length} ejercicio${r.swapped.length === 1 ? "" : "s"}.` : r.reply);
        render();
      } catch (e) { toast(e.message, true); setLoading(btn, false); }
    });
    return h("section", { class: "card", style: "margin-top:16px" },
      h("h3", { text: "¿Te duele algo?" }),
      h("p", { class: "muted small", style: "margin:6px 0 10px", text: "Contalo con tus palabras. Sacamos de tu rutina los ejercicios que cargan esa zona. No reemplaza a un médico." }),
      current.length ? h("div", { class: "chips", style: "margin-bottom:10px" }, ...current.map((a) => h("span", { class: "pill warn", text: a.label }))) : null,
      input, btn);
  }

  function exerciseRow(day, e) {
    const ex = e.exercise;
    const img = h("img", { class: "ex-thumb", src: ex.imageUrl, alt: `Ejercicio: ${ex.name}`, loading: "lazy", width: "72", height: "72" });
    img.addEventListener("click", () => openHow(ex));
    const box = h("input", { class: "check" + (lastToggled === e.id ? " pop" : ""), type: "checkbox", checked: e.done, "aria-label": `Marcar ${ex.name} como hecho`, onchange: (ev) => toggle(day, e, ev.target) });
    return h("div", { class: "ex" + (e.done ? " done" : "") },
      img,
      h("div", { class: "grow" },
        h("div", { class: "ex-name", text: ex.name }),
        metaRow(ex.targetLabel || cap(ex.target), ex.equipmentLabel || ex.equipment, e.replaced ? "Cambiado" : null),
        h("div", { class: "ex-dose" }, h("b", { text: `${e.sets} × ${e.reps}` }), e.restSec ? h("span", { text: `descanso ${e.restSec} s` }) : null),
        e.note ? h("div", { class: "ex-note", text: e.note }) : null,
        h("div", { class: "ex-actions" },
          h("button", { class: "small", type: "button", text: "Cómo se hace", onclick: () => openHow(ex) }),
          h("button", { class: "small ghost", type: "button", text: "Cambiar", onclick: () => openSwap(e) })
        )
      ),
      box
    );
  }

  // ---------- Acciones ----------

  async function toggle(day, e, box) {
    box.disabled = true;
    try {
      const r = await api("POST", `/api/me/days/${day.id}/exercises/${e.id}/toggle`);
      e.done = r.done;
      lastToggled = r.done ? e.id : null;
      keepOpenAndRender();
    } catch (err) {
      box.checked = e.done;
      toast(err.message, true);
    } finally {
      box.disabled = false;
    }
  }

  async function completeDay(day, complete, btn) {
    setLoading(btn, true);
    try {
      state = await api(complete ? "POST" : "DELETE", `/api/me/days/${day.id}/complete`);
      keepOpenAndRender();
      if (complete) toast("¡Día completo! Buen laburo.");
    } catch (err) {
      setLoading(btn, false);
      toast(err.message, true);
    }
  }

  // Re-dibuja conservando qué días estaban abiertos y el scroll
  function keepOpenAndRender() {
    const open = [...document.querySelectorAll("details")].map((d) => d.open);
    const y = window.scrollY;
    render();
    document.querySelectorAll("details").forEach((d, i) => { d.open = open[i] ?? d.open; });
    window.scrollTo(0, y);
    lastToggled = null;
  }

  const howDialog = document.getElementById("howDialog");
  function openHow(ex) {
    document.getElementById("howTitle").textContent = cap(ex.name);
    const gif = document.getElementById("howGif");
    const sk = document.getElementById("howSk");
    // El GIF pesa: mientras llega se ve un esqueleto
    gif.classList.add("hidden");
    sk.classList.remove("hidden");
    gif.onload = () => { sk.classList.add("hidden"); gif.classList.remove("hidden"); };
    gif.onerror = () => { sk.classList.add("hidden"); };
    gif.src = ex.gifUrl;
    gif.alt = `Demostración: ${ex.name}`;
    const sec = ex.secondary?.length ? `. También trabaja: ${ex.secondary.join(", ")}` : "";
    document.getElementById("howMuscles").textContent = `Músculo principal: ${ex.targetLabel || ex.target}${sec}`;
    document.getElementById("howSteps").replaceChildren(...ex.steps.map((s) => h("li", { text: s })));
    howDialog.showModal();
  }

  const swapDialog = document.getElementById("swapDialog");
  let swapTarget = null;
  function openSwap(e) {
    swapTarget = e;
    document.getElementById("swapCurrent").textContent = `Ejercicio actual: ${cap(e.exercise.name)}`;
    document.getElementById("swapReason").value = "";
    swapDialog.showModal();
  }
  document.getElementById("swapGo").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    setLoading(btn, true);
    try {
      const r = await api("POST", `/api/me/exercises/${swapTarget.id}/replace`, { reason: document.getElementById("swapReason").value });
      state = r.view;
      swapDialog.close();
      keepOpenAndRender();
      toast(`Ahora: ${cap(r.result.to.name)}. ${r.result.explanation}`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      setLoading(btn, false);
    }
  });
  document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); }));

  // ---------- Arranque ----------

  function render() {
    if (!state) return;
    if (!state.member.onboarded) return renderOnboarding(state);
    if (!state.routine) return renderMessage("Estamos armando tu rutina", "Todavía no tenés una rutina activa. Consultá con tu profe.");
    renderRoutine(state);
  }

  async function init() {
    // El link personal es /s/<token>: lo guardamos en el dispositivo y limpiamos la URL
    const m = /^\/s\/([\w-]{20,})\/?$/.exec(location.pathname);
    try {
      if (m) {
        localStorage.setItem("memberToken", m[1]);
        history.replaceState(null, "", "/");
      }
      token = localStorage.getItem("memberToken");
    } catch {
      token = m ? m[1] : null; // almacenamiento bloqueado: funciona mientras no cierres la pestaña
    }
    if (!token) return renderMessage("Abrí tu link personal", "Tu profe te pasó un link para entrar a tu rutina. Abrilo desde el mensaje que te enviaron.");
    try {
      state = await api("GET", "/api/me");
      render();
    } catch (err) {
      if (err.status === 401) {
        try { localStorage.removeItem("memberToken"); } catch { /* sin almacenamiento */ }
        return renderMessage("Link no válido", err.message);
      }
      renderMessage("No pudimos cargar tu rutina", err.message);
    }
  }

  // ---------- Instalar como app ----------
  // Android/Chrome avisa con "beforeinstallprompt"; en iPhone hay que hacerlo a mano desde Safari.
  let installEvent = null;
  const dismissed = () => { try { return localStorage.getItem("installDismissed") === "1"; } catch { return false; } };
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function showInstallHint(text, action) {
    if (standalone() || dismissed() || document.querySelector(".install")) return;
    const close = h("button", { class: "ghost small", type: "button", text: "Ahora no", onclick: () => { try { localStorage.setItem("installDismissed", "1"); } catch { /* sin almacenamiento */ } bar.remove(); } });
    const bar = h("div", { class: "install", role: "region", "aria-label": "Instalar la app" }, h("span", { text }), action, close);
    document.body.append(bar);
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    setTimeout(() => showInstallHint("Instalá la app para abrir tu rutina con un toque.", h("button", { class: "primary small", type: "button", text: "Instalar", onclick: async () => { await installEvent.prompt(); installEvent = null; document.querySelector(".install")?.remove(); } })), 4000);
  });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone()) {
    setTimeout(() => showInstallHint("Para tenerla como app: tocá Compartir y después “Agregar a inicio”."), 6000);
  }

  init();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
