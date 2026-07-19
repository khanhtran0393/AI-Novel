import { POST } from './src/app/api/entitlement/telegram-webhook/route';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function run() {
  const payload = {
    callback_query: {
      id: "test_callback_id",
      data: "issue_HWID_TEST_LIFETIME_lifetime",
      message: {
        message_id: 999,
        text: "Test Notification Content",
        chat: { id: process.env.AINOVEL_TELEGRAM_CHAT_ID }
      }
    }
  };

  const req = new Request('http://localhost:3000/api/entitlement/telegram-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  console.log('Sending mock callback_query payload to POST handler...');
  const res = await POST(req);
  const json = await res.json();
  console.log('Result:', json);
}

run().catch(console.error);
