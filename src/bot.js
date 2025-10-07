require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const express = require('express');
const https = require('https');

const token = process.env.BOT_TOKEN;
const webAppBaseUrl = process.env.WEBAPP_URL || '';
function isHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}
const PORT = parseInt(process.env.PORT || '3000', 10);
const CERT_KEY = process.env.CERT_KEY || '';
const CERT_CRT = process.env.CERT_CRT || '';
if (!token) {
  console.error('Не найден BOT_TOKEN в .env. Создайте .env и укажите BOT_TOKEN=...');
  process.exit(1);
}

const bot = new Telegraf(token);

// Регистрация команд в интерфейсе клиента Telegram
bot.telegram.setMyCommands([
  { command: 'start', description: 'Запустить бота' },
  { command: 'menu', description: 'Показать меню' },
  { command: 'buy', description: 'Оформить карту' }
]);

// Кнопки меню
const mainMenu = Markup.keyboard([
  ['Оформить карту'],
  ['Скрыть меню']
]).resize();

// Чтение и подготовка продуктовой матрицы (CSV)
const csvPath = path.resolve(__dirname, '../Table/продукт_матрица_Продуктовая_матрица.csv');
let offeringsByCountry = new Map();
let countriesList = [];

function loadOfferings() {
  const csvBuffer = fs.readFileSync(csvPath);
  const records = parse(csvBuffer, { relax_quotes: true, skip_empty_lines: false });

  // Ожидаем структуру как в предоставленном файле: строки — атрибуты, столбцы — продукты/банки
  // Столбец 0 — названия атрибутов, строка 0 — заголовок "Банк"; дальнейшие столбцы — банки
  // Строка 1 — "Страна" и далее страны по столбцам
  if (!records || records.length < 3) return;

  const headerRow = records[0]; // ["Банк", bank1, bank2, ...]
  const countryRow = records[1]; // ["Страна", country1, country2, ...]

  const attributeRows = records.slice(2); // остальные атрибуты

  const products = [];
  for (let col = 1; col < headerRow.length; col += 1) {
    const bankName = (headerRow[col] || '').toString().trim();
    const countryName = (countryRow[col] || '').toString().trim();
    if (!bankName || !countryName) continue;

    const product = { bank: bankName, country: countryName, attributes: {} };
    for (const row of attributeRows) {
      const attr = (row[0] || '').toString().trim();
      const val = (row[col] || '').toString().trim();
      if (!attr) continue;
      product.attributes[attr] = val;
    }
    products.push(product);
  }

  const map = new Map();
  for (const p of products) {
    if (!map.has(p.country)) map.set(p.country, []);
    map.get(p.country).push(p);
  }
  offeringsByCountry = map;
  countriesList = Array.from(map.keys());
}

function buildKeyboardFromList(items, perRow) {
  const rows = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow));
  }
  return Markup.keyboard(rows).resize();
}

function formatProductInfo(p) {
  const a = p.attributes;
  const lines = [];
  if (a['Сроки изготовления']) lines.push(`Сроки: ${a['Сроки изготовления']}`);
  if (a['Цена']) lines.push(`Цена: ${a['Цена']}`);
  if (a['Документы']) lines.push(`Документы: ${a['Документы']}`);
  if (a['Платёжная система']) lines.push(`ПС: ${a['Платёжная система']}`);
  if (a['Платёжная валюта']) lines.push(`Валюта: ${a['Платёжная валюта']}`);
  if (a['Стоимость обслуживания']) lines.push(`Обслуживание: ${a['Стоимость обслуживания']}`);
  if (a['SWIFT']) lines.push(`SWIFT: ${a['SWIFT']}`);
  if (a['Срок действия']) lines.push(`Срок действия: ${a['Срок действия']}`);
  if (a['Пополнение из России']) lines.push(`Пополнение из РФ: ${a['Пополнение из России']}`);
  return [`Страна: ${p.country}`, `Банк: ${p.bank}`, ...lines].join('\n');
}

// Память сессий в памяти процесса
const userState = new Map(); // userId -> { step, country, bank }
const adminUsernames = new Set(['mixakun', 'kasim_saidi']);
const adminChatIds = new Set();

loadOfferings();

bot.start((ctx) => {
  const uname = (ctx.from.username || '').toLowerCase();
  if (adminUsernames.has(uname)) {
    adminChatIds.add(ctx.chat.id);
  }
  return ctx.reply('Привет! Нажмите «Оформить карту», чтобы начать.', mainMenu);
});

