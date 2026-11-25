// Equipamiento: nombre en español, tipo, grupo y peso en el sorteo de cada clave.
//   kind none      -> no necesita nada del gimnasio (peso corporal): siempre disponible, no se marca por sede
//   kind machine   -> máquina o estación fija
//   kind implement -> elemento suelto (barras, mancuernas, bandas, pelotas, bancos, etc.)
// El dataset trae pocas categorías ("leverage machine", "cable", "body weight"). Acá se deducen,
// del nombre del ejercicio, las máquinas y elementos concretos para que el administrador marque
// qué hay en cada sede. Las claves siguen en inglés; solo cambia lo que ve el administrador.

const M = (es, group, weight = 3) => ({ es, kind: "machine", group, weight });
const I = (es, group, weight) => ({ es, kind: "implement", group, weight });

const EQUIPMENT = {
  // ---- No necesitan nada ----
  "body weight": { es: "Peso corporal (sin equipamiento)", kind: "none" },
  assisted: { es: "Con ayuda / compañero (sin equipamiento)", kind: "none" },

  // ---- Máquinas ----
  "leg press machine": M("Prensa de piernas", "Piernas", 2.5),
  "hack squat machine": M("Hack squat", "Piernas", 2),
  "leg extension machine": M("Sillón de cuádriceps (extensión)", "Piernas"),
  "leg curl machine": M("Máquina de femorales (curl de piernas)", "Piernas"),
  "hip abduction machine": M("Abductores", "Piernas"),
  "hip adduction machine": M("Aductores", "Piernas"),
  "calf machine": M("Máquina de gemelos (pantorrillas)", "Piernas"),
  "smith machine": M("Máquina Smith", "Piernas", 2.5),
  "chest press machine": M("Press de pecho en máquina", "Pecho y hombros"),
  "pec deck machine": M("Pec deck (aperturas)", "Pecho y hombros"),
  "shoulder press machine": M("Press de hombros en máquina", "Pecho y hombros"),
  "lateral raise machine": M("Elevaciones laterales en máquina", "Pecho y hombros"),
  "lat pulldown machine": M("Jalón al pecho en máquina", "Espalda"),
  "row machine": M("Remo en máquina", "Espalda"),
  "t-bar row machine": M("Remo en T (T-bar)", "Espalda"),
  "assisted pull-up machine": M("Dominadas / fondos asistidos", "Espalda"),
  "shrug machine": M("Máquina de trapecios (encogimientos)", "Espalda"),
  "biceps machine": M("Máquina de bíceps / predicador", "Brazos"),
  "triceps machine": M("Máquina de tríceps / fondos", "Brazos"),
  "ab crunch machine": M("Máquina de abdominales", "Core y lumbar"),
  "rotary torso machine": M("Rotación de torso", "Core y lumbar"),
  "back extension machine": M("Banco de lumbares / hiperextensión", "Core y lumbar"),
  cable: M("Polea ajustable (alta y baja)", "Poleas"),
  "cable crossover": M("Cruce de poleas", "Poleas"),
  "lat pulldown station": M("Jalón con polea alta", "Poleas"),
  "leverage machine": M("Otras máquinas de palanca", "Otras"),
  "sled machine": M("Trineo / prensa de trineo", "Otras", 1.5),
  "stationary bike": M("Bicicleta fija", "Cardio", 2),
  "elliptical machine": M("Elíptico", "Cardio", 2),
  treadmill: M("Cinta de correr", "Cardio", 2),
  "stepmill machine": M("Escaladora (stepmill)", "Cardio", 2),
  "skierg machine": M("SkiErg", "Cardio", 1.5),
  "upper body ergometer": M("Ergómetro de brazos", "Cardio", 1),

  // ---- Elementos ----
  barbell: I("Barra", "Barras y pesas", 3),
  "ez barbell": I("Barra Z (EZ)", "Barras y pesas", 2),
  "olympic barbell": I("Barra olímpica", "Barras y pesas", 1),
  "trap bar": I("Barra hexagonal", "Barras y pesas", 1),
  dumbbell: I("Mancuernas", "Barras y pesas", 3),
  kettlebell: I("Pesa rusa (kettlebell)", "Barras y pesas", 1.5),
  weighted: I("Con lastre (disco, chaleco, cinturón)", "Barras y pesas", 1),
  "flat bench": I("Banco plano", "Bancos y estructuras", 3),
  "incline bench": I("Banco inclinado", "Bancos y estructuras", 3),
  "decline bench": I("Banco declinado", "Bancos y estructuras", 3),
  "preacher bench": I("Banco predicador (Scott)", "Bancos y estructuras", 3),
  "squat rack": I("Rack / jaula de sentadillas", "Bancos y estructuras", 3),
  "pull-up bar": I("Barra de dominadas", "Bancos y estructuras", 2.5),
  "dip bars": I("Paralelas (fondos)", "Bancos y estructuras", 2.5),
  "bench or box": I("Banco / cajón / escalón", "Bancos y estructuras", 2.5),
  band: I("Banda elástica", "Bandas y accesorios", 1),
  "resistance band": I("Banda de resistencia", "Bandas y accesorios", 1),
  "stability ball": I("Pelota de estabilidad (fitball)", "Bandas y accesorios", 0.8),
  "medicine ball": I("Pelota medicinal", "Bandas y accesorios", 0.8),
  "bosu ball": I("Bosu", "Bandas y accesorios", 0.5),
  rope: I("Soga / cuerda", "Bandas y accesorios", 1),
  roller: I("Rodillo (foam roller)", "Bandas y accesorios", 1),
  "wheel roller": I("Rueda abdominal", "Bandas y accesorios", 0.7),
  hammer: I("Maza", "Bandas y accesorios", 1),
  tire: I("Neumático", "Bandas y accesorios", 1),
};

