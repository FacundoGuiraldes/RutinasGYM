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
  /^barbell glute bridge$/, /^glute bridge two legs on bench/, /^cable pull through/, /^cable kickback$/, /^lever back extension$/, /^lever seated hip abduction$/, /^hyperextension \(on bench\)$/,
  // Brazos
  /^(barbell curl|dumbbell biceps curl|dumbbell hammer curl|dumbbell alternate biceps curl|cable curl|lever bicep curl|lever preacher curl|barbell preacher curl|cable preacher curl)$/,
  /^cable (pushdown|triceps pushdown \(v-bar\)|pushdown \(with rope attachment\))$/, /^barbell lying (close-grip )?triceps extension$/, /^dumbbell (seated|standing) (overhead )?triceps extension$/, /^lever seated dip$/, /^triceps dip$/, /^bench dip/,
  // Abdomen
  /^(crunch floor|cable seated crunch|cable standing crunch|hanging leg raise|reverse crunch|decline crunch|lying leg raise flat bench)$/, /^plank$/,
];

// Variantes comunes: equipo estándar y un movimiento clásico al final del nombre
const T2 = /^(barbell|dumbbell|cable|lever|smith|sled|ez barbell|trap bar)\s(?:[a-z-]+\s){0,3}(press|row|curl|raise|extension|squat|lunge|pulldown|pushdown|fly|deadlift|crunch|pullover|kickback|shrug|dip|bridge)$/;

function staple(name) {
  const n = String(name).toLowerCase().replace(/\s+/g, " ").trim();
  if (T1.some((re) => re.test(n))) return 1;
  if (T2.test(n)) return 2;
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

module.exports = { staple, isJunk, T1, T2 };
