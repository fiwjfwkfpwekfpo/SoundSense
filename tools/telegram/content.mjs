/** All texts of the channel and the forum: Russian first, then English, with quotes. Topic names are English. */
import { links } from './lib.mjs';

const foot = `<a href="${links.repo}">GitHub</a> · <a href="${links.channel}">Channel</a> · <a href="${links.forum}">Forum</a>`;

export const descriptions = {
  channel: 'SoundSense — личный плеер для Android и ПК. Новые версии, плагины и новости.\nSoundSense — a personal music player for Android and PC. Releases, plugins, news.\nGitHub: github.com/fiwjfwkfpwekfpo/SoundSense',
  group: 'Форум SoundSense: идеи, баги, помощь и плагины.\nSoundSense forum: ideas, bugs, help and plugins.\nКанал / Channel: @OpenSoundSense',
};

export const channelRules = `🎧 <b>SoundSense</b>
<i>Личный музыкальный плеер для Android и ПК</i>
<i>A personal music player for Android and PC</i>

🇷🇺 <b>О канале</b>
<blockquote expandable>• Здесь выходят новые версии: Android, ПК, stable и beta
• Новости и новые плагины из каталога
• Обновления приходят и в самом приложении — скачивать вручную не обязательно
• Обсуждение, идеи и баги — на форуме: ${links.forum}</blockquote>

🇬🇧 <b>About</b>
<blockquote expandable>• New versions are posted here: Android, PC, stable and beta
• News and new plugins from the catalog
• Updates also arrive inside the app — no need to download manually
• Discussion, ideas and bugs live in the forum: ${links.forum}</blockquote>

${foot}`;

const rulesCommon = {
  ru: ['Будь вежлив: без оскорблений, травли и спама', 'Пиши по теме раздела, так проще искать', 'Перед новой темой загляни в поиск: возможно, ответ уже есть', 'Не публикуй токены, пароли и личные данные (в логах их тоже скрывай)'],
  en: ['Be kind: no insults, harassment or spam', 'Stay on topic so things are easy to find', 'Search before posting, the answer may already be there', 'Never post tokens, passwords or personal data (hide them in logs too)'],
};
const block = (ru, en, extra = {}) => `<b>🇷🇺 Правила</b>
<blockquote expandable>${[...(extra.ru ?? []), ...rulesCommon.ru].map(line => `• ${line}`).join('\n')}</blockquote>
<b>🇬🇧 Rules</b>
<blockquote expandable>${[...(extra.en ?? []), ...rulesCommon.en].map(line => `• ${line}`).join('\n')}</blockquote>`;

