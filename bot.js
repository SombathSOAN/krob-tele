const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Load token from environment variable
const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  console.error('TELEGRAM_TOKEN environment variable not set.');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

const sessions = {};
const POLL_INTERVALS = {
  orders: 3 * 1000,
  vouchers: 6 * 1000,
  products: 6 * 1000,
};

function escapeMdV2(str = '') {
  return str.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function safeSendMessage(chatId, text, options = {}) {
  try {
    await bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error('Telegram sendMessage error:', err.message);
  }
}

async function safeSendPhoto(chatId, photoUrl, caption, options = {}) {
  try {
    await bot.sendPhoto(chatId, photoUrl, { caption, ...options });
  } catch (err) {
    console.error('Telegram sendPhoto error:', err.message);
  }
}

async function fetchWithAuth(url, token) {
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 429) {
      console.warn(`Rate limit reached (429) for ${url}; skipping this cycle.`);
      return null;
    }
    throw err;
  }
}

function startOrderPolling(chatId, session) {
  async function checkNewOrders() {
    const data = await fetchWithAuth(
      'https://krobmokkalip.com/api/vendor/orders?page=1',
      session.token
    );
    if (!data) return;

    const ordersList = data.data || [];
    if (!ordersList.length) return;

    const newest = ordersList[0];
    if (!session.lastOrderId) {
      session.lastOrderId = newest.id;
      return;
    }
    if (newest.id > session.lastOrderId) {
      session.lastOrderId = newest.id;

      const notifText =
        `\ud83d\udcec *New Order Received!*\n` +
        `\ud83d\uddd2 *Order Code:* \`${newest.order_code}\`\n` +
        `\ud83d\udcc5 *Date:* ${newest.date}\n` +
        `\ud83d\ude9a *Status:* ${newest.delivery_status}\n` +
        `\ud83d\udcb0 *Total:* ${newest.grand_total}`;

      const inlineKeyboard = {
        inline_keyboard: [[
          { text: '\ud83d\udd17 View in App', url: 'https://krobmokkalip.com/users/login' },
        ]],
      };
      await safeSendMessage(chatId, notifText, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard,
      });
    }
  }

  checkNewOrders();
  session.orderTimer = setInterval(checkNewOrders, POLL_INTERVALS.orders);
}

function startVoucherPolling(chatId, session) {
  async function checkVoucherUpdates() {
    const data = await fetchWithAuth(
      'https://krobmokkalip.com/api/vendor/vouchers/seller-coupons',
      session.token
    );
    if (!data) return;

    const vouchers = data.data || [];
    for (const v of vouchers) {
      const currentStatus = Number(v.status);
      const prevStatus = session.lastVoucherStatus[v.id];

      if (prevStatus === undefined) {
        session.lastVoucherStatus[v.id] = currentStatus;
        continue;
      }
      if (prevStatus === 0 && currentStatus === 1) {
        session.lastVoucherStatus[v.id] = currentStatus;

        const safeId = escapeMdV2(String(v.id));
        const safeType = escapeMdV2(v.type);
        const safeDiscount = escapeMdV2(String(v.discount));
        const discountSym = v.discount_type === 'percent' ? '\\%' : '\\$';

        const notifText =
          `\ud83c\udf89 *Voucher Approved\\!*\n` +
          `\ud83d\udd16 *Voucher ID:* \`${safeId}\`\n` +
          `\ud83c\udff7 *Type:* ${safeType}\n` +
          `\ud83d\udcb8 *Discount:* ${safeDiscount}${discountSym}`;

        await safeSendMessage(chatId, notifText, { parse_mode: 'MarkdownV2' });
      } else {
        session.lastVoucherStatus[v.id] = currentStatus;
      }
    }
  }

  checkVoucherUpdates();
  session.voucherTimer = setInterval(checkVoucherUpdates, POLL_INTERVALS.vouchers);
}

function startProductPolling(chatId, session) {
  async function checkProductUpdates() {
    console.log('\ud83d\ded2 Checking product & voucher approval updates...');
    const firstPageData = await fetchWithAuth(
      `https://krobmokkalip.com/api/vendor/products/products?page=1`,
      session.token
    );
    if (!firstPageData) return;

    const lastPage = firstPageData.meta?.last_page || 1;

    for (let currentPage = 1; currentPage <= lastPage; currentPage++) {
      const data =
        currentPage === 1
          ? firstPageData
          : await fetchWithAuth(
              `https://krobmokkalip.com/api/vendor/products/products?page=${currentPage}`,
              session.token
            );
      if (!data) return;

      const products = data.data || [];
      if (!products.length) break;

      for (const p of products) {
        const currentApproved = Number(p.approved);
        const prevApproved = session.lastProductApproved[p.id];

        if (prevApproved === undefined) {
          session.lastProductApproved[p.id] = currentApproved;
          continue;
        }

        if (prevApproved === 0 && currentApproved === 1) {
          session.lastProductApproved[p.id] = currentApproved;
          const notifText =
            `\ud83d\ded2 Product Approved!\n` +
            `\u{1f194} Product ID: ${p.id}\n` +
            `\ud83c\udff7 Name: ${p.name}`;
          await safeSendMessage(chatId, notifText);
        } else {
          session.lastProductApproved[p.id] = currentApproved;
        }
      }
    }
  }

  checkProductUpdates();
  session.productTimer = setInterval(checkProductUpdates, POLL_INTERVALS.products);
}

