# Rutinas de gimnasio (Martínez y Olivos)

Webapp (PWA) para armar rutinas a los socios de un gimnasio:

- **El socio** abre su link personal, elige nivel, días y enfoque, y recibe su rutina con el GIF de cada ejercicio. Tilda cada ejercicio y cierra cada día. Puede pedir **reemplazar un ejercicio** y el nuevo trabaja lo mismo.
- **El profe (admin)** tiene un panel para crear socios, corregir rutinas, manejar el catálogo y las reglas de cada sede, y un **agente de IA** al que le habla en lenguaje normal ("a Karen sacale la prensa, en Olivos no la tenemos").
- **Cada mes** la rutina se renueva sola según cuánto cumplió el socio: sube series, cantidad de ejercicios o dificultad.

## Probarla en 1 minuto (sin base de datos)

Necesitás Node 20.6 o superior.

```bash
cd backend
npm install
npm run dataset:fetch   # baja el catálogo (JSON + GIFs, ~150 MB), una sola vez
npm run demo            # base en memoria; imprime los links y la clave del panel
```

El modo demo guarda todo en memoria: al cerrarlo se pierde. Sin `OPENROUTER_API_KEY` la IA queda apagada (los reemplazos usan reglas y el agente admin no está disponible).

## Cómo funciona (la idea central)

**La base de datos decide qué es válido; la IA solo elige entre opciones ya filtradas.**

1. `loadPool` arma la lista de ejercicios que *esa sede* puede hacer: equipamiento disponible, sin exclusiones, habilitados.
2. El **generador** (`src/generator.js`) arma la rutina con reglas (división según los días, series y repeticiones según el enfoque) sobre esa lista. Es reproducible y no usa IA.
3. Para **reemplazar**, `src/replace.js` filtra candidatos del mismo músculo, patrón de movimiento, rol y nivel, los ordena por similitud y le pasa 8 a la IA para que elija uno. Si la IA inventa un id, falla o no está configurada, se usa el mejor del ranking. El texto del socio se trata como dato, no como instrucciones.
4. El **agente admin** (`src/adminAgent.js`) solo puede llamar herramientas que validan contra la base. Su "memoria" son las tablas `sede_exclusions` y `sede_equipment`: una regla guardada se respeta siempre, no depende de que la IA se acuerde.

### Progresión mensual

Al terminar el ciclo (28 días) un cron diario (03:10, hora Argentina) mide el cumplimiento: cada día marcado completo vale 1, un día con ejercicios tildados pero sin cerrar vale hasta 0,5.

| Cumplimiento | Decisión | Qué pasa en el mes siguiente |
|---|---|---|
| 85% o más | Progresar | Sube **una** palanca (series, ejercicios por día o dificultad, rotando) y sugiere más carga |
| 60% a 84% | Mantener | Misma exigencia, ejercicios renovados |
| Menos de 60% | Simplificar | Baja un escalón (menos ejercicios o series) |

Los umbrales están en `src/progression.js` (`THRESHOLDS`). No se registran pesos: la "subida de carga" es una indicación en texto.

## Puesta en producción

1. **Base de datos:** una Postgres. El plan gratuito de [Neon](https://neon.com) alcanza para empezar (copiá la cadena de conexión).
2. **Configuración:** copiá `backend/.env.example` a `backend/.env` y completá `DATABASE_URL`, `ADMIN_KEY` (larga, solo tuya) y, si querés IA, `OPENROUTER_API_KEY`.
3. **Tablas y catálogo:**
   ```bash
   cd backend
   npm run dataset:fetch
   npm run migrate
   npm run import      # importa los 1.324 ejercicios y crea las sedes Martínez y Olivos
   ```
4. **Servidor:** `npm start`. En cualquier hosting de Node (Render, Railway, Fly...) poné las mismas variables, `TRUST_PROXY=1` y `PUBLIC_URL` con tu dominio.
5. **Primer uso:** entrá a `/admin`, creá un socio y mandale su link por WhatsApp.

Los **GIFs** se sirven desde `/media` leyendo la carpeta del dataset. Si preferís un bucket o CDN, subí `images/` y `videos/` y definí `MEDIA_BASE_URL`.

## Uso del panel (`/admin`)

- **Socios:** crear (con o sin nivel/días/enfoque), copiar link, rotar link, ver y corregir su rutina, rehacerla.
- **Sedes:** tildar o destildar equipamiento y ver o quitar exclusiones. Al desactivar algo, las rutinas activas de esa sede se corrigen solas.
- **Catálogo:** buscar, deshabilitar ejercicios, corregir rol y nivel. Lo que corrijas **no se pisa** si reimportás el catálogo.
- **Agente IA:** pedidos en lenguaje normal.
- **Revisar:** cambios donde el socio mencionó dolor o lesión y notas de registro, para que los veas como profe.

## Pruebas

```bash
cd backend && npm test
```

34 pruebas (generador sobre las 60 combinaciones de nivel × días × enfoque, reemplazos, reglas por sede, progresión, API y agente con IA simulada). Las que usan el catálogo real se saltean si no corriste `npm run dataset:fetch`.

## Limitaciones conocidas

- Rol, patrón de movimiento y nivel de cada ejercicio salen de **reglas por nombre** (`src/classify.js`): es una primera pasada, no una verdad. Esperá ejercicios raros hasta que hagas tu limpieza en el panel (los que no pudo clasificar quedan como `other` y el generador no los usa).
- Los **nombres** de los ejercicios están en inglés (así viene el dataset). Los pasos sí están en español.
- El limitador de intentos está en memoria: sirve para una sola instancia del servidor.
- Los links personales se guardan tal cual en la base para poder volver a mostrártelos; quien tenga el link entra a esa rutina. Si se filtra, generá uno nuevo.
- Un cuestionario de lesiones no reemplaza tu criterio profesional: revisá la solapa **Revisar**.

## Licencias

El código de este repo es tuyo para licenciarlo como quieras. El catálogo es de [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset): el código y los textos están bajo MIT, pero **las imágenes y GIFs son © Gym visual** (redistribuidos con permiso, con atribución obligatoria, que la app muestra al pie). Por eso el dataset no se sube a este repo. **Antes de cobrar por la app, revisá los términos de Gym visual** para uso comercial.
