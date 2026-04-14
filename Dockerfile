# API + estáticos + SQLite (volumen /data).
FROM node:22-alpine AS neinei_editor
WORKDIR /src
COPY editor/package.json editor/package-lock.json ./editor/
RUN cd editor && npm ci
COPY editor/ ./editor/
RUN cd editor && npm run build

FROM node:22-alpine
WORKDIR /app

COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev

COPY api/server.js ./
COPY api/lib ./lib
COPY api/routes ./routes
COPY public ./public
COPY --from=neinei_editor /src/public/js/neinei-cm-editor.js ./public/js/
COPY --from=neinei_editor /src/public/js/neinei-cm-editor.js.map ./public/js/
COPY --from=neinei_editor /src/public/js/neinei-editor.css ./public/js/

ENV NODE_ENV=production
ENV PUBLIC_DIR=/app/public
ENV DATA_DIR=/data

EXPOSE 3000
CMD ["node", "server.js"]
