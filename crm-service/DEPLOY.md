# Deployment

This dashboard is a small Node.js app. It must run as a server because the Bitrix24 webhook must stay private.

## Files

- `server.js` - Node.js server and Bitrix24 API proxy
- `public/` - browser dashboard
- `package.json` - start scripts
- `.env.example` - environment variable example

## Environment variables

Set these on your hosting provider:

```text
PORT=8787
BITRIX24_WEBHOOK_URL=https://your-company.bitrix24.kz/rest/user/token/
POLL_INTERVAL_SECONDS=60
```

Do not put the webhook URL into frontend JavaScript.

## Start command

```bash
npm start
```

## Local test

```bash
cp .env.example .env
npm start
```

Then open:

```text
http://localhost:8787
```
