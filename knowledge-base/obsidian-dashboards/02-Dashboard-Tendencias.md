# Dashboard de Tendencias

## Serie diaria (ultimos 60 dias)

```dataviewjs
const cutoff = dv.date("today") - dv.duration("60 days");
const events = dv.pages('"projects"')
  .where(p => p.event_at && (p.type === "dev_log" || p.type === "manual_note"))
  .where(p => dv.date(p.event_at) >= cutoff);

const byDay = {};
for (const p of events) {
  const day = dv.date(p.event_at).toFormat("yyyy-MM-dd");
  byDay[day] = byDay[day] || { total: 0, manuals: 0, pushes: 0, files: 0, insertions: 0, deletions: 0 };
  byDay[day].total += 1;
  if (p.is_manual) {
    byDay[day].manuals += 1;
  } else {
    byDay[day].pushes += 1;
  }
  byDay[day].files += Number(p.files_changed || 0);
  byDay[day].insertions += Number(p.insertions || 0);
  byDay[day].deletions += Number(p.deletions || 0);
}

dv.table(
  ["Dia", "Eventos", "Pushes", "Manuais", "Arquivos", "Insercoes", "Delecoes"],
  Object.entries(byDay)
    .sort((a, b) => a[0] < b[0] ? 1 : -1)
    .map(([day, m]) => [day, m.total, m.pushes, m.manuals, m.files, m.insertions, m.deletions])
);
```

## Top arquivos mais alterados (snapshot)

```dataviewjs
const events = dv.pages('"projects"').where(p => p.type === "dev_log");
const freq = {};
for (const p of events) {
  const content = await dv.io.load(p.file.path);
  const lines = content.split("\n").filter(l => l.startsWith("- A ") || l.startsWith("- M ") || l.startsWith("- D "));
  for (const line of lines) {
    const file = line.slice(4).trim();
    freq[file] = (freq[file] || 0) + 1;
  }
}

dv.table(
  ["Arquivo", "Ocorrencias"],
  Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
);
```
