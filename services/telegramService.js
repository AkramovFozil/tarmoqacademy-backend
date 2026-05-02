const https = require('https');

const TELEGRAM_TIMEOUT_MS = 8000;
const TELEGRAM_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];

const isEnabled = () => {
  const value = String(process.env.TELEGRAM_NOTIFICATIONS || 'true').toLowerCase();
  return !['false', '0', 'off', 'no'].includes(value);
};

const getMissingTelegramEnv = () => TELEGRAM_ENV_KEYS.filter((key) => !String(process.env[key] || '').trim());

const buildResult = ({ ok, status, reason = '', missing = [], statusCode = null, body = '', data = null, error = '' }) => ({
  ok,
  status,
  reason,
  missing,
  statusCode,
  body,
  data,
  error,
});

const formatTelegramDateTime = (date = new Date()) => date.toLocaleString('uz-UZ', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tashkent',
});

const parseTelegramBody = (body) => {
  try {
    return JSON.parse(body);
  } catch (error) {
    return body;
  }
};

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
        const statusCode = response.statusCode || 0;
        resolve({
          ok: statusCode >= 200 && statusCode < 300,
          statusCode,
          body: responseBody,
          data: parseTelegramBody(responseBody),
        });
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
    if (!isEnabled()) {
      console.log('[telegram] skipped: TELEGRAM_NOTIFICATIONS disabled');
      return buildResult({ ok: false, status: 'skipped', reason: 'disabled' });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const message = String(text || '').trim();
    const missingEnv = getMissingTelegramEnv();

    if (missingEnv.length) {
      console.error(`[telegram] skipped: missing env ${missingEnv.join(', ')}`);
      return buildResult({
        ok: false,
        status: 'skipped',
        reason: 'missing_env',
        missing: missingEnv,
      });
    }

    if (!message) {
      console.error('[telegram] skipped: empty message text');
      return buildResult({ ok: false, status: 'skipped', reason: 'empty_message' });
    }

    const payload = {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    };

    if (typeof fetch !== 'function') {
      const result = await sendWithHttps(token, payload);

      if (!result.ok) {
        console.error(`[telegram] failed: Telegram API error ${result.statusCode} body: ${result.body}`);
        return buildResult({
          ok: false,
          status: 'failed',
          reason: 'telegram_api_error',
          statusCode: result.statusCode,
          body: result.body,
          data: result.data,
        });
      }

      return buildResult({
        ok: true,
        status: 'sent',
        statusCode: result.statusCode,
        body: result.body,
        data: result.data,
      });
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

    const body = await response.text();
    const data = parseTelegramBody(body);

    if (!response.ok) {
      console.error(`[telegram] failed: Telegram API error ${response.status} body: ${body}`);
      return buildResult({
        ok: false,
        status: 'failed',
        reason: 'telegram_api_error',
        statusCode: response.status,
        body,
        data,
      });
    }

    return buildResult({
      ok: true,
      status: 'sent',
      statusCode: response.status,
      body,
      data,
    });
  } catch (error) {
    console.error(`[telegram] failed: ${error.name || 'Error'} ${error.message}`);
    return buildResult({
      ok: false,
      status: 'failed',
      reason: 'request_error',
      error: error.message,
    });
  }
};

module.exports = {
  formatTelegramDateTime,
  sendTelegramMessage,
};
