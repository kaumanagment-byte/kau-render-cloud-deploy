# KAU Command Center: cloud deploy without local/ngrok

This folder contains four Render-ready services:

- `api-proxy` - public API used by Tilda.
- `ads-service` - Meta, TikTok, Google Ads data.
- `crm-service` - Bitrix24 CRM data.
- `intelligence-service` - LiveDune, market signals, KAU mentions.

Do not upload real `.env` files or token/session files to GitHub. Use the `.env.render.example` files only as checklists for Render Environment Variables.

## Recommended Render setup

Create four Web Services in Render from this repository/folder structure.

### 1. Ads service

Service name:

```text
kau-ads-service
```

Root directory:

```text
ads-service
```

Runtime:

```text
Node
```

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

Copy keys from `ads-service/.env.render.example` and fill values from your current local ads `.env`.

Important:

```text
BASE_URL=https://kau-ads-service.onrender.com
```

In Meta Developers, add this OAuth redirect URI:

```text
https://kau-ads-service.onrender.com/api/meta/callback
```

### 2. CRM service

Service name:

```text
kau-crm-service
```

Root directory:

```text
crm-service
```

Runtime:

```text
Node
```

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

Copy keys from `crm-service/.env.render.example` and fill `BITRIX24_WEBHOOK_URL` from your current local CRM `.env`.

### 3. Intelligence service

Service name:

```text
kau-intelligence-service
```

Root directory:

```text
intelligence-service
```

Runtime:

```text
Python
```

Build command:

```text
pip install -r requirements.txt
```

Start command:

```text
python dashboard_server.py
```

Environment variables:

Copy keys from `intelligence-service/.env.render.example`.

Note: this package includes the current `data.sqlite` seed. For continuous collection/history on Render, add a Persistent Disk later or schedule `/api/collect`.

### 4. Main API proxy

Service name:

```text
kau-command-center-api
```

Root directory:

```text
api-proxy
```

Runtime:

```text
Node
```

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

```text
ADS_BASE_URL=https://kau-ads-service.onrender.com
CRM_BASE_URL=https://kau-crm-service.onrender.com
INTELLIGENCE_BASE_URL=https://kau-intelligence-service.onrender.com
TILDA_ORIGIN=*
```

## Test URLs

After deploy, open:

```text
https://kau-ads-service.onrender.com/health
https://kau-crm-service.onrender.com/health
https://kau-intelligence-service.onrender.com/health
https://kau-command-center-api.onrender.com/health
https://kau-command-center-api.onrender.com/api/unified?range=7d
```

The final `/api/unified` response should show all source objects as `ok: true`.

## Tilda

Keep using the latest `tilda-embed.html` from:

```text
../kau-tilda-render-update/tilda-embed.html
```

It already points to:

```text
https://kau-command-center-api.onrender.com
```

After the Render services are live, republish the Tilda page and hard-refresh it with `Ctrl + F5`.

## Why this removes local dependency

Old chain:

```text
Tilda -> Render proxy -> ngrok -> local laptop services
```

New chain:

```text
Tilda -> Render proxy -> Render ads/crm/intelligence services
```

No ngrok, no running laptop, no local ports.
