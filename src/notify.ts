/**
 * Email the operator about something that needs them: the service filling up, or full. Uses Cloudflare Email
 * Routing's send_email binding, which can only send to addresses verified in the account, so it can't be
 * turned into a way to email strangers. Nothing about a user goes in a message except counts. Failing to
 * notify never fails the thing that triggered it.
 */
import { EmailMessage } from 'cloudflare:email';

export interface NotifyEnv {
  /** send_email binding with destination_address set to ALERT_TO, so it can't write to anyone else. */
  ALERT_EMAIL?: SendEmail;
  /** The operator's address. Must be verified in Email Routing. */
  ALERT_TO?: string;
  /** The From address, on a domain with Email Routing enabled, e.g. whatsapp-mcp@example.com. */
  ALERT_FROM?: string;
}

export async function notify(env: NotifyEnv, title: string, message: string) {
  if (!env.ALERT_EMAIL || !env.ALERT_FROM || !env.ALERT_TO) return;
  try {
    const raw = [
      `From: whatsapp-mcp <${env.ALERT_FROM}>`,
      `To: <${env.ALERT_TO}>`,
      `Subject: ${title.replace(/[\r\n]+/g, ' ')}`,
      `Message-ID: <${crypto.randomUUID()}@${env.ALERT_FROM.split('@')[1]}>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      message,
    ].join('\r\n');
    await env.ALERT_EMAIL.send(new EmailMessage(env.ALERT_FROM, env.ALERT_TO, raw));
  } catch (e) {
    console.error('notify failed', e);
  }
}
