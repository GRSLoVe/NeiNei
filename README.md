# Hojas de estudio

App estática: plantillas A4 (concepto, ejercicio, error, resumen), campos editables, datos en `localStorage`, impresión y PDF.

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose v2.

## Uso rápido

```bash
cd hojas-estudio
docker compose up --build
```

Abre [http://localhost:8080](http://localhost:8080).

## Solo imagen (sin compose)

```bash
docker build -t hojas-estudio:local .
docker run --rm -p 8080:80 hojas-estudio:local
```

## Estructura

- `public/` — archivos servidos (HTML, en el futuro CSS/JS si separas).
- `nginx/default.conf` — servidor Nginx dentro del contenedor.
- `docs/prompt-github-proyectos-similares.md` — prompt maestro para buscar repos parecidos en GitHub.

Los datos guardados siguen viviendo solo en el **navegador del cliente**; el contenedor no guarda base de datos.