bot.command('menu', (ctx) => ctx.reply('Меню открыто. Выберите действие:', mainMenu));

bot.command('buy', async (ctx) => {
  if (!countriesList.length) {
    return ctx.reply('Данные о продуктах недоступны. Проверьте CSV.', mainMenu);
  }
  const uid = ctx.from.id;
  userState.set(uid, { step: 'country' });
  // Если указан WEBAPP_URL, сразу предлагаем открыть мини‑приложение
  if (isHttpsUrl(webAppBaseUrl)) {
    await ctx.reply('Можно оформить через мини‑приложение или выбрать страну вручную:', Markup.inlineKeyboard([
      [Markup.button.webApp('Открыть приложение', webAppBaseUrl)]
    ]));
  }
  await ctx.reply('Выберите страну оформления карты:', buildKeyboardFromList(countriesList, 2));
});

// Убрали /help из меню, если нужно — можно вернуть.

// Обработчики кнопок меню
bot.hears('Скрыть меню', (ctx) => ctx.reply('Меню скрыто. Чтобы открыть, используйте /menu.', Markup.removeKeyboard()));

bot.hears('Оформить карту', async (ctx) => {
  if (!countriesList.length) {
    return ctx.reply('Данные о продуктах недоступны. Проверьте CSV.', mainMenu);
  }
  const uid = ctx.from.id;
  userState.set(uid, { step: 'country' });
  if (isHttpsUrl(webAppBaseUrl)) {
    await ctx.reply('Можно оформить через мини‑приложение или выбрать страну вручную:', Markup.inlineKeyboard([
      [Markup.button.webApp('Открыть приложение', webAppBaseUrl)]
    ]));
  }
  await ctx.reply('Выберите страну оформления карты:', buildKeyboardFromList(countriesList, 2));
});

// Обработка выбора страны -> показать банки
bot.hears(/^[А-ЯA-ZЁ][а-яa-zё]+/u, async (ctx, next) => {
  const uid = ctx.from.id;
  const state = userState.get(uid);
  const text = (ctx.message.text || '').trim();
  if (!state || state.step !== 'country') return next();
  if (!offeringsByCountry.has(text)) {
    return ctx.reply('Такой страны нет в списке. Выберите из меню.');
  }
  state.country = text;
  state.step = 'bank';
  const banks = offeringsByCountry.get(text).map((p) => p.bank);
  const uniqBanks = Array.from(new Set(banks));
  await ctx.reply(`Страна: ${text}. Выберите банк:`, buildKeyboardFromList([...uniqBanks, 'Назад к странам', 'В главное меню'], 2));
});

// Обработка выбора банка -> показать детали
bot.hears(/.+/u, async (ctx, next) => {
  const uid = ctx.from.id;
  const state = userState.get(uid);
  const text = (ctx.message.text || '').trim();
  if (!state) return next();

  if (text === 'Назад к странам') {
    state.step = 'country';
    return ctx.reply('Выберите страну оформления карты:', buildKeyboardFromList(countriesList, 2));
  }
  if (text === 'В главное меню') {
    userState.delete(uid);
    return ctx.reply('Главное меню:', mainMenu);
  }

  if (state.step === 'bank' && state.country) {
    const list = offeringsByCountry.get(state.country) || [];
    const match = list.find((p) => p.bank === text);
    if (!match) return next();
    state.step = 'details';
    state.bank = match.bank;
    const info = formatProductInfo(match);
    const inline = [];
    if (isHttpsUrl(webAppBaseUrl)) {
      const url = `${webAppBaseUrl}?country=${encodeURIComponent(state.country)}&bank=${encodeURIComponent(state.bank)}`;
      inline.push([Markup.button.webApp('Оформить в приложении', url)]);
    }
    const contactKb = Markup.keyboard([
      [Markup.button.contactRequest('Отправить контакт')],
      ['Назад к банкам', 'В главное меню']
    ]).resize();
    if (inline.length) {
      await ctx.reply(info + '\n\nВыберите действие:', Markup.inlineKeyboard(inline));
    }
    return ctx.reply('Либо оставьте контакт — мы свяжемся для оформления:', contactKb);
  }

  if (state.step === 'details') {
    if (text === 'Назад к банкам' && state.country) {
      state.step = 'bank';
      const banks = offeringsByCountry.get(state.country).map((p) => p.bank);
      const uniqBanks = Array.from(new Set(banks));
      return ctx.reply(`Страна: ${state.country}. Выберите банк:`, buildKeyboardFromList([...uniqBanks, 'Назад к странам', 'В главное меню'], 2));
    }
    // Кнопка «Отправить контакт» обрабатывается в bot.on('contact') ниже
  }

  return next();
});

