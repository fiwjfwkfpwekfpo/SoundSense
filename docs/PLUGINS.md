# Плагины SoundSense — API 1.1 (бета)

Плагины есть только в бета-канале. Один пакет `.ssplugin` работает на Android и будет работать на ПК: в API нет ничего платформенного.

## Пакет

Zip-архив с расширением `.ssplugin`, не больше 2 МБ:

```
manifest.json
main.js          ES-модуль, точка входа (до 1 МБ)
icon.svg         необязательно
i18n/ru.json     необязательно
```

Собрать из папки: `npm run plugin:pack -- plugins/src/play-counter` → `artifacts/plugins/<id>-<version>.ssplugin`.

```json
{
  "id": "dev.author.name",
  "name": "Название",
  "version": "1.0.0",
  "apiVersion": "1.1",
  "author": "Автор",
  "description": "Что делает плагин",
  "entry": "main.js",
  "permissions": ["player.read", "network:api.example.com"],
  "settings": [
    { "key": "enabled", "type": "toggle", "label": "Подпись", "default": true },
    { "key": "token", "type": "text", "label": "Токен", "default": "", "secret": true },
    { "key": "mode", "type": "select", "label": "Режим", "default": "a", "options": [{ "value": "a", "label": "A" }] }
  ]
}
```

`apiVersion`: мажорная версия должна совпадать, минорная — не больше, чем у приложения.

## Разрешения

| Разрешение | Что даёт |
|---|---|
| `player.read` | состояние плеера, события трека и воспроизведения |
| `player.control` | play / pause / next / previous / seek |
| `library.read` | лайки, плейлисты, события лайков |
| `library.write` | ставить и снимать лайки |
| `notify` | уведомления (не чаще раза в 2 с) |
| `ui.trackMenu` | до 5 пунктов в меню трека |
| `ui.playerButton` | до 2 кнопок в плеере (рядом с лайком и текстом) |
| `ui.screen` | свой экран (кнопка «Открыть» в списке плагинов) |
| `provider.lyrics` | до 3 источников текстов |
| `network:<host>` | HTTPS-запросы к этому хосту; `network:*.example.com` — к домену и поддоменам |

Плагин ставится **выключенным**. Пользователь видит разрешения человеческими словами и включает плагин, это и есть согласие. Любое разрешение можно отозвать, после этого плагин перезапускается. Если обновление просит новые разрешения, плагин выключается до нового согласия. Вызов без разрешения отклоняется ошибкой, приложение продолжает работать.

## Модуль

```js
export async function activate(api) { /* подписки, регистрации */ }
export function deactivate() { /* необязательно, до 0.8 с */ }
```

Все методы асинхронные, кроме `on`, `settings.get/all/onChange` и `log`.

| | |
|---|---|
| `api.plugin` | `{ id, name, version }` |
| `api.locale`, `api.apiVersion` | язык приложения, версия API |
| `api.on(event, handler)` | подписка, возвращает отписку. События: `track:change` `{ track, previous }`, `player:play` / `player:pause` `{ track, position }`, `player:seek` `{ position }` (нужно `player.read`), `library:like` / `library:unlike` `{ track }` (нужно `library.read`) |
| `api.player.state()` | `{ track, playing, position, index, queueLength }` |
| `api.player.play/pause/next/previous()`, `seek(seconds)` | |
| `api.library.isLiked(id)`, `likes(limit)`, `playlists()`, `setLiked(id, liked)` | |
| `api.net.fetch(url, { method, headers, body })` | GET/POST, тело до 256 КБ, ответ до 2 МБ; `{ status, ok, text(), json() }`. До 4 запросов одновременно и 120 в минуту. Cookie, Host, Origin, Referer не передаются |
| `api.storage.get/set/delete/keys` | своё хранилище, значения JSON, до 512 КБ на плагин |
| `api.settings.get(key)`, `all()`, `set(key, value)`, `onChange(handler)` | настройки из манифеста; экран рисует приложение |
| `api.ui.toast(text)` | уведомление с именем плагина |
| `api.ui.addTrackMenuItem({ id, title, icon?, onSelect(track) })` | |
| `api.ui.addPlayerButton({ id, title, icon?, onPress(track) })` | `icon` из набора: heart, bell, music, lyrics, queue, plus, download, artist, share, check, clock, sliders, search, library, volume, sun, moon, arrow-up-right |
| `api.ui.setScreen({ title, content })` | экран из элементов (ниже); вызывай снова, чтобы обновить |
| `api.ui.onAction(handler(action, value))` | нажатия на экране: `row` и `button` — без значения, `toggle` — новое `true/false`, `input` — текст |
| `api.registerLyrics({ id, name, find(track) })` | `find` возвращает `{ lines: [{ time, text }] }` (синхронный), `{ text }` (обычный) или `null`; ответ нужен за 12 с |
| `api.log(...values)` | в журнал диагностики |

