# KAU Dashboard: готовая замена

## 1. Render / GitHub: сервис `kau-crm-service`

В репозитории, из которого Render разворачивает `kau-crm-service`, замените:

- `server.js` на `render-crm-service/server.js`
- `package.json` на `render-crm-service/package.json`
- всю папку `public` на `render-crm-service/public`

В Render откройте `kau-crm-service` → Environment и добавьте/обновите:

```text
BITRIX24_WEBHOOK_URL=<новый webhook Bitrix24>
POLL_INTERVAL_SECONDS=60
TWOGIS_API_KEY=<ключ 2ГИС>
TWOGIS_BRANCH_ID=9429940000796152
```

Секреты нельзя вставлять в HTML или публичный GitHub-репозиторий.

После сохранения переменных выполните Manual Deploy → Deploy latest commit.

Проверка после публикации:

```text
https://kau-crm-service.onrender.com/health
https://kau-crm-service.onrender.com/tasks.html
https://kau-crm-service.onrender.com/reviews.html
```

## 2. Tilda: основной KAU Command Center

Откройте HTML-блок страницы основного дашборда и полностью замените его содержимое файлом:

```text
tilda/tilda-embed.html
```

Затем нажмите «Сохранить» и «Опубликовать». В меню появятся:

- Задачи
- Отзывы 2ГИС

## Что уже работает

- 22 активных сотрудника Bitrix24, без уволенных и служебной записи интегратора
- открытые, закрытые и просроченные задачи
- кто поставил, кто отвечает и кто закрыл
- дедлайн, длительность выполнения и наличие файлов
- автообновление задач каждые 30 секунд
- 10 последних отзывов 2ГИС
- рейтинг, общее число отзывов и статус официального ответа
- рекомендация «Что делать» для каждого отзыва