function cleanupOnExit() {
  for (const chatId in sessions) {
    const sess = sessions[chatId];
    if (sess.orderTimer) clearInterval(sess.orderTimer);
    if (sess.voucherTimer) clearInterval(sess.voucherTimer);
    if (sess.productTimer) clearInterval(sess.productTimer);
  }
  process.exit();
}

process.on('SIGINT', cleanupOnExit);
process.on('SIGTERM', cleanupOnExit);
process.on('exit', cleanupOnExit);

bot.onText(/\/start|\/login/, (msg) => {
  const chatId = msg.chat.id;
  if (sessions[chatId]?.token) {
    return safeSendMessage(chatId, '✅ Already logged in. Choose an option below:', {
      reply_markup: {
        keyboard: [
          ['Open Mini App', '/allorders'],
          ['/products', '/vouchers'],
          ['/logout'],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    });
  }
  sessions[chatId] = { step: 'phone', lastVoucherStatus: {}, lastProductApproved: {} };
  safeSendMessage(chatId, '👋 Welcome to Seller Krob Mok! 📲 Please enter your phone number:', {
    reply_markup: {
      keyboard: [
        ['Open Mini App', '/allorders'],
        ['/products', '/vouchers'],
        ['/logout'],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (text === 'Open Mini App') {
    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: '🤖 Android App',
            url: 'https://play.google.com/store/apps/details?id=com.codingate.seller_krob_mok&hl=en',
          },
          {
            text: '🍎 iOS App',
            url: 'https://apps.apple.com/kh/app/dhe-distributor/id1639978934',
          },
        ],
        [{ text: '💻 Open Mini App', url: 'https://krobmokkalip.com' }],
      ],
    };
    return safeSendMessage(chatId, 'Choose your platform or open the mini web app:', {
      reply_markup: inlineKeyboard,
    });
  }
  if (!sessions[chatId] || text.startsWith('/')) return;

  const session = sessions[chatId];

  if (session.step === 'phone') {
    const phone = text.trim();
    if (!/^\d+$/.test(phone)) {
      return safeSendMessage(chatId, '❌ Enter digits only for phone.');
    }
    session.phone = phone;
    session.step = 'password';
    return safeSendMessage(chatId, '🔐 Please enter your password:');
  }

  if (session.step === 'password') {
    session.password = text.trim();
    try {
      const res = await axios.post(
        'https://krobmokkalip.com/api/vendor/auth/login',
        { country_code: '+855', phone: session.phone, password: session.password }
      );
      const data = res.data;
      if (!data.result) {
        session.step = 'phone';
        return safeSendMessage(chatId, '❌ Login failed. Try again with /login.');
      }
      session.token = data.access_token;
      session.vendor = data.user;
      session.lastOrderId = null;

      const user = data.user;
      const profileImage = user.avatar_original
        ? `https://krobmokkalip.com/storage/${user.avatar_original}`
        : null;

      let profileMsg = `✅ *Login Successful!*\n\n👤 *Profile Info:*\n`;
      profileMsg += `🆔 ID: ${user.id}\n`;
      profileMsg += `🏬 Shop ID: ${user.shop_id}\n`;
      profileMsg += `👨‍💼 Name: ${escapeMdV2(user.name)}\n`;
      profileMsg += `📧 Email: ${escapeMdV2(user.email)}\n`;
      profileMsg += `📱 Phone: ${escapeMdV2(user.phone)}`;

      if (profileImage) {
        try {
          await axios.head(profileImage);
          await bot.sendPhoto(chatId, profileImage, {
            caption: profileMsg,
            parse_mode: 'Markdown',
          });
        } catch {
          await safeSendMessage(chatId, profileMsg, { parse_mode: 'Markdown' });
        }
      } else {
        await safeSendMessage(chatId, profileMsg, { parse_mode: 'Markdown' });
      }

      startOrderPolling(chatId, session);
      startVoucherPolling(chatId, session);
      startProductPolling(chatId, session);

      session.step = null;
    } catch (err) {
      console.error('Login error:', err.message);
      return safeSendMessage(chatId, '⚠️ Error during login. Try again later.');
    }
  }
});

bot.onText(/\/products/, async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session?.token) {
    return safeSendMessage(chatId, '🔒 Please login with /login first.');
  }

  async function sendPage(page) {
    try {
      const data = await fetchWithAuth(
        `https://krobmokkalip.com/api/vendor/products/products?page=${page}`,
        session.token
      );
      if (!data) return;
      const products = data.data || [];
      const lastPage = data.meta?.last_page || 1;
      if (!products.length) {
        return safeSendMessage(chatId, '🛒 No products found.');
      }

      for (const product of products) {
        const photo = product.thumbnail_image || null;
        const statusEmoji = product.published === 1 ? '✅ Published' : '❌ Unpublished';
        let caption = `📦 *${escapeMdV2(product.name)}*\n`;
        caption += `📂 Category: ${escapeMdV2(product.category)}\n`;
        caption += `💰 Price: ${escapeMdV2(product.unit_price)}\n`;
        caption += `📦 Stock: ${escapeMdV2(String(product.current_stock))}\n`;
        caption += `🆔 ID: ${escapeMdV2(String(product.id))}\n`;
        caption += `📌 Status: ${statusEmoji}`;

        const buttons = [{ text: '✏️ Edit', callback_data: `edit_${product.id}` }];
        if (product.published === 1) {
          buttons.push({ text: '📥 Unpublish', callback_data: `unpublish_${product.id}` });
        } else {
          buttons.push({ text: '📤 Publish', callback_data: `publish_${product.id}` });
        }
        const keyboard = { inline_keyboard: [buttons] };

        if (photo) {
          await safeSendPhoto(chatId, photo, caption, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        } else {
          await safeSendMessage(chatId, caption, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
          });
        }
      }

      if (page < lastPage) {
        const moreKeyboard = {
          inline_keyboard: [[{ text: '🔄 More', callback_data: `more_products_${page + 1}` }]],
        };
        await safeSendMessage(chatId, `Page ${page} of ${lastPage}`, {
          reply_markup: moreKeyboard,
        });
      }
    } catch (err) {
      console.error('Error in /products:', err.message);
      safeSendMessage(chatId, '⚠️ Failed to fetch products.');
    }
  }

  sendPage(1);
});

