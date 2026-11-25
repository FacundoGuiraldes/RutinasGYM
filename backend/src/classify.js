// Clasificador por reglas: completa rol, patrón de movimiento y nivel de cada ejercicio.
// El dataset trae músculo, equipamiento y nombre, pero no estos tres datos, y los
// reemplazos coherentes dependen de ellos. Es una primera pasada razonable:
// después la corregís vos desde el panel admin (queda marcado classified_by = 'admin').

const ISOLATION_RE =
  /\b(fly|flye|flyes|curl|curls|extension|extensions|raise|raises|kickback|kickbacks|crunch|crunches|shrug|shrugs|pushdown|push-down|pull-?over|pullover|pec deck|abduction|adduction|wrist|twist|crossover|cross[ -]?overs?|skull ?crusher)\b/i;

const COMPOUND_RE =
  /\b(squat|squats|deadlift|press|row|rows|pull[ -]?up|pull[ -]?ups|chin[ -]?up|chin[ -]?ups|pulldown|pull-down|lunge|lunges|dip|dips|push[ -]?up|push[ -]?ups|clean|snatch|thruster|step[ -]?up|hip thrust|good morning|burpee|bench|jerk|bridge|swing|presses|rack pull|pull[ -]?through|hip lift)\b/i;

const MOBILITY_RE = /\b(stretch|stretches|mobility|foam roll|foam roller)\b/i;

const ADVANCED_RE =
  /\b(single[ -]leg|one[ -]leg|one[ -]arm|pistol|archer|clapping|plyo|muscle[ -]up|snatch|clean|jerk|handstand|l[ -]sit|front lever|back lever|dragon flag|human flag|jump|jumping|explosive|balance|weighted pull|deficit|ring|rings|suspended|bosu)\b/i;

// Nivel base según el equipamiento: las máquinas guiadas son más simples que la barra libre
const EQUIPMENT_LEVEL = {
  "leverage machine": 1,
  "sled machine": 1,
  assisted: 1,
  cable: 1,
  "smith machine": 1,
  band: 1,
  "resistance band": 1,
  "body weight": 1,
  roller: 1,
  "stationary bike": 1,
  "elliptical machine": 1,
  "stepmill machine": 1,
  "upper body ergometer": 1,
  "skierg machine": 1,
  dumbbell: 1,
  "ez barbell": 1,
  barbell: 2,
  kettlebell: 2,
  "stability ball": 2,
  "medicine ball": 2,
  weighted: 2,
  rope: 2,
  hammer: 2,
  tire: 2,
  "wheel roller": 2,
  "trap bar": 2,
  "bosu ball": 3,
  "olympic barbell": 3,
};

function classifyRole(ex) {
  const name = ex.name;
  if (ex.body_part === "cardio" || ex.target === "cardiovascular system") return "cardio";
  if (MOBILITY_RE.test(name) || ex.equipment === "roller") return "mobility";
  if (ex.target === "abs") return "core";
  if (ISOLATION_RE.test(name)) return "isolation";
  if (COMPOUND_RE.test(name)) return "compound";
  // No pudimos saber qué es (saltos, equilibrio, caminatas...): queda "other" y el generador
  // automático NO lo usa. Lo podés reclasificar desde el panel admin.
  return "other";
}

function classifyPattern(ex, role) {
  const n = ex.name;
  const t = ex.target;
  if (role === "cardio") return "cardio";
  if (role === "mobility") return "mobility";

  if (role === "core") {
    if (/\b(twist|rotation|woodchop|wood chop|russian|oblique|side bend|windshield)\b/i.test(n)) return "core_rotation";
    if (/\b(plank|hold|wheel|rollout|roll-out|dead bug|bird dog|mountain climber|bear crawl|stability)\b/i.test(n)) return "core_stability";
    return "core_flexion";
  }

  // Músculos chicos: el patrón sale del músculo
  if (t === "calves") return "calf_raise";
  if (t === "forearms") return "wrist";
  if (t === "abductors") return "hip_abduction";
  if (t === "adductors") return "hip_adduction";
  if (t === "biceps") return "elbow_flexion";
  if (t === "triceps") return "elbow_extension";
  if (t === "traps") return "shrug";
  if (t === "serratus anterior") return "protraction";
  if (t === "levator scapulae") return "neck";

  if (t === "pectorals") return "horizontal_push";
  if (t === "lats") return /\brows?\b/i.test(n) ? "horizontal_pull" : "vertical_pull";
  if (t === "upper back") return /\b(pull[ -]?up|chin[ -]?up|pulldown|pull-down)\b/i.test(n) ? "vertical_pull" : "horizontal_pull";
  if (t === "delts") {
    if (/\b(press|push press|overhead|arnold|handstand)\b/i.test(n)) return "vertical_push";
    if (/\b(rear|reverse|face pull|bent[ -]over)\b/i.test(n)) return "rear_delt";
    return "shoulder_raise";
  }
  if (t === "quads") {
    if (/\bleg extension\b/i.test(n)) return "knee_extension";
    if (/\b(lunge|lunges|split squat|step[ -]?up|bulgarian)\b/i.test(n)) return "lunge";
    return "squat";
  }
  if (t === "hamstrings") {
    if (/\b(leg curl|hamstring curl|nordic|curl)\b/i.test(n)) return "knee_flexion";
    return "hinge";
  }
  if (t === "glutes") {
    if (/\b(lunge|lunges|split squat|step[ -]?up|bulgarian)\b/i.test(n)) return "lunge";
    if (/\b(squat|squats|leg press|hack|sissy)\b/i.test(n)) return "squat";
    if (/\b(bridge|thrust|deadlift|good morning|swing|pull[ -]?through)\b/i.test(n)) return "hinge";
    return "glute_isolation";
  }
  if (t === "spine") return "hinge";
  return `other_${t.replace(/\s+/g, "_")}`;
}

function classifyLevel(ex) {
  let level = EQUIPMENT_LEVEL[ex.equipment] ?? 2;
  if (ADVANCED_RE.test(ex.name)) level = 3;
  return Math.min(3, Math.max(1, level));
}

// Entrada: registro crudo del dataset. Salida: { role, pattern, level }
function classifyExercise(raw) {
  const ex = { name: raw.name, target: raw.target, body_part: raw.body_part, equipment: raw.equipment };
  const role = classifyRole(ex);
  const pattern = classifyPattern(ex, role);
  const level = role === "cardio" || role === "mobility" ? 1 : classifyLevel(ex);
  return { role, pattern, level };
}

module.exports = { classifyExercise, classifyRole, classifyPattern, classifyLevel };
