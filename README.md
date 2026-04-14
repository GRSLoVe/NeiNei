# Hojas de estudio (NeiNei)

<p align="center">
  <img src="public/Logos/Nei2.jpg" alt="NeiNei" width="520" />
</p>

Plantillas A4 (concepto, ejercicio, error, resumen), campos editables, impresión y PDF. Los datos pueden guardarse en **SQLite** en el servidor tras un **login** de un solo usuario, o solo en el navegador si eliges «Solo este navegador» o no hay API disponible.

## Stack

- **Frontend:** HTML, CSS modular (`public/css/app.css`), JavaScript modular (`public/js/`), sesión vía cookies `fetch` con `credentials: 'include'`.
- **Backend:** Node.js 22, Fastify 5, `@fastify/session` (cookie httpOnly), `better-sqlite3`, `bcryptjs`.
- **Despliegue:** una imagen Docker que sirve estáticos y la API en el puerto **3000**; volumen persistente para la base en `/data`.

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose v2 **o** Node.js 22+ para desarrollo local del API.

## Uso rápido (Docker)

1. Copia variables de entorno:

   ```bash
   cp .env.example .env
   ```

   Edita `.env`: define `SESSION_SECRET` (mínimo 32 caracteres), **`ADMIN_EMAIL`** (correo con el que entrarás) y `ADMIN_PASSWORD`. El usuario inicial se crea solo la primera vez que la base está vacía. Si no pones `ADMIN_EMAIL`, se usará `{ADMIN_USER}@cuenta.local` (por ejemplo `admin@cuenta.local`).

   Las **hojas** se guardan siempre ligadas a tu usuario en la base: cada sesión solo ve y edita sus propios datos.

2. Arranca:

   ```bash
   docker compose up --build
   ```

3. Abre [http://localhost:8080](http://localhost:8080) (te lleva a **login**), entra y abre las hojas en **/app.html** al continuar.

Rutas principales: **`/login.html`** (entrada), **`/app.html`** (editor), **`/profile.html`** (perfil y contraseña). Opcional **`/register.html`** si `ALLOW_REGISTRATION=true` en `.env`.

Los datos persisten en el volumen `neinei-data` (archivo SQLite en `/data/neinei.db` dentro del contenedor).

### Solo imagen (sin compose)

```bash
docker build -t neinei:local .
docker run --rm -p 8080:3000 \
  -e SESSION_SECRET=reemplaza_por_cadena_larga_de_al_menos_32_chars \
  -e ADMIN_EMAIL=tu@correo.com \
  -e ADMIN_PASSWORD=tu_contraseña \
  -v neinei-data:/data \
  neinei:local
```

## Desarrollo local (sin Docker)

```bash
cd api
npm install
export SESSION_SECRET="reemplaza_por_cadena_larga_de_al_menos_32_chars"
export ADMIN_EMAIL="tu@correo.com"
export ADMIN_USER=admin
export ADMIN_PASSWORD=dev
export DATA_DIR=./data
npm start
```

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). El servidor sirve `public/` y las rutas `/api/*`.

## API (resumen)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | JSON `{ "email", "password" }` (también acepta `username` por compatibilidad), fija cookie de sesión |
| POST | `/api/auth/logout` | Cierra sesión |
| GET | `/api/auth/me` | Usuario actual o 401 |
| GET | `/api/sheets` | Lista de hojas del usuario (cada ítem incluye `tags`, `errorType`, `reviewLevel`, `lastReviewed`, `nextReview` cuando aplica) |
| POST | `/api/sheets` | Crea hoja (JSON como el `PUT`; 409 si el `id` ya existe) |
| PUT | `/api/sheets/:id` | Crea o actualiza una hoja. Cuerpo: `titulo`, `materia`, `fecha`, `tipo`, `fields`, `layout` (opcional), `tags` (array de strings), `errorType` (solo si `tipo` es `error`: `concepto` \| `procedimiento` \| `signos` \| `otro`). Opcional: `reviewLevel`, `lastReviewed`, `nextReview` (ISO) para importar o sincronizar repaso |
| DELETE | `/api/sheets/:id` | Elimina |
| POST | `/api/sheets/:id/review` | JSON `{ "nivel": 1..5 }` — actualiza repaso espaciado (`last_reviewed`, `next_review`, `review_level`) |
| GET | `/api/review/today` | Hojas con `next_review` no nulo y ya vencido |
| GET | `/api/stats` | Totales, errores, repasos, materias frecuentes y conteos por tipo de error |
| POST | `/api/sheets/import-local` | JSON `{ "records": [...] }` importa o fusiona por `id` conservando repaso cuando el cliente lo envía |
| GET | `/api/auth/options` | `{ registrationOpen }` |
| POST | `/api/auth/register` | JSON `{ "email", "password" }`; solo si `ALLOW_REGISTRATION=true` |
| PATCH | `/api/auth/profile` | JSON `{ "displayName", "bio", "accentColor" }` (`accentColor` vacío = color por defecto; campos omitidos no cambian) |
| PUT | `/api/auth/password` | JSON `{ "currentPassword", "newPassword" }` |

## Importar datos del navegador

Si tenías hojas en `localStorage` (clave `hojasEstudioV1`), tras iniciar sesión usa **Importar desde navegador** en la barra superior (si el cliente detecta datos locales).

## Estructura

- `public/` — `index.html` (redirección), `login.html`, `app.html`, `profile.html`, `register.html`, `css/app.css`, `js/*.js`.
- `api/` — `server.js`, `lib/sheets-helpers.js`, `routes/` (`sheets.js`, `review.js`, `stats.js`), `package.json`.
- `nginx/` — configuración heredada; el flujo por defecto ya no usa Nginx (todo en un solo contenedor Node).

## Commits

Se recomienda [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.).
