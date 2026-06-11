# Bitrix24 Call Dashboard

Небольшой локальный дашборд для мониторинга звонков из Bitrix24 CRM через входящий webhook.

## Что показывает

- всего звонков за период;
- успешные и пропущенные звонки;
- среднюю длительность успешного звонка;
- рейтинг менеджеров по количеству звонков;
- таблицу последних звонков.

## Как запустить

1. Скопируйте `.env.example` в `.env`.
2. Вставьте входящий webhook Bitrix24 в `BITRIX24_WEBHOOK_URL`.
3. Запустите:

```bash
npm start
```

4. Откройте `http://localhost:8787`.

Если `.env` не настроен, приложение запустится в демо-режиме.

## Настройка webhook в Bitrix24

В Bitrix24 нужен входящий webhook с правами:

- `telephony` или доступ к статистике звонков для метода `voximplant.statistic.get`;
- `user` для подтягивания имен сотрудников через `user.get`.

Формат URL:

```text
https://your-company.bitrix24.ru/rest/1/xxxxxxxxxxxxxxxx/
```

## Реальное время

По умолчанию дашборд обновляется polling-запросом каждые 15 секунд. Для мгновенных обновлений можно добавить исходящий webhook/событие Bitrix24 на endpoint:

```text
https://your-public-domain.example/webhook/bitrix/call-end
```

Локальный `localhost` Bitrix24 не увидит, поэтому для проверки события нужен публичный адрес, например через reverse proxy или tunnel.

## Используемые методы Bitrix24

- `voximplant.statistic.get` — список звонков и поля вроде `PORTAL_USER_ID`, `CALL_TYPE`, `CALL_DURATION`, `CALL_FAILED_CODE`.
- `user.get` — имена сотрудников.