/** key → { name, color, close?, text } */
export const topics = {
  releases: { name: 'Releases', color: 9367192, close: true, text: `📦 <b>Releases</b>
<i>Новые версии приходят сюда автоматически / New versions are posted here automatically</i>

<blockquote>🇷🇺 Раздел только для чтения. Обсуждение новых версий — в теме Feedback.
🇬🇧 Read-only. Discuss new versions in the Feedback topic.</blockquote>
⬇️ <a href="${links.releases}">Downloads / Скачать</a>` },
  suggestions: { name: 'Suggestions', color: 16766590, text: `💡 <b>Suggestions / Предложения</b>
<i>Расскажи, каким должен быть SoundSense / Tell us what SoundSense should become</i>

🇷🇺 <b>Как оформить идею</b>
<blockquote expandable>• <b>Идея:</b> что добавить или изменить
• <b>Зачем:</b> какую задачу это решает
• <b>Где:</b> Android, ПК или оба
• Одна идея — одно сообщение, так её легче обсуждать
• Поддержать идею можно реакцией 👍</blockquote>
🇬🇧 <b>How to post an idea</b>
<blockquote expandable>• <b>Idea:</b> what to add or change
• <b>Why:</b> the problem it solves
• <b>Where:</b> Android, PC or both
• One idea per message keeps the discussion focused
• Support an idea with a 👍 reaction</blockquote>

${block('', '', { ru: ['Не дублируй чужие идеи, поддержи их реакцией'], en: ['Do not duplicate ideas, support them with a reaction'] })}
<blockquote>#idea  #suggestion</blockquote>` },
  bugs: { name: 'Bug Reports', color: 16478047, text: `🐞 <b>Bug Reports / Ошибки</b>

🇷🇺 <b>Что написать</b>
<blockquote expandable>• Версия приложения (Настройки → О приложении) и канал: stable или beta
• Устройство и система: модель телефона, Android, или ПК и дистрибутив
• Что делал, что ожидал и что произошло
• Скриншот или запись экрана, если ошибка видна
• В beta: Настройки → журнал → «Экспорт» (токены в журнале скрываются)</blockquote>
🇬🇧 <b>What to include</b>
<blockquote expandable>• App version (Settings → About) and channel: stable or beta
• Device and system: phone model and Android, or PC and distro
• What you did, what you expected and what happened
• A screenshot or screen recording if the bug is visible
• In beta: Settings → log → “Export” (tokens are hidden in the log)</blockquote>

${block('', '')}
<blockquote>#bug  #crash</blockquote>` },
  help: { name: 'Help & Support', color: 7322096, text: `❓ <b>Help &amp; Support / Помощь</b>
<i>Вопросы по установке, импорту, синхронизации и настройкам / Install, import, sync and settings questions</i>

${block('', '', { ru: ['Укажи, что именно не получается и на каком устройстве'], en: ['Say what exactly fails and on which device'] })}
<blockquote>#question</blockquote>` },
  plugins: { name: 'Plugins', color: 13338331, text: `🧩 <b>Plugins / Плагины</b>
<i>Каталог проверенных плагинов и разработка своих / The catalog of reviewed plugins and writing your own</i>

🇷🇺 <b>Что здесь</b>
<blockquote expandable>• Новые плагины из каталога появляются здесь автоматически
• Установка: Плагины → Каталог плагинов → Скачать
• Свой плагин: папка в <code>plugins/src</code>, затем pull request
• Плагин ставится выключенным: смотри разрешения перед включением</blockquote>
🇬🇧 <b>What is here</b>
<blockquote expandable>• New catalog plugins are posted here automatically
• Install: Plugins → Plugin catalog → Get
• Your own plugin: a folder in <code>plugins/src</code>, then a pull request
• Plugins install switched off: review the permissions before enabling</blockquote>

${block('', '', { ru: ['Не публикуй плагины, которые собирают данные без ведома пользователя'], en: ['No plugins that collect data without the user knowing'] })}
📚 <a href="${links.plugins}">Catalog</a> · <a href="${links.repo}/blob/main/docs/PLUGINS.md">API docs</a>` },
  themes: { name: 'Themes & Screenshots', color: 16749490, text: `🎨 <b>Themes &amp; Screenshots</b>
<i>Покажи свой стиль, цвета и анимации / Show your style, colors and animations</i>

<blockquote>🇷🇺 Скриншоты оформления, свои пакеты цветов и стилей, находки по настройкам.
🇬🇧 Screenshots of your setup, your own color and style packs, settings tips.</blockquote>

${block('', '', { ru: ['Перед публикацией скрой названия личных плейлистов и аккаунтов'], en: ['Hide personal playlist and account names before posting'] })}` },
  offtopic: { name: 'Off-topic', color: 16766590, text: `💬 <b>Off-topic / Оффтоп</b>
<i>Музыка, разговоры и всё остальное / Music, chat and everything else</i>

${block('', '', { ru: ['Здесь можно болтать, но без политики и рекламы', 'Делись музыкой, которая зашла'], en: ['Chat freely, but no politics or ads', 'Share music you like'] })}` },
};

export const generalRules = `👋 <b>Welcome to SoundSense</b>
<i>Добро пожаловать на форум SoundSense</i>

🧭 <b>Темы / Topics</b>
<blockquote>📦 Releases — новые версии / new versions
💡 Suggestions — идеи / ideas
🐞 Bug Reports — ошибки / bugs
❓ Help &amp; Support — помощь / help
🧩 Plugins — плагины / plugins
🎨 Themes &amp; Screenshots — оформление / looks
💬 Off-topic — оффтоп</blockquote>

${block('', '')}
${foot}`;

export function releaseMessage({ version, channel, notes, platforms, links: files, size }) {
  const icon = { android: '📱 Android', 'linux-appimage': '🖥 Linux (AppImage)', windows: '🪟 Windows' };
  const kind = channel === 'beta' ? '🧪 beta' : '✅ stable';
  const quoteLines = list => `<blockquote expandable>${list.map(line => `• ${line.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}`).join('\n')}</blockquote>`;
  return `🎧 <b>SoundSense ${version}</b>  ·  ${kind}
${platforms.map(name => icon[name] ?? name).join('  ·  ')}${size ? `  ·  ${size} MB` : ''}
${channel === 'beta' ? '\n⚠️ <i>Бета: возможны ошибки / Beta: bugs are possible</i>\n' : ''}
🇷🇺 <b>Что нового</b>
${quoteLines(notes.ru)}
🇬🇧 <b>What's new</b>
${quoteLines(notes.en)}

🔄 <i>Приложение обновится само: Настройки → О приложении.
The app updates itself: Settings → About.</i>
⬇️ ${files.map((file, i) => `<a href="${file}">${i ? `Download ${i + 1}` : 'Download / Скачать'}</a>`).join(' · ')}  ·  <a href="${links.releases}">All builds</a>
#release #${channel}`;
}

export function pluginsMessage(entries) {
  const lines = entries.map(entry => `${entry.isNew ? '🆕' : '⬆️'} <b>${entry.name.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</b> <code>${entry.version}</code>\n<blockquote>${entry.description.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</blockquote>`);
  return `🧩 <b>Plugin catalog / Каталог плагинов</b>
<i>${entries.some(entry => entry.isNew) ? 'Новые и обновлённые плагины / New and updated plugins' : 'Обновлённые плагины / Updated plugins'}</i>

${lines.join('\n\n')}

📥 <i>Плагины → Каталог плагинов → Скачать / Plugins → Plugin catalog → Get</i>
<a href="${links.plugins}">Catalog on GitHub</a>
#plugins`;
}