// Приём данных из WebApp через sendData
bot.on('web_app_data', async (ctx) => {
  try {
    const raw = ctx.webAppData?.data || ctx.message?.web_app_data?.data;
    if (!raw) return;
    const data = JSON.parse(raw);
    const username = ctx.from.username ? '@' + ctx.from.username : '(без username)';
    const nameParts = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    const country = data.country || 'не выбрана';
    const bank = data.bank || 'не выбран';
    const phone = data.phone || 'не указан';
    const comment = data.comment || '';

    const text = [
      'Новая заявка (WebApp sendData)',
      `Пользователь: ${nameParts} ${username}`.trim(),
      `Телефон: ${phone}`,
      `Страна: ${country}`,
      `Банк: ${bank}`,
      comment ? `Комментарий: ${comment}` : undefined
    ].filter(Boolean).join('\n');

    for (const adminId of adminChatIds) {
      // eslint-disable-next-line no-await-in-loop
      await bot.telegram.sendMessage(adminId, text);
    }

    await ctx.reply('Заявка отправлена, спасибо!', mainMenu);
  } catch (_) {
    // игнорируем ошибки парсинга
  }
});
// Эхо-ответ на текстовые сообщения
bot.on('contact', async (ctx) => {
  const uid = ctx.from.id;
  const state = userState.get(uid) || {};
  const contact = ctx.message.contact;
  const username = ctx.from.username ? '@' + ctx.from.username : '(без username)';
  const nameParts = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
  const phone = contact && contact.phone_number ? contact.phone_number : 'не указан';
  const country = state.country || 'не выбрана';
  const bank = state.bank || 'не выбран';

  const text = [
    'Новая заявка на оформление карты',
    `Пользователь: ${nameParts} ${username}`.trim(),
    `Телефон: ${phone}`,
    `Страна: ${country}`,
    `Банк: ${bank}`
  ].join('\n');

  let notified = false;
  for (const adminId of adminChatIds) {
    try {
      // оповещаем каждого подключившегося админа
      // eslint-disable-next-line no-await-in-loop
      await bot.telegram.sendMessage(adminId, text);
      notified = true;
    } catch (e) {
      // пропускаем ошибки отправки конкретному администратору
    }
  }

  if (!notified) {
    await ctx.reply('Заявка принята. Внимание: админы ещё не запустили бота. Попросите @mixakun и @kasim_saidi отправить /start этому боту, чтобы получать заявки.');
  } else {
    await ctx.reply('Спасибо! Ваша заявка отправлена, скоро свяжемся.', mainMenu);
  }
  userState.delete(uid);
});

bot.launch()
  .then(() => console.log('Бот запущен. Нажми Ctrl+C для остановки.'))
  .catch((err) => {
    console.error('Ошибка запуска бота:', err);
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ---------------- WebApp сервер и API ----------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статика мини‑приложения
const webappDir = path.resolve(__dirname, '../webapp');
if (fs.existsSync(webappDir)) {
  app.use('/', express.static(webappDir));
}

// Принять заявку из WebApp
app.post('/api/lead', async (req, res) => {
  try {
    const { country, bank, name, phone, username, comment } = req.body || {};
    const lines = [
      'Новая заявка (WebApp)',
      country ? `Страна: ${country}` : undefined,
      bank ? `Банк: ${bank}` : undefined,
      name ? `Имя: ${name}` : undefined,
      username ? `Username: @${username}` : undefined,
      phone ? `Телефон: ${phone}` : undefined,
      comment ? `Комментарий: ${comment}` : undefined
    ].filter(Boolean);
    const msg = lines.join('\n');

    let notified = false;
    for (const adminId of adminChatIds) {
      // eslint-disable-next-line no-await-in-loop
      await bot.telegram.sendMessage(adminId, msg);
      notified = true;
    }

    res.json({ ok: true, notified });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

if (CERT_KEY && CERT_CRT && fs.existsSync(CERT_KEY) && fs.existsSync(CERT_CRT)) {
  const key = fs.readFileSync(CERT_KEY);
  const cert = fs.readFileSync(CERT_CRT);
  https.createServer({ key, cert }, app).listen(PORT, () => {
    console.log(`WebApp HTTPS сервер запущен на порту ${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`WebApp сервер запущен на порту ${PORT}`);
  });
}
