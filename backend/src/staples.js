// Ejercicios "de toda la vida": los que cualquier profe pone primero en una sala.
// La rutina los prefiere siempre; lo raro solo aparece si la sede no tiene otra cosa.
//
//   nivel 1: los básicos (press de banco, sentadilla, remo, jalón, curl, etc.)
//   nivel 2: variantes comunes con equipo estándar (mancuernas, barra, polea, máquina)
//   nivel 3: todo lo demás (poco probable que se elija)
//
// Se reconocen por el nombre en inglés del dataset.

const T1 = [
  // Pecho
  /^(barbell|dumbbell) (incline |decline )?bench press$/, /^lever (incline )?chest press$/, /^smith (incline )?bench press$/,
  /^chest dip$/, /^push-up$/, /^(cable (standing|low|incline|middle) fly|dumbbell (incline )?fly|lever seated fly|cable cross-over variation)$/,
  // Espalda
  /^(pull-up|chin-up)$/, /^cable (lat )?pulldown/, /^lever front pulldown$/, /^twin handle parallel grip lat pulldown$/, /^reverse grip machine lat pulldown$/,
  /^cable (low |straight back )?seated row$/, /^lever (narrow grip )?seated row$/, /^lever (high row|t bar row|bent over row)$/, /^barbell bent over row$/, /^dumbbell (bent over|one arm bent-over) row$/, /^cable seated high row \(v-bar\)$/,
  // Hombros
  /^dumbbell (seated shoulder press|standing overhead press)$/, /^barbell seated overhead press$/, /^lever military press$/, /^smith shoulder press$/, /^cable shoulder press$/,
  /^(dumbbell (seated )?lateral raise|cable lateral raise|lever lateral raise)$/, /^(dumbbell rear lateral raise|dumbbell incline rear lateral raise|lever seated reverse fly|dumbbell reverse fly|cable rear delt row \(with rope\))$/,
  // Piernas
  /^(barbell full squat|dumbbell goblet squat|dumbbell squat|smith squat|smith full squat|barbell front squat)$/, /leg press$/, /^(sled )?(closer )?hack squat$/,
  /^(barbell|dumbbell) romanian deadlift$/, /^(barbell|dumbbell|trap bar) deadlift$/,
  /^(dumbbell|barbell) (rear )?lunge$/, /^split squats$/, /^dumbbell (rear )?(lunge|split squat)/,
  /^lever (lying|seated|kneeling) leg curl$/, /^lever leg extension$/, /^lever (standing|seated) calf raise$/, /^cable standing calf raise$/,
  // Glúteos
  /^barbell hip thrust$/, /^barbell glute bridge$/, /^glute bridge two legs on bench/, /^cable pull through/, /^cable kickback$/, /^lever back extension$/, /^lever seated hip abduction$/, /^hyperextension \(on bench\)$/,
  // Brazos
  /^(barbell curl|dumbbell biceps curl|dumbbell hammer curl|dumbbell alternate biceps curl|cable curl|lever bicep curl|lever preacher curl|barbell preacher curl|cable preacher curl)$/,
  /^cable (pushdown|triceps pushdown \(v-bar\)|pushdown \(with rope attachment\))$/, /^barbell lying (close-grip )?triceps extension$/, /^dumbbell (seated|standing) (overhead )?triceps extension$/, /^lever seated dip$/, /^triceps dip$/, /^bench dip/,
  // Abdomen
  /^(crunch floor|cable seated crunch|cable standing crunch|hanging leg raise|reverse crunch|decline crunch|lying leg raise flat bench)$/, /^plank$/,
];

// Variantes comunes: equipo estándar + movimiento clásico + solo modificadores comunes (posición, agarre, lado).
// Si el nombre trae algo raro (tate, peacher, side split, hip extension...) cae en el nivel 3.
const EQUIP = new Set(["barbell", "dumbbell", "cable", "lever", "smith", "sled", "ez barbell", "trap bar"]);
const MOVES = new Set(["press", "row", "curl", "raise", "extension", "squat", "lunge", "pulldown", "pushdown", "fly", "deadlift", "crunch", "pullover", "kickback", "shrug", "dip", "bridge"]);
const MODS = new Set(["seated", "standing", "incline", "decline", "flat", "alternate", "one", "arm", "leg", "wide", "close", "narrow", "grip", "close-grip", "wide-grip", "reverse", "neutral", "parallel", "hammer", "preacher", "lying", "bent", "over", "low", "high", "rear", "front", "full", "underhand", "overhand", "single", "two", "bench", "shoulder", "chest", "biceps", "triceps", "lateral", "overhead", "romanian", "stiff", "straight", "back", "lat", "upper", "v-bar", "rope", "goblet", "military", "arnold", "leg", "calf", "hip", "t", "bar", "t-bar"]);
const BAD_MODS = /bench squat|bench front|stiff leg|straight leg|^(cable|lever|smith) deadlift|lateral pulldown|rear pulldown|overhand triceps|bent arm|standing preacher|alternate preacher|alternate (overhead|shoulder)|wide grip decline|tate|peacher|side split|hip extension|cuban|scott|twist|jm\b|rocking|palm|kneeling|prone|decline close|upper row|wide military|underhand pulldown|bar lateral/;