Трек для плагина: `{ id, title, artist, album?, duration, liked, source }`. Ссылок на поток, токенов и путей к файлам плагин не видит.

## Экран плагина

Плагин описывает экран данными, приложение рисует его своими компонентами в текущем стиле и цветах. Чужой разметки и стилей нет, поэтому плагин всегда выглядит «родным».

```js
api.ui.setScreen({ title: 'Мой плагин', content: [
  { type: 'section', title: 'Раздел', children: [
    { type: 'row', title: 'Строка', subtitle: 'подпись', action: 'open' },
    { type: 'toggle', label: 'Переключатель', value: true, action: 'flag' },
    { type: 'input', label: 'Поле', value: '', placeholder: '…', action: 'name' },
  ] },
  { type: 'text', text: 'Обычный текст', muted: true },
  { type: 'button', title: 'Кнопка', action: 'go', variant: 'secondary' },
  { type: 'empty', text: 'Пусто' },
] });
```

Не больше 400 элементов и 5 уровней вложенности. Неизвестный элемент — ошибка, экран не меняется.

## Песочница и надёжность

- У каждого плагина свой Worker. В нём удалены `fetch`, `XMLHttpRequest`, сокеты, `EventSource`, `IndexedDB`, `caches`, `importScripts` и вложенные воркеры. Загрузка кода из интернета запрещена политикой CSP: выполняется только код из пакета.
- Плагин останавливается с понятной причиной, если не запустился за 10 с, не отвечает 15 с, присылает больше 10 ошибок в минуту или больше 300 запросов за 10 с. Остальное приложение работает дальше.
- Источники текстов (встроенные и из плагинов) ограничены 15 с, поиск потока — 30 с на поставщика.
- Плагины не работают при выключенном экране на Android (WebView спит). Музыка и переключение треков от этого не зависят.

## Каталог плагинов

Проверенные плагины лежат в репозитории: исходники в `plugins/src/<имя>/`, собранные пакеты в `plugins/packages/`, список в `plugins/catalog.json`. В приложении: **Плагины → Каталог плагинов → Скачать**. Приложение проверяет размер и SHA-256 из каталога, плагин ставится выключенным — разрешения включаешь сам.

| Плагин | Что делает | Доступ в сеть |
|---|---|---|
| Now Playing в Discord | сообщение с текущим треком в канал через вебхук | `discord.com` |
| Скробблер ListenBrainz | засчитывает прослушивания, «Сейчас играет» | `api.listenbrainz.org` |
| Таймер сна | пауза через 15–60 минут или после трека | нет |
| Счётчик прослушиваний | топ треков, пример API | нет |
| lyrics.ovh | источник текстов | `api.lyrics.ovh` |

Добавить свой плагин в каталог: положить папку с `manifest.json` (обязательны `name` и `description`), `main.js` и по желанию `icon.svg` в `plugins/src/`, выполнить `npm run plugin:catalog` и отправить pull request. Номер версии в манифесте нужно повышать при каждом изменении.

Rich Presence Discord (значок в профиле) требует локального сокета Discord; песочница плагинов его намеренно не даёт, поэтому плагин пишет в канал через вебхук.

## Примеры

- `plugins/src/play-counter`: события, хранилище, пункт меню, кнопка в плеере, свой экран, уведомления, настройка.
- `plugins/src/lyrics-ovh`: источник текстов через сеть.
- `plugins/src/discord-now-playing`, `listenbrainz-scrobbler`: сеть, настройки с секретным полем, таймеры.
- `plugins/src/sleep-timer`: управление плеером, экран, кнопка в плеере.

## Дальше (v1.x)

Свои источники музыки (`provider.source`), импорт (`provider.import`), подпись авторов, режим разработчика с загрузкой из папки.

## Настройки во вкладках приложения

У настройки в `manifest.json` может быть поле `tab`: `appearance`, `playback`, `sound`, `sources`, `sync`, `storage` или `app`. Такая настройка показывается ещё и в этой вкладке «Настроек» — под иконкой плагина (`icon.svg`) и его названием, с отметкой «Плагин». Без `tab` настройка видна только в карточке плагина.

```json
{ "key": "scrobble", "type": "toggle", "label": "Скробблить", "default": true, "tab": "playback" }
```
