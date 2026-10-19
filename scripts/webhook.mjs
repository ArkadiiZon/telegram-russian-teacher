const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_BASE_URL } = process.env;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET || !PUBLIC_BASE_URL) throw new Error('Run with Infisical-injected TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_BASE_URL');
const url = new URL('/telegram/webhook', PUBLIC_BASE_URL);
if (url.protocol !== 'https:') throw new Error('Telegram requires public HTTPS');
const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: url.toString(), secret_token: TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'poll_answer'], max_connections: 1, drop_pending_updates: false })
}).catch(() => { throw new Error('Telegram network request failed'); });
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`Webhook registration failed (HTTP ${response.status}); verify bot and endpoint configuration`);
console.log('Telegram webhook registered successfully.');
