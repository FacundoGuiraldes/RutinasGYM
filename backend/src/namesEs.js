// Traducción de nombres de ejercicios al español, por reglas (sin IA ni internet).
// Estructura del nombre: Movimiento + variantes + "con/en" equipo. Ej: "dumbbell incline bench press" ->
// "Press de banco inclinado con mancuernas". Lo que no se reconoce queda en inglés y devuelve `complete: false`
// para que se pueda revisar (el admin ve el nombre original igual).

// Equipo: se mueve al final con su preposición
const EQUIP = [
  ["ez barbell", "con barra Z"], ["ez bar", "con barra Z"], ["olympic barbell", "con barra olímpica"], ["barbell", "con barra"],
  ["dumbbells", "con mancuernas"], ["dumbbell", "con mancuernas"], ["kettlebell", "con kettlebell"], ["smith", "en máquina Smith"],
  ["cable", "en polea"], ["lever", "en máquina"], ["sled", "en trineo"], ["band", "con banda elástica"], ["resistance band", "con banda elástica"],
  ["medicine ball", "con balón medicinal"], ["stability ball", "sobre pelota de estabilidad"], ["exercise ball", "sobre pelota de ejercicio"],
  ["bosu ball", "sobre bosu"], ["bosu", "sobre bosu"], ["rope", "con soga"], ["roller", "con rodillo"], ["wheel", "con rueda abdominal"],
  ["weighted", "con peso"], ["suspended", "en suspensión"], ["trap bar", "con barra hexagonal"], ["landmine", "en landmine"], ["towel", "con toalla"],
  ["body weight", ""], ["bodyweight", ""],
];

// Variantes: van después del movimiento, en el orden en que aparecen
const MOD = [
  ["one arm", "a un brazo"], ["single arm", "a un brazo"], ["one leg", "a una pierna"], ["single leg", "a una pierna"],
  ["alternate", "alterno"], ["alternating", "alterno"], ["close grip", "agarre cerrado"], ["close-grip", "agarre cerrado"], ["wide grip", "agarre ancho"], ["wide-grip", "agarre ancho"],
  ["narrow grip", "agarre estrecho"], ["reverse grip", "agarre inverso"], ["neutral grip", "agarre neutro"], ["underhand", "agarre supino"], ["parallel grip", "agarre paralelo"], ["hammer grip", "agarre martillo"],
  ["seated", "sentado"], ["sitted", "sentado"], ["standing", "de pie"], ["lying", "acostado"], ["kneeling", "de rodillas"], ["hanging", "colgado"], ["prone", "boca abajo"], ["supine", "boca arriba"],
  ["incline", "inclinado"], ["decline", "declinado"], ["reverse", "inverso"], ["bent over", "inclinado hacia adelante"], ["bent-over", "inclinado hacia adelante"], ["bent", "inclinado"],
  ["front", "frontal"], ["rear", "posterior"], ["lateral", "lateral"], ["side", "lateral"], ["overhead", "sobre la cabeza"], ["behind head", "tras nuca"], ["behind neck", "tras nuca"],
  ["straight arm", "con brazos rectos"], ["straight leg", "con piernas rectas"], ["stiff leg", "con piernas rígidas"], ["stiff-leg", "con piernas rígidas"],
  ["high", "alto"], ["low", "bajo"], ["wide", "ancho"], ["narrow", "estrecho"], ["half", "medio"], ["full", "completo"], ["assisted", "asistido"],
  ["(male)", ""], ["(female)", ""], ["v. 2", "v2"], ["v. 3", "v3"],
];