bot.onText(/\/allorders/, async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session?.token) {
    return safeSendMessage(chatId, '🔒 Please login with /login first.');
  }

  async function sendPage(page) {
    try {
      const data = await fetchWithAuth(
        `https://krobmokkalip.com/api/vendor/orders?page=${page}`,
        session.token
      );
      if (!data) return;
      const orders = data.data || [];
      const lastPage = data.meta?.last_page || 1;
      if (!orders.length) {
        return safeSendMessage(chatId, '📦 No orders found.');
      }

      for (const order of orders) {
        const message =
          `🧾 Order Code: ${order.order_code}\n` +
          `📅 Date: ${order.date}\n` +
          `🚚 Status: ${order.delivery_status}\n` +
          `💰 Total: ${order.grand_total}\n` +
          `💳 Method: ${order.payment_method}\n` +
          `💸 Payment Status: ${order.payment_status}\n` +
          `❌ Cancelled By: ${order.cancel_by || 'N/A'}`;

        const inlineKeyboard = {
          inline_keyboard: [[
            { text: '🔍 View Detail Order', callback_data: `vieworder_${order.id}` },
            { text: '⚙️ Update Status', callback_data: `updateorder_${order.id}` },
          ]],
        };
        await safeSendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard,
        });
      }

      if (page < lastPage) {
        const moreKeyboard = {
          inline_keyboard: [[{ text: '🛒 More Orders', callback_data: `more_orders_${page + 1}` }]],
        };
        await safeSendMessage(chatId, `Orders page ${page} of ${lastPage}`, {
          reply_markup: moreKeyboard,
        });
      }
    } catch (err) {
      console.error('Error in /allorders:', err.message);
      safeSendMessage(chatId, '⚠️ Failed to fetch orders.');
    }
  }

  sendPage(1);
});

