# Dashboard Geral

> Requer plugin Dataview habilitado no Obsidian.

## Ultimos eventos

```dataview
TABLE event_at as Data, project as Projeto, type as Tipo, branch as Branch, commits_count as Commits, files_changed as Arquivos, analysis_source as IA, file.link as Nota
FROM "projects"
WHERE type = "dev_log" OR type = "manual_note"
SORT event_at DESC
LIMIT 100
```

## Eventos por projeto (ultimos 30 dias)

```dataviewjs
const cutoff = dv.date("today") - dv.duration("30 days");
const pages = dv.pages('"projects"')
  .where(p => p.event_at && (p.type === "dev_log" || p.type === "manual_note"))
  .where(p => dv.date(p.event_at) >= cutoff);

const grouped = {};
for (const p of pages) {
  grouped[p.project] = (grouped[p.project] || 0) + 1;
}

dv.table(
  ["Projeto", "Eventos (30d)"],
  Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .map(([project, count]) => [project, count])
);
```

## Carga de mudancas (ultimos 30 dias)

```dataview
TABLE sum(files_changed) as Arquivos, sum(insertions) as Insercoes, sum(deletions) as Delecoes
FROM "projects"
WHERE type = "dev_log" AND event_at >= date(today) - dur(30 days)
GROUP BY project
SORT sum(files_changed) DESC
```