function isCommonVariant(n) {
  if (BAD_MODS.test(n)) return false;
  const plain = n.replace(/\((with rope( attachment)?|v-bar)\)/g, "").replace(/\s+/g, " ").trim();
  if (/[()]/.test(plain)) return false;
  const words = plain.split(" ");
  const eq = EQUIP.has(`${words[0]} ${words[1]}`) ? 2 : EQUIP.has(words[0]) ? 1 : 0;
  if (!eq) return false;
  const rest = words.slice(eq);
  const last = rest.at(-1);
  if (!MOVES.has(last)) return false;
  return rest.slice(0, -1).every((w) => MODS.has(w));
}

// Los 15 ejercicios con más respaldo y uso (nivel 0): multiarticulares pesados y los aislados clásicos
const T0 = [
  /^(barbell|dumbbell) (incline )?bench press$/, /^lever (incline )?chest press$/, /^(pull-up|chin-up)$/, /^cable (lat )?pulldown/, /^lever front pulldown$/,
  /^cable (low |straight back )?seated row$/, /^lever (narrow grip )?seated row$/, /^barbell bent over row$/, /^dumbbell (bent over|one arm bent-over) row$/, /^lever t bar row$/,
  /^dumbbell seated shoulder press$/, /^barbell seated overhead press$/, /^lever military press$/,
  /^(barbell full squat|dumbbell goblet squat|barbell front squat)$/, /^(sled )?(45.*)?leg press$|^lever horizontal leg press$/, /^(barbell|dumbbell) romanian deadlift$/, /^barbell deadlift$/, /^barbell hip thrust$/, /^barbell glute bridge$/,
  /^(dumbbell|barbell) (rear )?lunge$/, /^lever (lying|seated) leg curl$/, /^lever leg extension$/, /^lever (standing|seated) calf raise$/,
  /^(barbell curl|dumbbell biceps curl|dumbbell hammer curl|cable curl)$/, /^cable (pushdown|triceps pushdown \(v-bar\))$/, /^dumbbell lateral raise$/, /^cable lateral raise$/, /^lever seated reverse fly$/, /^dumbbell rear lateral raise$/,
];

// 0 = los de mayor respaldo y uso, 1 = básicos, 2 = variantes comunes, 3 = todo lo demás
function staple(name) {
  const n = String(name).toLowerCase().replace(/\(male\)|\(female\)/g, "").replace(/\s+/g, " ").trim();
  if (T0.some((re) => re.test(n))) return 0;
  if (T1.some((re) => re.test(n))) return 1;
  if (isCommonVariant(n)) return 2;
  return 3;
}

// Ejercicios que casi nadie usa en una sala (o que no tienen respaldo para ganar músculo o fuerza): quedan fuera de las rutinas.
// No se borran del catálogo: el profe puede verlos y elegirlos a mano.
//  - gimnasia y trucos (planche, maltese, muscle-up, parada de manos...)
//  - levantamientos olímpicos (técnica compleja, no para un socio común)
//  - inestabilidad (pelota, bosu, TRX, anillas): bajan la fuerza que se puede aplicar y no suman músculo
//  - banda elástica (rara en sala), toalla, "versión 2/3" repetidas, yoga, boxeo, saltos y lanzamientos
//  - variantes de rehabilitación o excéntricas que no usa nadie (cuban, scott, clock, stork, bench pull-up...)
const JUNK = /\b(maltese|planche|handstand|front lever|back lever|human flag|muscle[- ]?up|archer|typewriter|clock|cuban|stork|dip cage|self assisted|pelvic tilt|bench pull-?ups?|kayak|thibaudeau|zercher|bradford|jm|scott|gironda|sphinx|burpee|jumping jack|jack ?knife|slam|throw|toss|catch|boxing|hook|judo|flip|iron cross|windmill|rollerout|spider|frog|jefferson|bottoms|drag curl|squat thrust|snatch|clean|jerk|get up|turkish|tire|rope climb|isometric|yoga|pose|wall|hindu|superman|pass through|swing|slingers|touch|toe touch|inchworm|crawl|mountain climber|tuck|pike|maltese|hang position|lean|impossible|korean|elbow dips|scapula|sissy|pistol|donkey|ergometer|stepmill|treadmill|balance board|stability ball|exercise ball|bosu|suspended|straps|rings?|towel|trx|v\. [23]|v-up|rocking|twisting|palm in|alternate side press|hammer press)\b/i;
const GENDER_MARK = /\((male|female)\)/i;
function isJunk(name, equipment) {
  const n = String(name).toLowerCase();
  if (/band/.test(equipment || "")) return true;
  // Los básicos son intocables aunque algún término suelto coincida
  if (staple(n.replace(GENDER_MARK, "").trim()) === 1) return false;
  return JUNK.test(n);
}

module.exports = { staple, isJunk, T0, T1 };
