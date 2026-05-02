const https = require('https');

const TELEGRAM_TIMEOUT_MS = 8000;

const isEnabled = () => {
  const value = String(process.env.TELEGRAM_NOTIFICATIONS || 'true').toLowerCase();
  return !['false', '0', 'off', 'no'].includes(value);
};

const formatTelegramDateTime = (date = new Date()) => date.toLocaleString('uz-UZ', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tashkent',
});

const sendWithHttps = (token, payload) => new Promise((resolve, reject) => {
  const body = JSON.stringify(payload);
  const request = https.request(
    {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (response) => {
      let responseBody = '';

      response.on('data', (chunk) => {
        responseBody += chunk;
      });

      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${response.statusCode} ${responseBody}`));
          return;
        }

        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          resolve(responseBody);
        }
      });
    }
  );

  request.setTimeout(TELEGRAM_TIMEOUT_MS, () => {
    request.destroy(new Error('request timeout'));
  });
  request.on('error', reject);
  request.write(body);
  request.end();
});

const sendTelegramMessage = async (text) => {
  try {
    if (!isEnabled()) return null;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const message = String(text || '').trim();

    if (!token || !chatId || !message) return null;
    const payload = {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    };

    if (typeof fetch !== 'function') {
      return sendWithHttps(token, payload);
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeout = controller
      ? setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS)
      : null;
    let response;

    try {
      response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }

    if (!response.ok) {
      const body = await response.text();
      console.error(`[telegram] send failed: ${response.status} ${body}`);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('[telegram] send failed:', error.message);
    return null;
  }
};

module.exports = {
  formatTelegramDateTime,
  sendTelegramMessage,
};
