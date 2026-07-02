# Три отдельных сервиса KAU

Загрузите три папки в корень репозитория `kau-render-cloud-deploy`, рядом с существующими `ads-service`, `api-proxy`, `crm-service` и `intelligence-service`:

```text
reviews-service/
tasks-service/
enrollment-service/
```

Существующие папки не заменять и не удалять.

## Render: отзывы 2ГИС

- Name: `kau-reviews-service`
- Root Directory: `reviews-service`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Environment:

```text
TWOGIS_API_KEY=<ключ 2ГИС>
TWOGIS_BRANCH_ID=9429940000796152
```

## Render: задачи Bitrix24

- Name: `kau-tasks-service`
- Root Directory: `tasks-service`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Environment:

```text
BITRIX24_WEBHOOK_URL=<webhook Bitrix24>
POLL_INTERVAL_SECONDS=60
```

## Render: план и прогноз набора

- Name: `kau-enrollment-service`
- Root Directory: `enrollment-service`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Environment:

```text
ENROLLMENT_XLSX_URL=<публичная ссылка SharePoint>
ENROLLMENT_TARGET_DATE=2026-08-25
ENROLLMENT_CACHE_SECONDS=300
```

SharePoint-файл должен иметь доступ «Все, у кого есть ссылка». Закрытая ссылка без Microsoft Graph не загрузится из Render.
