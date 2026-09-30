import { T } from './texts.js';

const MEMBER = new Set(['creator', 'administrator', 'member']);

/** Telegram calls used outside of update handlers. */
export function createTg(getBot, config) {
  return {
    get enabled() {
      return !!getBot();
    },
    get botUsername() {
      const bot = getBot();
      return (bot && bot.isInited() && bot.botInfo.username) || '';
    },

    async isSubscribed(channel, userId) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const m = await bot.api.getChatMember(channel, userId);
      return MEMBER.has(m.status) || (m.status === 'restricted' && !!m.is_member);
    },

    /** Checks that the channel exists and the bot can see its members (is an admin). */
    async checkChannel(channel) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const chat = await bot.api.getChat(channel);
      const me = await bot.api.getChatMember(channel, bot.botInfo.id);
      return { title: chat.title || chat.username || String(chat.id), botIsAdmin: me.status === 'administrator' || me.status === 'creator' };
    },

    shareFallbackUrl(lang) {
      const link = `https://t.me/${this.botUsername}`;
      return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(T(lang).shareCaption)}`;
    },

    /** Prepared message for Telegram.WebApp.shareMessage (Bot API 8.0+). */
    async prepareShare(userId, lang) {
      const bot = getBot();
      if (!bot) throw new Error('bot disabled');
      const base = config.apiUrl || config.webUrl;
      const photo = `${base}/img/banner.jpg`;
      const res = await bot.api.savePreparedInlineMessage(
        userId,
        {
          type: 'photo',
          id: `share-${userId}-${Date.now()}`,
          photo_url: photo,
          thumbnail_url: photo,
          caption: T(lang).shareCaption,
          reply_markup: {
            inline_keyboard: [[{ text: T(lang).shareButton, url: `https://t.me/${this.botUsername}?start=share` }]],
          },
        },
        { allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true, allow_bot_chats: false },
      );
      return res.id;
    },
  };
}
