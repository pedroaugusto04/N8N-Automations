# Dashboard de Riscos e Follow-up

> Opcional: comece a incluir tags como risk-high, risk-medium, incident, rollback, perf em notas manuais ou eventos relevantes.

## Notas com sinais de risco por tag

```dataview
TABLE event_at as Data, project as Projeto, tags as Tags, file.link as Nota
FROM "projects"
WHERE contains(tags, "risk-high") OR contains(tags, "risk-medium") OR contains(tags, "incident") OR contains(tags, "rollback")
SORT event_at DESC
```

## Notas com texto de risco na secao Riscos

```dataviewjs
const events = dv.pages('"projects"')
  .where(p => p.event_at && (p.type === "dev_log" || p.type === "manual_note"));

const keywords = ["risco", "regress", "erro", "falha", "rollback", "instabil", "alerta"];
const flagged = [];
for (const p of events) {
  const content = (await dv.io.load(p.file.path)).toLowerCase();
  if (keywords.some(k => content.includes(k))) {
    flagged.push(p);
  }
}

dv.table(
  ["Data", "Projeto", "Tipo", "Nota"],
  flagged
    .sort((a, b) => String(a.event_at) < String(b.event_at) ? 1 : -1)
    .slice(0, 100)
    .map(p => [p.event_at, p.project, p.type, p.file.link])
);
```