// Movimientos (el sustantivo principal). Primero las frases más largas.
const MOVE = [
  ["bench press", "Press de banco"], ["chest press", "Press de pecho"], ["shoulder press", "Press de hombros"], ["military press", "Press militar"], ["leg press", "Prensa de piernas"],
  ["push-up", "Flexión de brazos"], ["push up", "Flexión de brazos"], ["pull-up", "Dominada"], ["pull up", "Dominada"], ["chin-up", "Dominada supina"], ["chin up", "Dominada supina"],
  ["sit-up", "Abdominal completo"], ["sit up", "Abdominal completo"], ["leg raise", "Elevación de piernas"], ["knee raise", "Elevación de rodillas"], ["lateral raise", "Elevación lateral"],
  ["front raise", "Elevación frontal"], ["calf raise", "Elevación de talones"], ["hip thrust", "Empuje de cadera"], ["glute bridge", "Puente de glúteos"], ["romanian deadlift", "Peso muerto rumano"],
  ["stiff leg deadlift", "Peso muerto con piernas rígidas"], ["sumo deadlift", "Peso muerto sumo"], ["good morning", "Buenos días"], ["lat pulldown", "Jalón al pecho"], ["pulldown", "Jalón"],
  ["pushdown", "Extensión de tríceps en polea"], ["skull crusher", "Press francés"], ["skullcrusher", "Press francés"], ["french press", "Press francés"], ["triceps extension", "Extensión de tríceps"],
  ["tricep extension", "Extensión de tríceps"], ["leg extension", "Extensión de piernas"], ["leg curl", "Curl femoral"], ["hamstring curl", "Curl femoral"], ["wrist curl", "Curl de muñeca"],
  ["preacher curl", "Curl predicador"], ["hammer curl", "Curl martillo"], ["concentration curl", "Curl concentrado"], ["zottman curl", "Curl Zottman"], ["biceps curl", "Curl de bíceps"], ["bicep curl", "Curl de bíceps"],
  ["triceps dip", "Fondos de tríceps"], ["chest dip", "Fondos de pecho"], ["dips", "Fondos"], ["dip", "Fondos"], ["back extension", "Extensión lumbar"], ["hyperextension", "Hiperextensión"],
  ["russian twist", "Giro ruso"], ["mountain climber", "Escalador"], ["jumping jack", "Salto de tijera"], ["step up", "Subida al cajón"], ["step-up", "Subida al cajón"], ["farmer walk", "Caminata del granjero"],
  ["reverse fly", "Aperturas inversas"], ["rear delt fly", "Aperturas para deltoides posterior"], ["face pull", "Face pull"], ["pull through", "Pull through"], ["kickback", "Patada"],
  ["deadlift", "Peso muerto"], ["squat", "Sentadilla"], ["lunge", "Zancada"], ["press", "Press"], ["row", "Remo"], ["curl", "Curl"], ["fly", "Aperturas"], ["flye", "Aperturas"], ["pullover", "Pullover"],
  ["shrug", "Encogimiento de hombros"], ["crunch", "Abdominal"], ["plank", "Plancha"], ["bridge", "Puente"], ["extension", "Extensión"], ["raise", "Elevación"], ["twist", "Giro"], ["rotation", "Rotación"],
  ["stretch", "Estiramiento"], ["walk", "Caminata"], ["run", "Carrera"], ["jump", "Salto"], ["swing", "Balanceo"], ["snatch", "Arranque"], ["clean", "Cargada"], ["jerk", "Envión"], ["thruster", "Thruster"],
  ["burpee", "Burpee"], ["slam", "Golpe contra el suelo"], ["throw", "Lanzamiento"], ["hug", "Abrazo"], ["circles", "Círculos"], ["bike", "Bicicleta"], ["tilt", "Inclinación"], ["kick", "Patada"],
  ["pull", "Tracción"], ["push", "Empuje"], ["lift", "Levantamiento"], ["tap", "Toque"], ["touch", "Toque"], ["hold", "Sostén"], ["drag", "Arrastre"], ["crawl", "Arrastre"], ["lift", "Levantamiento"],
];

