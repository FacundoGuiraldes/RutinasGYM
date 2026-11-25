// "Canon": los ejercicios que de verdad aparecen en los programas publicados por referentes.
// Fuente: lectura de 21 programas completos (PHUL, Metallicadpa PPL, Coolcicada PPL, Dumbbell PPL, Arnold Split,
// Bro Split, Lyle McDonald Generic Bulking, GZCL General Gainz Bodybuilding, 5/3/1 Boring But Big, Strong Curves,
// Jay Cutler, Dorian Yates, Mike Mentzer, Steve Reeves, Jim Stoppani Shortcut to Size, Planet Fitness Hypertrophy,
// GZCL Jacked & Tan 2.0, KONG, P-Zero, GZCL UHF, Bullmastiff) más la guía de volumen de Renaissance Periodization y de Helms/Nuckols. Cada hueco tiene una lista ordenada:
// primero lo que más programas usan, después las alternativas habituales. Es una lista de nombres del dataset en inglés.
// El generador elige solo entre los 2 primeros grupos que existan en la sede (así cambia de mes a mes sin salirse de lo clásico).
const CANON = {
  chestC: [
    [/^barbell bench press$/, /^dumbbell bench press$/, /^lever chest press$/, /^smith bench press$/],
    [/^dumbbell incline bench press$/, /^barbell incline bench press$/, /^lever incline chest press$/, /^smith incline bench press$/],
    [/^chest dip$/, /^push-up$/, /^cable (standing )?chest press$/],
  ],
  chestI: [
    [/^cable middle fly$/, /^cable cross-over variation$/, /^cable fly$/, /^dumbbell fly$/, /^lever seated fly$/, /^lever pec deck fly$/],
    [/^dumbbell incline fly$/, /^cable incline fly$/, /^cable low fly$/],
  ],
  backV: [
    [/^cable (lat )?pulldown$/, /^lever front pulldown$/, /^cable pulldown \(pro lat bar\)$/],
    [/^pull-up$/, /^chin-up$/, /^cable wide grip pulldown/, /^lever (underhand )?pulldown/],
  ],
  backH: [
    [/^cable seated row$/, /^cable (low )?seated row$/, /^lever seated row$/, /^lever narrow grip seated row$/],
    [/^barbell bent over row$/, /^dumbbell bent over row$/, /^dumbbell one arm bent-over row$/, /^dumbbell one arm row$/, /^lever t bar row$/, /^lever bent over row$/],
  ],
  backI: [
    [/^cable pullover$/, /^dumbbell pullover$/, /^cable straight arm pulldown/],
    [/^dumbbell one arm row$/, /^lever seated row$/],
  ],
  delC: [
    [/^dumbbell seated shoulder press$/, /^barbell seated overhead press$/, /^lever shoulder press$/, /^lever military press$/, /^dumbbell shoulder press$/],
    [/^barbell standing military press$/, /^dumbbell standing overhead press$/, /^smith shoulder press$/, /^dumbbell arnold press$/],
  ],
  delSide: [
    [/^dumbbell lateral raise$/, /^cable lateral raise$/, /^lever lateral raise$/],
    [/^dumbbell seated lateral raise$/, /^cable one arm lateral raise$/],
  ],
  delRear: [
    [/^cable (rear delt )?face pull$/, /^cable (standing )?rear delt row$/, /^lever seated reverse fly$/, /^dumbbell rear lateral raise$/, /^dumbbell (bent over )?reverse fly$/],
    [/^cable standing rear delt/, /^dumbbell lying rear lateral raise$/, /^lever reverse fly$/],
  ],
  trap: [[/^dumbbell shrug$/, /^barbell shrug$/, /^lever shrug$/, /^cable shrug$/]],
  bi: [
    [/^barbell curl$/, /^dumbbell biceps curl$/, /^ez barbell curl$/, /^cable curl$/, /^cable (standing )?biceps curl$/, /^dumbbell alternate biceps curl$/],
    [/^dumbbell hammer curl$/, /^cable hammer curl/, /^dumbbell incline curl$/, /^lever preacher curl$/, /^ez barbell preacher curl$/, /^dumbbell preacher curl$/],
  ],
  tri: [
    [/^cable pushdown$/, /^cable triceps pushdown/, /^cable (rope )?pushdown/, /^cable pushdown \(with rope attachment\)$/],
    [/^cable overhead triceps extension/, /^dumbbell triceps extension$/, /^ez barbell (lying )?triceps extension/, /^barbell lying (close-grip )?triceps extension/, /^lever triceps extension$/, /^cable triceps extension$/],
  ],
  quadC: [
    [/^barbell full squat$/, /^barbell squat$/, /^smith squat$/, /^lever (horizontal )?leg press$/, /^sled 45\S* leg press$/, /^lever squat$/],
    [/^dumbbell goblet squat$/, /^barbell front squat$/, /^sled hack squat$/, /^lever hack squat$/],
  ],
  lunge: [
    [/^dumbbell lunge$/, /^barbell lunge$/, /^dumbbell rear lunge$/, /^dumbbell (alternate )?step-?up$/, /^barbell step-?up$/],
    [/^dumbbell split squat$/, /^dumbbell single leg split squat$/, /^smith split squat$/, /^barbell (rear )?lunge$/],
  ],
  hingeC: [
    [/^barbell romanian deadlift$/, /^dumbbell romanian deadlift$/, /^barbell stiff leg deadlift$/, /^barbell straight leg deadlift$/],
    [/^barbell deadlift$/, /^dumbbell deadlift$/, /^trap bar deadlift$/, /^barbell good morning$/],
  ],
  legCurl: [
    [/^lever lying leg curl$/, /^lever seated leg curl$/, /^cable leg curl$/],
    [/^dumbbell lying leg curl$/, /^lever (standing )?leg curl$/],
  ],
  legExt: [[/^lever leg extension$/, /^lever seated leg extension$/]],
  gluteI: [
    [/^barbell glute bridge$/, /^barbell hip thrust$/, /^glute bridge two legs on bench/, /^lever hip thrust$/, /^smith hip thrust$/, /^dumbbell glute bridge$/, /^cable pull through/],
    [/^lever reverse hyperextension$/, /^lever seated hip abduction$/, /^dumbbell step-up$/, /^dumbbell sumo pull through$/, /^dumbbell romanian deadlift$/],
  ],
  calf: [
    [/^lever (standing )?calf raise$/, /^lever seated calf raise$/, /^barbell standing calf raise$/, /^dumbbell standing calf raise$/, /^smith standing calf raise$/, /^smith standing leg calf raise$/],
    [/^lever (calf press|leg press calf raise)/, /^sled calf press/, /^barbell seated calf raise$/, /^dumbbell seated calf raise$/, /^sled 45.* calf press/],
  ],
  abs: [
    [/^cable (kneeling )?crunch$/, /^hanging leg raise$/, /^hanging (straight )?leg raise$/, /^ab roller$/, /^wheel rollout/, /^crunch$/, /^lever seated crunch/],
    [/^reverse crunch$/, /^plank$/, /^lying leg raise$/, /^decline sit-up/, /^dead bug$/],
  ],
};

// 0 = primer grupo, 1 = segundo, 2 = tercero... ; Infinity = no está en el canon
function canonRank(slotName, name) {
  const groups = CANON[slotName];
  if (!groups) return Infinity;
  const n = String(name).toLowerCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < groups.length; i++) if (groups[i].some((re) => re.test(n))) return i;
  return Infinity;
}

module.exports = { CANON, canonRank };