bot.onText(/\/vouchers/, async (msg) => {
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session?.token) {
    return safeSendMessage(chatId, '🔒 Please login with /login first.');
  }

  try {
    const data = await fetchWithAuth(
      'https://krobmokkalip.com/api/vendor/vouchers/seller-coupons',
      session.token
    );
    if (!data) return;

    const vouchers = data.data || [];
    if (!vouchers.length) {
      return safeSendMessage(chatId, '🎟️ No vouchers found.');
    }

    const formatDate = (ts) => {
      const d = new Date(ts * 1000);
      return d.toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    };

    for (const v of vouchers) {
      const start = formatDate(v.start_date);
      const end = formatDate(v.end_date);
      const status = v.status === 1 ? 'Active' : 'Inactive';
      const unlimited = v.is_unlimited ? 'Yes' : 'No';
      let remainingUses = '';
      if (!v.is_unlimited && typeof v.limited_usages === 'number') {
        remainingUses = `\n🔢 Remaining Uses: ${v.limited_usages}`;
      }
      const text =
        `🎟️ Voucher ID: ${v.id}\n` +
        `📦 Type: ${v.type}\n` +
        `💸 Discount: ${v.discount}${v.discount_type === 'percent' ? '%' : '$'}\n` +
        `📅 Valid: ${start} to ${end}\n` +
        `🔘 Status: ${status}\n` +
        `🔄 Unlimited Uses: ${unlimited}${remainingUses}`;
      await safeSendMessage(chatId, text);
    }
  } catch (err) {
    console.error('Error in /vouchers:', err.message);
    safeSendMessage(chatId, '⚠️ Failed to fetch vouchers.');
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (!session?.token) return safeSendMessage(chatId, '🔒 Please login again.');

  const action = callbackQuery.data;
  if (/^(publish|unpublish)_\d+$/.test(action)) {
    const [cmd, idStr] = action.split('_');
    const productId = Number(idStr);
    const newStatus = cmd === 'publish' ? 1 : 0;

    try {
      await axios.post(
        'https://krobmokkalip.com/api/vendor/products/published',
        { id: productId, status: newStatus },
        { headers: { Authorization: `Bearer ${session.token}` } }
      );
      const detailData = await axios.get(
        `https://krobmokkalip.com/api/vendor/products/${productId}`,
        { headers: { Authorization: `Bearer ${session.token}` } }
      );
      const product = detailData.data.data;

      await bot.answerCallbackQuery(callbackQuery.id, {
        text: `✅ Product ${newStatus === 1 ? 'published' : 'unpublished'}!`,
        show_alert: true,
      });

      const statusEmoji = product.published === 1 ? '✅ Published' : '❌ Unpublished';
      let caption = `📦 *${escapeMdV2(product.name)}*\n`;
      caption += `📂 Category: ${escapeMdV2(product.category)}\n`;
      caption += `💰 Price: ${escapeMdV2(product.unit_price)}\n`;
      caption += `📦 Stock: ${escapeMdV2(String(product.current_stock))}\n`;
      caption += `🆔 ID: ${escapeMdV2(String(product.id))}\n`;
      caption += `📌 Status: ${statusEmoji}`;

      const buttons = [{ text: '✏️ Edit', callback_data: `edit_${product.id}` }];
      if (product.published === 1) {
        buttons.push({ text: '📥 Unpublish', callback_data: `unpublish_${product.id}` });
      } else {
        buttons.push({ text: '📤 Publish', callback_data: `publish_${product.id}` });
      }
      const inlineKeyboard = { inline_keyboard: [buttons] };

      if (msg.photo) {
        await bot.editMessageCaption(caption, {
          chat_id: chatId,
          message_id: msg.message_id,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard,
        });
      } else {
        await bot.editMessageText(caption, {
          chat_id: chatId,
          message_id: msg.message_id,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard,
        });
      }
    } catch (err) {
      console.error('Error updating product status:', err.message);
      bot.answerCallbackQuery(callbackQuery.id, {
        text: '⚠️ Failed to update product.',
        show_alert: true,
      });
    }
    return;
  }

  if (/^more_products_\d+$/.test(action)) {
    const page = Number(action.split('_')[2]);
    await bot.answerCallbackQuery(callbackQuery.id);
    bot.emit('text', { chat: msg.chat, text: `/products page=${page}` });
    return;
  }

  if (/^more_orders_\d+$/.test(action)) {
    const page = Number(action.split('_')[2]);
    await bot.answerCallbackQuery(callbackQuery.id);
    bot.emit('text', { chat: msg.chat, text: `/allorders page=${page}` });
    return;
  }

  if (/^edit_\d+$/.test(action)) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '🛠 Edit feature coming soon!',
      show_alert: true,
    });
    return;
  }

  if (/^vieworder_\d+$/.test(action)) {
    const orderId = action.split('_')[1];
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `🔍 You requested details for Order ID ${orderId}.`,
      show_alert: true,
    });
    return;
  }

  if (/^updateorder_\d+$/.test(action)) {
    const orderId = action.split('_')[1];
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `⚙️ You requested to update status for Order ID ${orderId}.`,
      show_alert: true,
    });
    return;
  }
});

