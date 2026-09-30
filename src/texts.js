// Bot texts in Russian, Ukrainian and English.

export const LANGS = ['ru', 'uk', 'en'];

export function pickLang(code) {
  const c = String(code || '').toLowerCase();
  if (!c) return 'ru';
  if (c.startsWith('uk')) return 'uk';
  if (c.startsWith('ru') || c.startsWith('be') || c.startsWith('kk') || c.startsWith('uz') || c.startsWith('ky')) return 'ru';
  return 'en';
}

const fmt = (n, lang) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : lang === 'uk' ? 'uk-UA' : 'ru-RU').format(n);

export const TEXTS = {
  ru: {
    welcome:
      '😎 Добро пожаловать в BrainrotSpin!\n\n' +
      'Кейсы и апгрейдер по игре «Steal a Brainrot»:\n' +
      '» Открывай кейсы и собирай брейнротов\n' +
      '» Прокачивай их в Апгрейдере\n' +
      '» Бесплатный кейс каждый день 🎁\n\n' +
      '🍀 Испытай удачу!\n\n' +
      'Кнопка «Играть на сайте» сразу входит в твой аккаунт — никому её не пересылай.',
    btnPlayTg: '🎮 Играть в Telegram',
    btnPlayWeb: '🌐 Играть на сайте',
    btnNews: '📢 Новости',
    btnSupport: '💬 Поддержка',
    btnPromo: '🎁 Ввести промокод',
    menuButton: 'Играть',
    promoAsk: '🎁 Отправь промокод одним сообщением:',
    promoOk: (amount, balance) => `✅ Промокод активирован: +${fmt(amount, 'ru')} 🪙\nБаланс: ${fmt(balance, 'ru')} 🪙`,
    promoErr: {
      promo_invalid: '❌ Такого промокода нет.',
      promo_expired: '⌛ Срок действия промокода истёк.',
      promo_used: '⚠️ Ты уже активировал этот промокод.',
      promo_limit: '⚠️ У промокода закончились активации.',
      default: '❌ Не получилось активировать промокод, попробуй позже.',
    },
    adminOk: '✅ Готово, теперь ты админ. Админ-панель — во вкладке «Админ» в приложении.',
    adminBad: '❌ Неверный код.',
    banned: '⛔ Доступ к боту ограничен.',
    description: 'BrainrotSpin 🎁\nКейсы и апгрейдер по игре «Steal a Brainrot».',
    shortDescription: 'BrainrotSpin — кейсы и апгрейдер по игре «Steal a Brainrot» 🎁',
    cmdStart: 'Главное меню',
    shareCaption: '🎁 Залетай в BrainrotSpin — открывай кейсы с брейнротами из «Steal a Brainrot»!',
    shareButton: '🎮 Играть',
  },
  uk: {
    welcome:
      '😎 Ласкаво просимо до BrainrotSpin!\n\n' +
      'Кейси та апгрейдер за грою «Steal a Brainrot»:\n' +
      '» Відкривай кейси та збирай брейнротів\n' +
      '» Прокачуй їх в Апгрейдері\n' +
      '» Безкоштовний кейс щодня 🎁\n\n' +
      '🍀 Випробуй удачу!\n\n' +
      'Кнопка «Грати на сайті» одразу входить у твій акаунт — нікому її не пересилай.',
    btnPlayTg: '🎮 Грати в Telegram',
    btnPlayWeb: '🌐 Грати на сайті',
    btnNews: '📢 Новини',
    btnSupport: '💬 Підтримка',
    btnPromo: '🎁 Ввести промокод',
    menuButton: 'Грати',
    promoAsk: '🎁 Надішли промокод одним повідомленням:',
    promoOk: (amount, balance) => `✅ Промокод активовано: +${fmt(amount, 'uk')} 🪙\nБаланс: ${fmt(balance, 'uk')} 🪙`,
    promoErr: {
      promo_invalid: '❌ Такого промокоду немає.',
      promo_expired: '⌛ Термін дії промокоду минув.',
      promo_used: '⚠️ Ти вже активував цей промокод.',
      promo_limit: '⚠️ У промокоду закінчилися активації.',
      default: '❌ Не вдалося активувати промокод, спробуй пізніше.',
    },
    adminOk: '✅ Готово, тепер ти адмін. Адмін-панель — у вкладці «Адмін» у застосунку.',
    adminBad: '❌ Невірний код.',
    banned: '⛔ Доступ до бота обмежено.',
    description: 'BrainrotSpin 🎁\nКейси та апгрейдер за грою «Steal a Brainrot».',
    shortDescription: 'BrainrotSpin — кейси та апгрейдер за грою «Steal a Brainrot» 🎁',
    cmdStart: 'Головне меню',
    shareCaption: '🎁 Залітай у BrainrotSpin — відкривай кейси з брейнротами зі «Steal a Brainrot»!',
    shareButton: '🎮 Грати',
  },
  en: {
    welcome:
      '😎 Welcome to BrainrotSpin!\n\n' +
      'Cases and upgrader for «Steal a Brainrot»:\n' +
      '» Open cases and collect brainrots\n' +
      '» Level them up in the Upgrader\n' +
      '» Free case every day 🎁\n\n' +
      '🍀 Try your luck!\n\n' +
      'The «Play on website» button logs you straight into your account — never forward it to anyone.',
    btnPlayTg: '🎮 Play in Telegram',
    btnPlayWeb: '🌐 Play on website',
    btnNews: '📢 News',
    btnSupport: '💬 Support',
    btnPromo: '🎁 Enter promo code',
    menuButton: 'Play',
    promoAsk: '🎁 Send the promo code in one message:',
    promoOk: (amount, balance) => `✅ Promo code activated: +${fmt(amount, 'en')} 🪙\nBalance: ${fmt(balance, 'en')} 🪙`,
    promoErr: {
      promo_invalid: '❌ There is no such promo code.',
      promo_expired: '⌛ This promo code has expired.',
      promo_used: '⚠️ You have already used this promo code.',
      promo_limit: '⚠️ This promo code has no activations left.',
      default: '❌ Could not activate the promo code, try again later.',
    },
    adminOk: '✅ Done, you are an admin now. The admin panel is in the «Admin» tab of the app.',
    adminBad: '❌ Wrong code.',
    banned: '⛔ Access to the bot is restricted.',
    description: 'BrainrotSpin 🎁\nCases and upgrader for «Steal a Brainrot».',
    shortDescription: 'BrainrotSpin — cases and upgrader for «Steal a Brainrot» 🎁',
    cmdStart: 'Main menu',
    shareCaption: '🎁 Jump into BrainrotSpin — open cases with brainrots from «Steal a Brainrot»!',
    shareButton: '🎮 Play',
  },
};

export function T(lang) {
  return TEXTS[lang] || TEXTS.ru;
}
