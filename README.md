# Простой Telegram-бот (Telegraf)

## Быстрый старт
1. Установите Node.js LTS.
2. Получите токен у BotFather в Telegram.
3. Создайте `.env` в корне и добавьте:
   - `BOT_TOKEN=...`
   - опционально `WEBAPP_URL=https://ваш-домен/miniapp`
4. Запуск: `npm start`.

Бот поддерживает оформление карт: выбор страны → банка → карточка продукта, кнопка «Отправить контакт». Если задан `WEBAPP_URL`, появится кнопка открытия мини‑приложения.

## Мини‑приложение (WebApp) и GitHub Pages

- Фронтенд мини‑приложения лежит в папке `webapp` (и прод-копия в `docs/`).
- Для публикации на GitHub Pages:
  1. Включите Pages: Settings → Pages → Source: Deploy from a branch
  2. Branch: `main`, Folder: `/docs`
  3. Возьмите выданный URL и добавьте в `.env`:
     - `WEBAPP_URL=https://<user>.github.io/<repo>/`
  4. Перезапустите бота: `npm start`

