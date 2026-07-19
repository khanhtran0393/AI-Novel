import { NextResponse } from 'next/server';
import { issueHmacForPlan, hashToken, paidPlanToLicense } from '@/lib/cloud/licenseBridge';
import { createServiceSupabase } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/commercial/telegramNotify';
import type { PaidPlanId } from '@/lib/commercial/pricingPlans';
import { AppError, httpStatusFromError, toErrorJson } from '@/lib/errors';
import { PAID_PLANS } from '@/lib/commercial/pricingPlans';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // Handle Telegram callback query (from inline buttons)
    if (body.callback_query) {
      const callbackQuery = body.callback_query;
      const chatId = callbackQuery.message?.chat?.id?.toString();
      const expectedChatId = (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim();
      const token = (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
      
      if (chatId === expectedChatId) {
        const data = callbackQuery.data || '';
        const parts = data.split('_');
        const action = parts[0];
        const hwid = parts[1];
        let planId = parts[2] as PaidPlanId;

        // Validating plan
        const validPlanIds = PAID_PLANS.map(p => p.id);
        if (!validPlanIds.includes(planId)) {
          planId = 'lifetime';
        }

        if (action === 'issue' && hwid) {
          try {
            const issued = issueHmacForPlan(planId, hwid);
            const meta = paidPlanToLicense(planId);
            const expAt = new Date(Date.now() + meta.expSeconds * 1000).toISOString();
            const tokenHash = hashToken(issued.token);
            
            const service = createServiceSupabase();
            const { error: licErr } = await service.from('licenses').insert({
              user_id: null,
              order_id: null,
              plan: meta.licensePlan,
              hwid: hwid.toUpperCase(),
              status: 'active',
              exp_at: expAt,
              token_hash: tokenHash,
              activation_code: null,
            });

            const replyText = licErr 
              ? `❌ Lỗi lưu Supabase: ${licErr.message}`
              : `✅ ĐÃ CẤP KEY (Gói ${planId}):\n\`${issued.token}\``;

            await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                text: callbackQuery.message.text + `\n\n-----------------\n${replyText}`
              })
            });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            await sendTelegramMessage(`Lỗi cấp key: ${errMsg}`);
          }
        } else if (action === 'reject') {
           await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                text: callbackQuery.message.text + `\n\n-----------------\n❌ ĐÃ TỪ CHỐI.`
              })
            });
        }
        
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: callbackQuery.id })
        });
      }
      return NextResponse.json({ ok: true });
    }

    // Handle Telegram webhook message
    if (body.message && body.message.text && body.message.chat) {
      const chatId = body.message.chat.id.toString();
      const expectedChatId = (process.env.AINOVEL_TELEGRAM_CHAT_ID || '').trim();
      const text = body.message.text.trim();

      // Only process messages from the authorized admin chat
      if (chatId !== expectedChatId) {
        return NextResponse.json({ ok: false, error: 'Unauthorized chat ID' });
      }

      if (text.startsWith('/gen ')) {
        const parts = text.split(' ');
        const hwid = parts[1];
        let planId = parts[2] as PaidPlanId;

        // Validating plan
        const validPlanIds = PAID_PLANS.map(p => p.id);
        if (!validPlanIds.includes(planId)) {
          planId = 'lifetime'; // default to lifetime if missing or invalid
        }

        if (!hwid || hwid.length < 6) {
          await sendTelegramMessage('Lỗi: HWID không hợp lệ. Cú pháp: `/gen <hwid> [month|year|lifetime]`');
          return NextResponse.json({ ok: true });
        }

        try {
          // Generate Key
          const issued = issueHmacForPlan(planId, hwid);
          const meta = paidPlanToLicense(planId);
          const expAt = new Date(Date.now() + meta.expSeconds * 1000).toISOString();
          const tokenHash = hashToken(issued.token);

          // Connect to Supabase and save
          const service = createServiceSupabase();
          const { error: licErr } = await service
            .from('licenses')
            .insert({
              user_id: null,
              order_id: null,
              plan: meta.licensePlan,
              hwid: hwid.toUpperCase(),
              status: 'active',
              exp_at: expAt,
              token_hash: tokenHash,
              activation_code: null,
            });

          if (licErr) {
            await sendTelegramMessage(`Lỗi khi lưu vào Supabase: ${licErr.message}`);
          } else {
            // Reply with success
            const reply = [
              `✅ Tạo Key Thành Công!`,
              `📦 Gói: ${planId}`,
              `🖥 HWID: ${hwid.toUpperCase()}`,
              ``,
              `🔑 License Key của bạn:`,
              `\`${issued.token}\``,
              ``,
              `Copy mã trên gửi cho khách.`
            ].join('\n');
            await sendTelegramMessage(reply);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          await sendTelegramMessage(`Lỗi hệ thống: ${errMsg}`);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(toErrorJson(err), {
      status: httpStatusFromError(err),
    });
  }
}

export async function GET(req: Request) {
  // Utility endpoint to easily set webhook
  const { searchParams } = new URL(req.url);
  const setup = searchParams.get('setup');
  const hostUrl = searchParams.get('url');

  if (setup === 'true' && hostUrl) {
    const token = (process.env.AINOVEL_TELEGRAM_BOT_TOKEN || '').trim();
    if (!token) return NextResponse.json({ ok: false, error: 'Missing Bot Token' });

    const webhookUrl = `${hostUrl.replace(/\/$/, '')}/api/entitlement/telegram-webhook`;
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    const data = await res.json();
    return NextResponse.json({ ok: true, data, webhookUrl });
  }

  return NextResponse.json({ ok: true, message: 'Use ?setup=true&url=https://your-domain.com to set webhook.' });
}
