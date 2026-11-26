// Explicación de la lógica de una rutina, en palabras simples, para mostrarle al socio cuando se la crean.
// Se arma con los datos reales de ESA rutina (perfil, prioridades, series por músculo, cuidados), no con un texto genérico.

const { weeklyVolume, REGIONS } = require("./volume");
const { areaLabels, interpretByWords } = require("./limitations");
const { SPORTS } = require("./sports");

const LEVEL = { 1: "principiante", 2: "intermedio", 3: "avanzado" };
const FOCUS = { general: "estar en forma", hipertrofia: "ganar músculo", fuerza: "ganar fuerza", bajar_grasa: "bajar grasa" };
const ZONE = { pecho: "pecho", espalda: "espalda", hombros: "hombros", brazos: "brazos", piernas: "piernas", gluteos: "glúteos", abdomen: "abdomen" };
const REGION_ES = { pecho: "Pecho", espalda: "Espalda", hombros: "Hombros", biceps: "Bíceps", triceps: "Tríceps", cuadriceps: "Cuádriceps", isquios: "Femorales", gluteos: "Glúteos", gemelos: "Gemelos" };
const REGION_ZONE = { pecho: "pecho", espalda: "espalda", hombros: "hombros", biceps: "brazos", triceps: "brazos", cuadriceps: "piernas", isquios: "piernas", gemelos: "piernas", gluteos: "gluteos" };

const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

function explainRoutine({ params, days, poolById, member }) {
  const lo = params.sessionMinutes ?? 60;
  const focus = params.focus;
  const priorities = params.priorities ?? [];
  const nDays = days.length;
  const sections = [];

  sections.push({
    title: "Tu punto de partida",
    body: `Nivel ${LEVEL[params.level] ?? "principiante"}, ${nDays} días por semana, objetivo: ${FOCUS[focus] ?? focus}. Cada sesión está pensada para durar entre ${lo} y ${lo + 15} minutos.`,
  });

  sections.push({
    title: "Cómo dividimos la semana",
    body: nDays >= 3
      ? "Armamos la semana para que cada músculo grande se entrene unas 2 veces por semana: en los estudios rinde más que entrenarlo una sola vez, con el mismo volumen total."
      : "Con 2 días por semana, cada sesión trabaja todo el cuerpo: así cada músculo se entrena 2 veces por semana aunque vengas poco.",
    items: days.map((d) => d.label),
  });

  sections.push({
    title: "Qué ejercicios elegimos",
    body: "Primero van los ejercicios básicos (press, remo, jalón, sentadilla, peso muerto rumano): son los más comunes y los que mejor respaldo tienen. Después los aislados, que completan cada músculo. Usamos solo lo que hay en tu sede" + (params.level === 1 ? " y evitamos los de técnica difícil, porque estás empezando." : "."),
  });

  const SCHEME = {
    hipertrofia: "El ejercicio principal del día va más pesado (6 a 8 repeticiones, 2 minutos de descanso), el resto de 8 a 12, y los aislados de 10 a 20. Casi todas las series terminan con 1 a 3 repeticiones en reserva.",
    fuerza: "Los básicos van a pocas repeticiones (4 a 6) con descansos largos, de 2 a 3 minutos, para poder mover más peso. Los aislados, de 8 a 10.",
    bajar_grasa: "Cargas medias (8 a 12 repeticiones) con descansos cortos, de 45 a 60 segundos, y cardio al final. Conservar músculo mientras comés menos es la prioridad.",
    general: "Series de 10 a 15 repeticiones con descansos de 60 a 75 segundos: un trabajo completo y fácil de sostener en el tiempo.",
  };
  sections.push({ title: "Series, repeticiones y descansos", body: SCHEME[focus] ?? SCHEME.general });

  if (focus === "hipertrofia") {
    sections.push({
      title: "Tus prioridades",
      body: priorities.length
        ? `Elegiste reforzar ${list(priorities.map((z) => ZONE[z] ?? z))}. Esas zonas reciben más ejercicios y una serie extra en cada uno, y los demás músculos se mantienen con lo necesario.`
        : "No elegiste prioridades, así que repartimos el trabajo de forma pareja entre todos los músculos.",
    });
  }

  // Series directas e indirectas por región (las indirectas cuentan la mitad)
  const vol = weeklyVolume(days, poolById);
  const prioRegions = new Set(Object.entries(REGION_ZONE).filter(([, z]) => priorities.includes(z)).map(([r]) => r));
  const volume = REGIONS.filter((r) => vol[r] > 0).map((r) => ({ label: REGION_ES[r], sets: Math.round(vol[r]), priority: prioRegions.has(r) }));
  sections.push({
    title: "Cuánto trabaja cada músculo",
    body: "Series por semana. Para crecer, la evidencia apunta a unas 10 a 20 series por músculo; con menos tiempo o menos días alcanza con menos. Los ejercicios que trabajan un músculo de apoyo cuentan la mitad.",
    volume,
  });

  // Otra actividad deportiva
  if (params.otherSport && SPORTS[params.otherSport]) {
    const sp = SPORTS[params.otherSport];
    const n = params.otherSportDays || 1;
    const zona = sp.load === "lower" ? "las piernas" : sp.load === "upper" ? "el tren superior" : "todo el cuerpo";
    sections.push({
      title: "Tu otra actividad",
      body: `Hacés ${sp.label.toLowerCase()} ${n} ${n === 1 ? "vez" : "veces"} por semana. Eso también cansa ${zona}, así que ${n >= 2 ? "bajamos el volumen de esa zona en la rutina" : "ajustamos un poco el volumen de esa zona"} para que llegues a recuperarte entre una actividad y otra.` + (focus === "bajar_grasa" && n >= 2 ? " Además sacamos el cardio final: ya lo estás haciendo con tu deporte." : ""),
    });
  }

  // Cuidados y notas
  const care = [];
  const areas = areaLabels(member?.limitations);
  if (areas.length) care.push(`Cuidamos ${list(areas.map((a) => a.label.toLowerCase()))}: sacamos los ejercicios que cargan esa zona.`);
  const notes = (member?.notes ?? "").trim();
  if (notes && !areas.length && !interpretByWords(notes).length) care.push("Guardamos tus notas para que tu profe las lea. Por ahora no cambian la rutina de forma automática; si es algo que te duele, contáselo en el apartado de molestias.");
  else if (notes && areas.length) care.push("El resto de tus notas queda guardado para que tu profe lo revise.");
  if (!care.length) care.push("No indicaste molestias ni lesiones. Si te aparece alguna, avisala y ajustamos la rutina.");
  sections.push({ title: "Tus cuidados y notas", body: care.join(" ") });

  sections.push({
    title: "Cómo sigue",
    body: "La rutina dura 4 semanas. Tildá cada ejercicio y cerrá el día: si venís cumpliendo, el mes siguiente sube un poco la exigencia. La última semana del ciclo es de descarga (mismo peso, la mitad de las series) para que rindas mejor después." + (params.level === 1 ? " En el nivel principiante la descarga llega un mes por medio." : ""),
  });

  return { title: "Así armamos tu rutina", sections };
}

module.exports = { explainRoutine };
