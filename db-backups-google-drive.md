Fluxo `DB Backups to Google Drive`

Premissas:
- O node `Run Remote Backups` precisa de uma credencial SSH configurada no n8n.
- O host remoto precisa ter `python3`, `bash`, `find`, `gzip`, `rclone` e os clientes de dump dos bancos usados (`pg_dump`, `mysqldump`, `mongodump`).
- O `rclone` remoto deve ter um remote já autenticado para Google Drive, por exemplo `gdrive`.

Rotacao sugerida:
- Local: `7` dias.
- Google Drive: `30` dias.

Estrutura dos backups:
- Local: `<DB_BACKUP_LOCAL_DIR>/<nome-do-banco>/YYYY/MM/DD/HHMMSSZ/<arquivo-com-timestamp>`
- Google Drive: `<DB_BACKUP_DRIVE_FOLDER>/<nome-do-banco>/YYYY/MM/DD/HHMMSSZ/<arquivo-com-timestamp>`

Variaveis adicionadas ao `.env`:
- `DB_BACKUP_CRON`
- `DB_BACKUP_TIMEZONE`
- `DB_BACKUP_LOCAL_DIR`
- `DB_BACKUP_DRIVE_REMOTE`
- `DB_BACKUP_DRIVE_FOLDER`
- `DB_BACKUP_LOCAL_RETENTION_DAYS`
- `DB_BACKUP_DRIVE_RETENTION_DAYS`
- `DB_BACKUP_TARGETS_JSON`

Formato esperado para `DB_BACKUP_TARGETS_JSON`:

```json
[
  {
    "name": "feconect-postgres",
    "type": "postgres",
    "host": "127.0.0.1",
    "port": 5432,
    "database": "feconect",
    "username": "postgres",
    "password": "change-me",
    "extra_args": "--clean --if-exists"
  },
  {
    "name": "app-mysql",
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "database": "app",
    "username": "root",
    "password": "change-me"
  },
  {
    "name": "analytics-mongo",
    "type": "mongodb",
    "connection_uri": "mongodb://user:pass@127.0.0.1:27017/admin",
    "database": "analytics"
  }
]
```

Importacao:
- Importe [db-backups-google-drive.json](/home/ubuntu/n8n/db-backups-google-drive.json).
- Associe a credencial SSH no node `Run Remote Backups`.
- Ajuste o `.env`.
- Reinicie o container do n8n para recarregar as variaveis de ambiente.