const KIND_LABEL = { none: "No necesita equipamiento", machine: "Máquina", implement: "Elemento" };

// Reglas por nombre (en minúsculas). La primera que coincide gana, por eso el orden importa.
const LEVERAGE_RULES = [
  [/cycle cross trainer/, "elliptical machine"],
  [/stationary bike/, "stationary bike"],
  [/treadmill/, "treadmill"],
  [/assisted/, "assisted pull-up machine"],
  [/leg press/, "leg press machine"],
  [/calf|donkey/, "calf machine"],
  [/leg extension/, "leg extension machine"],
  [/leg curl/, "leg curl machine"],
  [/hip abduction/, "hip abduction machine"],
  [/hip adduction/, "hip adduction machine"],
  [/back extension|hyperextension|good morning|hip extension/, "back extension machine"],
  [/fly\b/, "pec deck machine"],
  [/chest press|inner chest/, "chest press machine"],
  [/shoulder press|military press/, "shoulder press machine"],
  [/lateral raise/, "lateral raise machine"],
  [/pulldown|pullover/, "lat pulldown machine"],
  [/t[- ]bar/, "t-bar row machine"],
  [/\brow\b/, "row machine"],
  [/curl|preacher/, "biceps machine"],
  [/triceps|\bdip\b/, "triceps machine"],
  [/twist/, "rotary torso machine"],
  [/crunch|leg raise/, "ab crunch machine"],
  [/shrug/, "shrug machine"],
];
const SLED_RULES = [[/hack/, "hack squat machine"]];
const CABLE_RULES = [
  [/pulldown|pullover/, "lat pulldown station"],
  [/cross-?over|\bfly\b|upper chest/, "cable crossover"],
];
// Ejercicios de peso corporal que necesitan algo. "bench pull-ups" va a la barra, "bench dip" al banco.
const BODYWEIGHT_RULES = [
  [/pull-?ups?\b|chin-?ups?\b|\bhanging\b|muscle[ -]up|dip-pull-up cage|toes to bar/, "pull-up bar"],
  [/\bbench\b|between benches|step-?ups?\b|\bbox\b|captains chair|\bchair\b|staircase/, "bench or box"],
  [/\bdips?\b|parallel bars/, "dip bars", /\bfloor\b/],
];

function firstMatch(rules, name, fallback) {
  for (const [re, key, not] of rules) if (re.test(name) && !(not && not.test(name))) return key;
  return fallback;
}

// Clave de equipamiento principal de un registro crudo del dataset
function effectiveEquipment(raw) {
  const name = String(raw.name).toLowerCase();
  switch (raw.equipment) {
    case "leverage machine": return firstMatch(LEVERAGE_RULES, name, "leverage machine");
    case "sled machine": return firstMatch(SLED_RULES, name, "leg press machine");
    case "cable": return firstMatch(CABLE_RULES, name, "cable");
    case "body weight": return firstMatch(BODYWEIGHT_RULES, name, "body weight");
    default: return raw.equipment;
  }
}

// Segunda cosa que hace falta además del equipamiento principal: banco o rack (o null)
function effectiveExtra(raw) {
  if (!["barbell", "ez barbell", "dumbbell", "cable", "olympic barbell"].includes(raw.equipment)) return null;
  const name = String(raw.name).toLowerCase();
  if (/preacher|scott/.test(name)) return "preacher bench";
  if (/\bincline\b/.test(name)) return "incline bench";
  if (/\bdecline\b/.test(name)) return "decline bench";
  if (/\bbench\b|\blying\b|\bsupine\b/.test(name) && !/floor/.test(name)) return "flat bench";
  if (raw.equipment === "barbell" && /\bsquat\b|rack pull/.test(name) && !/split squat|smith/.test(name)) return "squat rack";
  return null;
}

function equipmentInfo(key) {
  const e = EQUIPMENT[key];
  return { key, label: e?.es ?? key, kind: e?.kind ?? "implement", group: e?.group ?? "Otros" };
}

// Peso en el sorteo del generador (qué tan habitual es el equipamiento)
function equipmentWeight(key) {
  return EQUIPMENT[key]?.weight ?? (key === "body weight" ? 2.5 : 0.3);
}

// Músculo principal en español (el dataset los trae en inglés)
const TARGET_ES = {
  abs: "Abdominales", quads: "Cuádriceps", lats: "Dorsales", calves: "Gemelos", pectorals: "Pecho", glutes: "Glúteos",
  hamstrings: "Femorales", adductors: "Aductores", triceps: "Tríceps", "cardiovascular system": "Cardio", spine: "Lumbares",
  "upper back": "Espalda alta", biceps: "Bíceps", delts: "Hombros", forearms: "Antebrazos", traps: "Trapecios",
  "serratus anterior": "Serrato", abductors: "Abductores", "levator scapulae": "Elevador de la escápula",
};
const targetLabel = (t) => TARGET_ES[t] ?? t;

module.exports = { TARGET_ES, targetLabel, EQUIPMENT, KIND_LABEL, effectiveEquipment, effectiveExtra, equipmentInfo, equipmentWeight };