const WORDS = { arm: "brazo", arms: "brazos", leg: "pierna", legs: "piernas", knee: "rodilla", knees: "rodillas", hip: "cadera", chest: "pecho", back: "espalda", shoulder: "hombro", shoulders: "hombros",
  biceps: "bíceps", bicep: "bíceps", triceps: "tríceps", tricep: "tríceps", calf: "gemelos", calves: "gemelos", glute: "glúteo", glutes: "glúteos", abs: "abdominales", core: "core", neck: "cuello",
  hamstring: "isquiotibiales", quads: "cuádriceps", quadriceps: "cuádriceps", wrist: "muñeca", ankle: "tobillo", forearm: "antebrazo", lat: "dorsal", lats: "dorsales", delt: "deltoides",
  floor: "en el suelo", bench: "banco", ball: "pelota", exercise: "", the: "", of: "de", to: "a", with: "con", on: "", and: "y", in: "", up: "", down: "", over: "sobre", between: "entre", through: "a través", from: "desde", behind: "tras", under: "bajo", around: "alrededor", against: "contra",
  wall: "pared", chair: "silla", rack: "rack", box: "cajón", bar: "barra", handle: "agarre", two: "dos", one: "un", single: "simple", double: "doble", cross: "cruzado", twisting: "con giro", twisted: "con giro",
  straight: "recto", flat: "plano", vertical: "vertical", horizontal: "horizontal", isometric: "isométrico", jump: "salto", jumping: "con salto", plyo: "pliométrico", pike: "pica", frog: "rana", hand: "mano", hands: "manos",
  palm: "palma", palms: "palmas", head: "cabeza", forward: "adelante", backward: "atrás", upright: "vertical", power: "potencia", speed: "velocidad", elbow: "codo", spine: "columna", pelvic: "pélvico", oblique: "oblicuo", inner: "interno", outer: "externo", thigh: "muslo", toe: "punta de pie", toes: "puntas de pie", heel: "talón", torso: "torso", trunk: "tronco", hug: "abrazo", upper: "superior", lower: "inferior", straps: "con correas", ring: "en anillas", rings: "en anillas", internal: "interna", external: "externa", bend: "flexión lateral", round: "circular", w: "W", t: "T", y: "Y", superman: "superman", lean: "inclinado", sphinx: "esfinge", position: "posición", stepmill: "escaladora", ergometer: "ergómetro", drive: "empuje", sumo: "sumo", pull: "tracción", hook: "gancho", boxing: "boxeo", impossible: "imposible", clasped: "entrelazadas", circular: "circular", keens: "rodillas", runners: "corredor", sternum: "esternón", hammer: "martillo", skull: "cráneo", squatting: "en cuclillas", v: "V", sz: "SZ", support: "con apoyo", split: "dividida", hang: "colgado", clean: "cargada", deep: "profundo", hindu: "hindú", modified: "modificado", dynamic: "dinámico", groin: "ingle",
  adductor: "aductor", adductors: "aductores", abductor: "abductor", inverted: "invertido", turkish: "turco", get: "", style: "estilo", sequence: "secuencia", pose: "postura", angle: "ángulo", wide: "ancho",
  pulley: "polea", hold: "sostén", balance: "equilibrio", board: "tabla", rotary: "rotatoria", flexor: "flexor", depresor: "depresor", retractor: "retractor", supinated: "supinado", pronated: "pronado",
  stance: "postura", stork: "cigüeña", blaster: "blaster", reach: "alcance", step: "paso", pendlay: "Pendlay", zercher: "Zercher", bradford: "Bradford", jm: "JM", planche: "planche", straddle: "abierto",
  grip: "agarre", pov: "", male: "", female: "", out: "hacia afuera", sit: "sentado", finger: "dedos", donkey: "burro", knife: "navaja", jack: "tijera", judo: "judo", flip: "volteo", cross: "cruzado",
  crossover: "cruzado", over: "sobre", revers: "inverso", seated: "sentado", reverse: "inverso", lateral: "lateral", rear: "posterior", front: "frontal", alternate: "alterno", alternating: "alterno", torque: "torque",
  tennis: "tenis", ski: "esquí", skier: "esquiador", bear: "oso", yoga: "yoga", butterfly: "mariposa", bicycle: "bicicleta", kayak: "kayak", windmill: "molino", archer: "arquero", spider: "araña",
  frog: "rana", inchworm: "oruga", handstand: "parada de manos", muscle: "muscular", bottoms: "abajo", squeeze: "apretar", iron: "hierro", cuban: "cubano", rocky: "rocky", rocking: "balanceo", flexion: "flexión",
  pronation: "pronación", supination: "supinación", posterior: "posterior", rectus: "recto", femoris: "femoral", pectoralis: "pectoral", major: "mayor", piriformis: "piriforme", gluteus: "glúteo", pec: "pectoral",
  deltoid: "deltoides", scapula: "escápula", scapular: "escapular", range: "rango", motion: "movimiento", fixed: "fijo", horizontal: "horizontal", basic: "básico", variation: "variación", elevated: "elevado", extended: "extendido",
  raised: "elevado", chair: "silla", bars: "barras", parallel: "paralelas", point: "punto", response: "respuesta", slingers: "slingers", tuck: "tuck", trainer: "entrenador", stationary: "estacionaria", stabilization: "estabilización",
  stability: "estabilidad", attachment: "con accesorio", heels: "talones", touchers: "toques", apart: "separados", astride: "a horcajadas", forth: "adelante", lifting: "elevación", board: "tabla", box: "cajón" };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LOOKUPS = (list) => list.map(([en, es]) => [new RegExp(`(?<![\\w])${esc(en)}(?![\\w])`, "i"), es]).sort((a, b) => b[0].source.length - a[0].source.length);
const R_EQUIP = LOOKUPS(EQUIP);
const R_MOD = LOOKUPS(MOD);
const R_MOVE = LOOKUPS(MOVE);

function translateName(name) {
  let rest = String(name).toLowerCase().replace(/[()]/g, (c) => ` ${c} `).replace(/\s+/g, " ").trim();
  const equip = [], mods = [];
  for (const [re, es] of R_EQUIP) if (re.test(rest)) { rest = rest.replace(re, " "); if (es && !equip.includes(es)) equip.push(es); }
  for (const [re, es] of R_MOD.filter(([, e]) => /^a un[ao]? (brazo|pierna)$/.test(e))) if (re.test(rest)) { rest = rest.replace(re, " "); mods.push(es); }
  // Movimiento: el primero (más largo) que aparezca
  let move = null;
  for (const [re, es] of R_MOVE) if (re.test(rest)) { move = es; rest = rest.replace(re, " "); break; }
  for (const [re, es] of R_MOD) if (re.test(rest)) { rest = rest.replace(re, " "); if (es) mods.push(es); }
  const leftover = rest.replace(/[()]/g, " ").split(/[\s-]+/).filter(Boolean);
  const extra = [];
  let complete = true;
  for (const w of leftover) {
    if (/^\d+°?$/.test(w) || w === "v." || w === "v") { extra.push(w); continue; }
    if (w in WORDS) { if (WORDS[w]) extra.push(WORDS[w]); continue; }
    extra.push(w); complete = false;
  }
  const head = move ?? (extra.shift() ?? name);
  const out = [head, ...mods, ...extra, ...equip.slice(0, 1)].join(" ").replace(/\s+/g, " ").trim();
  return { es: out.charAt(0).toUpperCase() + out.slice(1), complete };
}

module.exports = { translateName };
