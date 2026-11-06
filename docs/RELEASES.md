# Каналы и выпуск

С 1.2.0 приложение — один пакет `app.soundsense`. Канал (stable / beta) выбирается в настройках и хранится на устройстве (`ss_release_channel` в WebView, `ReleaseChannel` в Android). От канала зависят адрес обновлений (`stable.json` / `beta.json`) и инструменты отладки: журнал, профилировщик, трассировка, нативный watchdog и замер кадров работают только при выбранной бете. Смена канала перезапускает WebView. Отладочный код есть в обеих сборках; `stable`/`beta` при сборке задают только канал по умолчанию.

`config/channels.json` задаёт имена, applicationId и наличие debug-кода (у обоих каналов одинаковые). Номер версии и versionCode для обоих каналов общий: `package.json`. Общие RU/EN-изменения находятся в `src/core/release-notes.json`; канал выбирает команда выпуска.

## Сборка

```sh
npm run build:stable
npm run build:beta
npm run android:apk:stable
npm run android:apk:beta
```

Vite подставляет константы канала при компиляции. В stable динамические импорты `src/debug/` удаляются вместе с реализацией журнала, UI-профилировщиком и их переводами. В Android flavor `stable` содержит пустые реализации диагностических классов; flavor `beta` содержит журнал, watchdog и сбор кадров. Логирование Capacitor bridge отключено в обоих каналах: передача больших payload в системный лог ранее вызывала зависания интерфейса.

Для каждой нативной сборки Gradle берёт собственный `dist/<channel>/` и проверяет `release.json` на совпадение канала, версии, applicationId и debug-флага. Последний результат `cap sync` не может подменить web-ассеты другого flavor. Перед прямым вызовом Gradle нужно собрать соответствующий web-канал и выполнить `cap sync android`.

Генерация ассетов подключена к каждому Android variant через `variant.sources.assets.addGeneratedSourceDirectory` в `android/gradle/web-assets.gradle`. Общий каталог, куда пишет `cap sync`, не используется как источник web-файлов APK. Порядок задач и входные файлы объявлены явно; подход соответствует [Sources API Android Gradle Plugin](https://developer.android.com/reference/tools/gradle-api/8.6/com/android/build/api/variant/SourceDirectories).

Оба итоговых APK имеют Android build type `release`; beta-функции не зависят от `BuildConfig.DEBUG`. Для локальной отладки: `npm run android:apk:beta -- --debug`.

## Проверки

```sh
npm run check
npm run lint
npm test
npm run test:ui
npm run test:channels
```

`test:channels` проверяет production-сборки: общие настройки, отсутствие журнала и записи логов в stable, экспорт журнала с профилем в beta, адрес обновления каждого канала и отсутствие диагностических модулей в stable.

## Публикация

Прежде чем публиковать следующую версию, увеличить `versionCode` и обновить `version` / release notes. Опубликованный APK с тем же именем и другим SHA-256 не заменяется.

```sh
npm run release:stable -- --dry-run
npm run release:beta -- --dry-run
```

Dry run выполняет локальные проверки, сборку и подпись manifest, не публикуя ветку `releases` и не отправляя пост в Telegram. Для подписи нужен локальный ключ обновлений, соответствующий `src/core/update-key.json`. Нормальные команды `release:stable` и `release:beta` кладут APK и подписанный manifest выбранного канала в ветку `releases` (одним коммитом, старые файлы этого канала заменяются) Объявление о версии в канале и форуме публикует бот (`tools/telegram`): он сам замечает новую версию в ветке `releases`. `--telegram` дополнительно отправляет APK файлом в канал; `--skip-build` повторно проверяет готовый APK, включая вложенные web-метаданные. Пример полного набора проверок: `npm run release:beta -- --full-tests`.

Секреты (токен Telegram, прокси) хранятся только в `.release/config.json`; новые APK и подписанные manifest — в `artifacts/android/<channel>/`. Эти каталоги исключены из Git. Telegram можно настроить отдельно как `telegram.stable` и `telegram.beta` либо использовать общий `telegram`.

Подписанный payload содержит `channel`. Stable отклоняет beta и наоборот. Старые manifest без `channel` относятся к stable. Счётчик защиты от отката у beta отдельный. Android дополнительно проверяет package ID, сертификат, размер и SHA-256 APK.

Переименование applicationId означает отдельную установку относительно старого пакета. При первом выпуске новых идентификаторов данные не переносятся автоматически. Каналы stable и beta также хранят данные независимо. Наличие сборок и автоматических тестов не заменяет проверку физического устройства.
