# Telegram bot

Оформляет канал и форум SoundSense и сообщает о новых версиях и плагинах.
Sets up the SoundSense channel and forum and announces new releases and plugins.

- `setup.mjs` — описания, темы форума (на английском), правила: сообщение отправляется, закрепляется тихо, служебное сообщение о закреплении удаляется. Повторный запуск правит правила на месте.
- `watch.mjs` — раз в 5 минут читает ветку `releases` (`stable.json`, `beta.json`) и `plugins/catalog.json` и пишет в канал и в нужную тему форума, на русском и английском.
- `content.mjs` — все тексты. `lib.mjs` — клиент Bot API. `soundsense-bot.service` — unit для systemd.

Переменные: `TG_TOKEN` (обязательно), `TG_CHANNEL`, `TG_GROUP`, `REPO`, `STATE_DIR`, `POLL_SECONDS`. Токен хранится только в окружении сервера, не в Git.
Нужен Node.js 20+ и права администратора бота: публикация и закрепление, удаление сообщений, управление темами.
