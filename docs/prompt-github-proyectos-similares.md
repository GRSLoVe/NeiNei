# Prompt maestro: hallar proyectos similares en GitHub

Copia el bloque **“Prompt para el asistente”** en ChatGPT, Claude u otro LLM, o úsalo tú como guía. Incluye queries directas para la barra de búsqueda de GitHub.

---

## Prompt para el asistente

Actúa como experto en descubrimiento de repositorios open source.

**Contexto del proyecto de referencia (el mío):**

- Aplicación web **estática** o casi estática (HTML/CSS/JS), sin backend obligatorio.
- Plantillas tipo **formulario de estudio** o **worksheet** (concepto, ejercicio, diario de errores, resumen).
- Enfoque **impresión A4** (`@media print`, márgenes, una página por plantilla).
- **Exportación a PDF** en cliente (p. ej. html2pdf, jsPDF, html2canvas, o “print to PDF”).
- Persistencia en **localStorage** / IndexedDB (opcional datos locales, sin servidor).
- **Filtros o listado** de entradas guardadas (por fecha, título, categoría, tipo).
- Idioma y UX orientados a **estudiantes** (claridad, cajas para escribir, checklists).

**Tarea:**

1. Propón **8–15 búsquedas concretas** para GitHub (caja de búsqueda o API), combinando palabras clave en inglés y español cuando tenga sentido.
2. Para cada búsqueda, indica **qué tipo de repo** esperas encontrar y un **criterio rápido** para descartar ruido.
3. Lista **5–10 temas / etiquetas** (`topics`) habituales en repos parecidos.
4. Opcional: cómo acotar con **“awesome lists”** o ejemplos de `awesome-study`, `awesome-note-taking`, etc.

**Restricciones:**

- Prioriza repos **mantenidos** o al menos útiles como inspiración de UI/UX y arquitectura front.
- No inventes URLs; si nombras repos, que sean **ejemplos ilustrativos** o pide verificación con búsqueda real.

**Salida:** tabla o lista numerada, lista para copiar y pegar en GitHub Search.

---

## Queries listas para GitHub (copiar y pegar)

Prueba combinaciones; GitHub usa OR y calificadores como `language:javascript`, `stars:>10`, `pushed:>2024-01-01`.

```text
worksheet print css A4 javascript
student study template printable html
localStorage form template vanilla javascript
html2pdf study notes
printable study sheet generator
cornell notes pdf generator web
error log study journal app
flashcards print pdf offline
notas estudio plantilla imprimir
"@media print" worksheet language:html
```

Calificadores útiles:

```text
language:JavaScript stars:>5 pushed:>2023-01-01
topic:study topic:notes
```

---

## Variante corta (un solo mensaje al LLM)

Quiero encontrar en GitHub proyectos web parecidos a una app de **hojas de estudio imprimibles** (A4), con **PDF en el navegador**, **localStorage**, plantillas (concepto/ejercicio/error/resumen) y **listado filtrable**. Dame búsquedas exactas para GitHub, criterios para elegir repos y qué mirar en el código (estructura de carpetas, dependencias, si son SPA o estáticos).
