// Equipamiento: nombre en español y tipo ("kind") de cada clave del dataset.
//   none      -> no necesita nada del gimnasio (peso corporal): siempre disponible, no se marca por sede
//   machine   -> máquina o estación fija
//   implement -> elemento suelto (barras, mancuernas, bandas, pelotas, bancos, etc.)
// Las claves siguen en inglés porque son las del dataset; solo cambia lo que ve el administrador.

const EQUIPMENT = {
  "body weight": { es: "Peso corporal (sin equipamiento)", kind: "none" },
  assisted: { es: "Con ayuda / compañero (sin equipamiento)", kind: "none" },

  "leverage machine": { es: "Máquina de palanca (placas)", kind: "machine" },
  "smith machine": { es: "Máquina Smith", kind: "machine" },
  cable: { es: "Poleas / cable", kind: "machine" },
  "sled machine": { es: "Trineo / prensa de trineo", kind: "machine" },
  "stationary bike": { es: "Bicicleta fija", kind: "machine" },
  "elliptical machine": { es: "Elíptico", kind: "machine" },
  "stepmill machine": { es: "Escaladora (stepmill)", kind: "machine" },
  "skierg machine": { es: "SkiErg", kind: "machine" },
  "upper body ergometer": { es: "Ergómetro de brazos", kind: "machine" },

  barbell: { es: "Barra", kind: "implement" },
  "ez barbell": { es: "Barra Z (EZ)", kind: "implement" },
  "olympic barbell": { es: "Barra olímpica", kind: "implement" },
  "trap bar": { es: "Barra hexagonal", kind: "implement" },
  dumbbell: { es: "Mancuernas", kind: "implement" },
  kettlebell: { es: "Pesa rusa (kettlebell)", kind: "implement" },
  weighted: { es: "Con lastre (disco, chaleco, cinturón)", kind: "implement" },
  band: { es: "Banda elástica", kind: "implement" },
  "resistance band": { es: "Banda de resistencia", kind: "implement" },
  "stability ball": { es: "Pelota de estabilidad (fitball)", kind: "implement" },
  "medicine ball": { es: "Pelota medicinal", kind: "implement" },
  "bosu ball": { es: "Bosu", kind: "implement" },
  rope: { es: "Soga / cuerda", kind: "implement" },
  roller: { es: "Rodillo (foam roller)", kind: "implement" },
  "wheel roller": { es: "Rueda abdominal", kind: "implement" },
  hammer: { es: "Maza", kind: "implement" },
  tire: { es: "Neumático", kind: "implement" },

  // Elementos que el dataset no distingue: se deducen del nombre del ejercicio de peso corporal
  "pull-up bar": { es: "Barra de dominadas", kind: "implement" },
  "dip bars": { es: "Paralelas (fondos)", kind: "implement" },
  "bench or box": { es: "Banco / cajón / escalón", kind: "implement" },
};

const KIND_LABEL = { none: "No necesita equipamiento", machine: "Máquina", implement: "Elemento" };

// Los ejercicios "body weight" del dataset a veces necesitan algo (barra, paralelas, banco).
// El orden importa: "bench pull-ups" va a la barra, "bench dip" va al banco.
const BODYWEIGHT_RULES = [
  { key: "pull-up bar", re: /pull-?ups?\b|chin-?ups?\b|\bhanging\b|muscle[ -]up|dip-pull-up cage|toes to bar/i },
  { key: "bench or box", re: /\bbench\b|between benches|step-?ups?\b|\bbox\b|captains chair|\bchair\b|staircase/i },
  { key: "dip bars", re: /\bdips?\b|parallel bars/i, not: /\bfloor\b/i },
];

// Clave de equipamiento "efectiva" de un registro crudo del dataset
function effectiveEquipment(raw) {
  if (raw.equipment !== "body weight") return raw.equipment;
  for (const r of BODYWEIGHT_RULES) {
    if (r.re.test(raw.name) && !(r.not && r.not.test(raw.name))) return r.key;
  }
  return raw.equipment;
}

function equipmentInfo(key) {
  const e = EQUIPMENT[key];
  return { key, label: e?.es ?? key, kind: e?.kind ?? "implement" };
}

module.exports = { EQUIPMENT, KIND_LABEL, effectiveEquipment, equipmentInfo };
