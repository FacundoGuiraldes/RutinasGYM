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
    { v: "hipertrofia", t: "Ganar músculo", d: "Más masa muscular" },
    { v: "fuerza", t: "Fuerza", d: "Levantar más peso" },
    { v: "bajar_grasa", t: "Bajar grasa", d: "Más series y cardio al final" },
  ];
  const DAYS = [2, 3, 4, 5, 6];

  const $app = document.getElementById("app");
  let token = null;
  let state = null; // última vista que devolvió el servidor

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

  const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- Pantallas ----------

  function renderMessage(title, text) {
    $app.replaceChildren(h("div", { class: "card" }, h("h1", { text: title }), h("p", { class: "muted", text })));
  }

  function choiceGroup(name, options, current, onPick, cols = false) {
    const wrap = h("div", { class: "choices" + (cols ? " cols" : ""), role: "group", "aria-label": name });
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

  function renderOnboarding(view) {
    const sel = { level: { value: null }, days: { value: null }, focus: { value: null } };
    const notes = h("textarea", { id: "notes", maxlength: "500", placeholder: "Ej: operación de rodilla, dolor lumbar… (lo ve tu profe)" });
    const go = h("button", { class: "primary full", disabled: true, type: "button", text: "Armar mi rutina" });
    const check = () => { go.disabled = !(sel.level.value && sel.days.value && sel.focus.value); };

    go.addEventListener("click", async () => {
      go.disabled = true;
      go.textContent = "Armando tu rutina…";
      try {
        state = await api("POST", "/api/me/onboarding", { level: sel.level.value, daysPerWeek: sel.days.value, focus: sel.focus.value, notes: notes.value });
        render();
      } catch (e) {
        toast(e.message, true);
        go.textContent = "Armar mi rutina";
        check();
      }
    });

    $app.replaceChildren(
      h("h1", { text: `¡Hola, ${view.member.nombre}!` }),
      h("p", { class: "muted", text: `Sede ${view.member.sede}. Contanos cómo entrenás y te armamos la rutina.` }),
      h("div", { class: "card" },
        h("label", { text: "¿Cuál es tu nivel?" }), choiceGroup("Nivel", LEVELS.map((l) => ({ v: l.v, t: l.t, d: l.d })), sel.level, check),
        h("label", { text: "¿Cuántos días por semana vas a venir?" }), choiceGroup("Días", DAYS.map((d) => ({ v: d, t: `${d} días` })), sel.days, check, true),
        h("label", { text: "¿Cuál es tu objetivo principal?" }), choiceGroup("Objetivo", FOCUS, sel.focus, check),
        h("label", { for: "notes", text: "¿Alguna lesión o limitación? (opcional)" }), notes,
      ),
      go
    );
  }

  function progressBar(done, planned) {
    const pct = planned ? Math.min(100, Math.round((done / planned) * 100)) : 0;
    const bar = h("div", { class: "progress", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("div"));
    bar.firstChild.style.width = pct + "%";
    return bar;
  }

  function renderRoutine(view) {
    const { routine, progress } = view;
    const openIdx = Math.max(0, routine.days.findIndex((d) => !d.completedToday));

    const header = h("div", { class: "card" },
      h("h1", { text: `Hola, ${view.member.nombre}` }),
      h("p", { class: "muted", text: `Sede ${view.member.sede} · Mes ${routine.cycleNumber} · hasta el ${fmtDate(routine.endsOn)}` }),
      h("div", { class: "stack", style: "margin-top:10px" },
        h("div", {}, h("div", { class: "row spread small" }, h("span", { text: "Esta semana" }), h("b", { text: `${progress.week.done} de ${progress.week.planned} días` })), progressBar(progress.week.done, progress.week.planned)),
        h("div", {}, h("div", { class: "row spread small" }, h("span", { text: "Este mes" }), h("b", { text: `${progress.cycle.done} de ${progress.cycle.planned} días` })), progressBar(progress.cycle.done, progress.cycle.planned)),
      ),
      h("p", { class: "muted small", style: "margin-top:10px", text: "Tildá cada ejercicio al terminarlo y cerrá el día con “Día completo”. Con eso tu rutina del mes que viene se ajusta a cómo venís." })
    );

    const days = routine.days.map((d, i) => {
      const done = d.exercises.filter((e) => e.done).length;
      const det = h("details", { class: "card", open: i === openIdx });
      det.append(
        h("summary", { class: "day-head row spread" },
          h("div", { class: "grow" }, h("h3", { text: d.label }), h("span", { class: "muted small", text: `${d.exercises.length} ejercicios · ${done} tildados hoy` })),
          d.completedToday ? h("span", { class: "pill ok", text: "Completo hoy" }) : null,
          h("span", { class: "chev", "aria-hidden": "true", text: "›" })
        ),
        ...d.exercises.map((e) => exerciseRow(d, e)),
        h("div", { style: "margin-top:12px" },
          d.completedToday
            ? h("button", { class: "ghost full", type: "button", text: "Desmarcar día completo", onclick: () => completeDay(d, false) })
            : h("button", { class: "primary full", type: "button", text: "Día completo ✓", onclick: () => completeDay(d, true) })
        )
      );
      return det;
    });

    $app.replaceChildren(header, ...days, h("footer", { class: "attr", text: view.attribution }));
  }

  function exerciseRow(day, e) {
    const ex = e.exercise;
    const dose = `${e.sets} × ${e.reps}` + (e.restSec ? ` · descanso ${e.restSec}\u00a0s` : "");
    const img = h("img", { class: "ex-thumb", src: ex.imageUrl, alt: `Ejercicio: ${ex.name}`, loading: "lazy", width: "84", height: "84" });
    img.addEventListener("click", () => openHow(ex));
    return h("div", { class: "ex" + (e.done ? " done" : "") },
      img,
      h("div", { class: "grow" },
        h("div", { class: "ex-name", text: ex.name }),
        h("div", { class: "ex-meta", text: `${cap(ex.target)} · ${ex.equipmentLabel || ex.equipment}${e.replaced ? " · cambiado" : ""}` }),
        h("div", { class: "ex-dose", text: dose }),
        e.note ? h("div", { class: "ex-note", text: e.note }) : null,
        h("div", { class: "ex-actions" },
          h("button", { class: "small", type: "button", text: "Cómo se hace", onclick: () => openHow(ex) }),
          h("button", { class: "small ghost", type: "button", text: "Cambiar", onclick: () => openSwap(e) })
        )
      ),
      h("input", { class: "check", type: "checkbox", checked: e.done, "aria-label": `Marcar ${ex.name} como hecho`, onchange: (ev) => toggle(day, e, ev.target) })
    );
  }

  // ---------- Acciones ----------

  async function toggle(day, e, box) {
    box.disabled = true;
    try {
      const r = await api("POST", `/api/me/days/${day.id}/exercises/${e.id}/toggle`);
      e.done = r.done;
      keepOpenAndRender(day.id);
    } catch (err) {
      box.checked = e.done;
      toast(err.message, true);
    } finally {
      box.disabled = false;
    }
  }

  async function completeDay(day, complete) {
    try {
      state = await api(complete ? "POST" : "DELETE", `/api/me/days/${day.id}/complete`);
      render();
      if (complete) toast("¡Día completo! Buen laburo 💪");
    } catch (err) {
      toast(err.message, true);
    }
  }

  // Re-dibuja conservando qué días estaban abiertos y el scroll
  function keepOpenAndRender(dayId) {
    const open = [...document.querySelectorAll("details")].map((d) => d.open);
    const y = window.scrollY;
    render();
    document.querySelectorAll("details").forEach((d, i) => { d.open = open[i] ?? d.open; });
    window.scrollTo(0, y);
    void dayId;
  }

  const howDialog = document.getElementById("howDialog");
  function openHow(ex) {
    document.getElementById("howTitle").textContent = cap(ex.name);
    const gif = document.getElementById("howGif");
    gif.src = ex.gifUrl;
    gif.alt = `Demostración: ${ex.name}`;
    const sec = ex.secondary?.length ? ` · También trabaja: ${ex.secondary.join(", ")}` : "";
    document.getElementById("howMuscles").textContent = `Músculo principal: ${ex.target}${sec}`;
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
    btn.disabled = true;
    btn.textContent = "Buscando…";
    try {
      const r = await api("POST", `/api/me/exercises/${swapTarget.id}/replace`, { reason: document.getElementById("swapReason").value });
      state = r.view;
      swapDialog.close();
      keepOpenAndRender();
      toast(`Ahora: ${cap(r.result.to.name)}. ${r.result.explanation}`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Buscar reemplazo";
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

  init();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
