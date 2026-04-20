# Dashboard por Projeto

> Defina o projeto abaixo no formato do slug (exemplo: fe-connect).

```dataviewjs
const projectSlug = "fe-connect";

const events = dv.pages('"projects"')
  .where(p => p.project === projectSlug && (p.type === "dev_log" || p.type === "manual_note"))
  .sort(p => p.event_at, 'desc');

dv.header(2, `Projeto: ${projectSlug}`);
dv.paragraph(`Total de notas: ${events.length}`);

dv.table(
  ["Data", "Tipo", "Branch", "Commits", "Arquivos", "Nota"],
  events.slice(0, 100).map(p => [
    p.event_at,
    p.type,
    p.branch,
    p.commits_count ?? 0,
    p.files_changed ?? 0,
    p.file.link,
  ])
);
```

## Tendencia semanal do projeto

```dataviewjs
const projectSlug = "fe-connect";
const events = dv.pages('"projects"')
  .where(p => p.project === projectSlug && p.event_at && (p.type === "dev_log" || p.type === "manual_note"));

const byWeek = {};
for (const p of events) {
  const d = dv.date(p.event_at);
  const monday = d.minus({ days: (d.weekday - 1) });
  const key = monday.toFormat("yyyy-MM-dd");
  byWeek[key] = (byWeek[key] || 0) + 1;
}

dv.table(
  ["Semana (inicio)", "Eventos"],
  Object.entries(byWeek)
    .sort((a, b) => a[0] < b[0] ? 1 : -1)
    .map(([weekStart, count]) => [weekStart, count])
);
```
