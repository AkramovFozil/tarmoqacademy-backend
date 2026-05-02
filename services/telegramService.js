const https = require('https');

const isEnabled = () => String(process.env.TELEGRAM_NOTIFICATIONS || '').toLowerCase() === 'true';

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

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

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
  sendTelegramMessage,
};
