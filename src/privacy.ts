/**
 * The privacy policy. It describes what this code actually does, so if you change what gets stored
 * or who can see it, change this page too.
 */
import { esc, page, xLink } from './ui.js';

const REPO = 'https://github.com/finereli/whatsapp-mcp';

export function privacyPage(operator?: string, hosted = false, contact?: string) {
  return page('Privacy policy', hosted ? hostedPolicy(operator, contact) : ownPolicy(operator, contact));
}

/** Both versions say the same thing about encryption, because it is the same code. */
const encryption = (hosted: boolean) => hosted ? `<p><strong>Encryption.</strong> Messages, chat and contact names and the WhatsApp session keys are encrypted before they are stored. The key comes from the login service when you sign in with Google, the same key every time. It is never stored next to your messages; only a copy locked by it is. Timestamps, message types, which side sent each message, roughly how long it is, and scrambled stand-ins for chat and contact ids stay readable, so the database can sort and group. Someone with database access could see how many chats you have, how active they are and when, but not who they were with or what they said.</p>
<p>This is encryption at rest, not end-to-end, and the operator is not locked out. The login service is run by the same person as this one and can work out your key, and the server holds it in memory and works with your messages in plain text while you or an agent you connected is making a request. What the encryption protects against is a leaked database, a stolen backup, or someone at the hosting company looking. It does not protect against the operator deliberately reading your messages, which is why the code is open source and why you can run your own copy, where the key comes from a password only you know.</p>
<p>Your stored messages are only a copy. If your account is ever deleted or lost, link WhatsApp again and you get whatever history WhatsApp sends.</p>` : `<p><strong>Encryption.</strong> Messages, chat and contact names and the WhatsApp session keys are encrypted before they are stored, with a key that is made from your password. The key itself is never stored; only a copy locked by your password is. Timestamps, message types, which side sent each message, roughly how long it is, and scrambled stand-ins for chat and contact ids stay readable, so the database can sort and group. Someone with database access could see how many chats you have, how active they are and when, but not who they were with or what they said.</p>
<p>This is encryption at rest, not end-to-end. While you or an agent you connected is making a request, the server holds your key in memory and works with your messages in plain text. Someone who controls the server's code could change it to capture passwords. The code is open source so it can be checked.</p>
<p><strong>If you lose your password, your stored messages cannot be recovered</strong> by anyone. You can start again by linking WhatsApp again, and you get whatever history WhatsApp sends.</p>`;

function ownPolicy(operator?: string, contact?: string) {
  return `
<h1>Privacy policy</h1>
<p class="muted">Last updated October 19, 2026</p>

<p>Short version: this server reads one person's WhatsApp messages and shows them only to that person's own AI agent. Nothing is sold, shared or used for advertising.</p>

<h2>Who runs this</h2>
<p>This is a personal server${operator ? `, run by ${esc(operator)}` : ''}. It is open source (<a href="${REPO}">source</a>), and each copy is run by one person, the owner, in their own Cloudflare account. Only the owner can sign in.</p>

<h2>What it reads</h2>
<p><strong>WhatsApp messages.</strong> The owner links their phone to the server as a linked device, the way WhatsApp Web works. The server then receives the owner's messages and chat names.</p>
<p><strong>Names.</strong> The owner's AI agent can save a name for a phone number, for example after finding it in the owner's contacts. The server stores the name and number the agent gives it, next to the messages. It never connects to a contacts service itself.</p>

<h2>What it keeps</h2>
<p>Message text (photos, voice notes and documents are kept only as labels like [image], never as files), chat and contact names, names the owner or their agent saved for phone numbers, and the WhatsApp session credentials. All of it lives in a database inside the owner's own Cloudflare account. This software stores nothing anywhere else.</p>
${encryption(false)}

<h2>Who can see it</h2>
<p>Only the owner, and the AI agents the owner chooses to connect. When an agent searches or reads messages, the text it reads goes to whoever runs that agent, for example the company behind the AI model, under the owner's own agreement with them. Cloudflare hosts the data as infrastructure.</p>
<p>The server does not sell data, does not use it for advertising, does not use it to train models, and does not share it with anyone else. No person other than the owner reads it.</p>

<h2>Anyone else who tries to sign in</h2>
<p>If anyone other than the owner tries to sign in, they are turned away, and nothing about them is kept.</p>

<h2>Deleting your data</h2>
<p>Sign in and choose "Delete my data" on the dashboard. It unlinks WhatsApp and erases the stored messages, names and keys. "Unlink and scan again" removes the server's access to WhatsApp but keeps the messages already stored. You can also delete the Worker and its Durable Object storage in the Cloudflare dashboard.</p>

<h2>Questions and changes</h2>
<p>Questions go in an <a href="${REPO}/issues">issue on GitHub</a>${contact ? `, or to ${xLink(contact)} on X` : ''}. If this policy changes, the new version replaces this page and the date above changes with it.</p>

<p style="margin-top:32px"><a href="/tos">Terms of service</a></p>
<p><a href="/">Back</a></p>`;
}

function hostedPolicy(operator?: string, contact?: string) {
  return `
<h1>Privacy policy</h1>
<p class="muted">Last updated October 19, 2026</p>

<p>Short version: this service stores your WhatsApp messages encrypted, and shows them only to you and the AI agents you connect. Nothing is sold, shared or used for advertising. The operator could technically read them and does not.</p>

<h2>Who runs this</h2>
<p>This service is run by ${operator ? (contact ? `<a href="https://x.com/${contact}" rel="noopener">${esc(operator)}</a>` : esc(operator)) : 'its operator'}. The software is open source (<a href="${REPO}">source</a>) and you can run your own copy instead, in which case none of this applies to you.</p>

<h2>What it reads</h2>
<p><strong>WhatsApp messages.</strong> You link your phone to the service as a linked device, the way WhatsApp Web works. The service then receives your messages and chat names.</p>
<p><strong>Your account.</strong> You sign in with Google through a login service. It sees your email and name when you do; this service does not keep them. It keeps an anonymous id made from your Google account id, and a copy of your data key locked by the key the login service gives it.</p>
<p><strong>The waitlist.</strong> If the service is full and you join the waitlist, it keeps the email you give and when you gave it. The operator uses it to tell you when a spot opens, and may write to you about other ways to get access, such as paid spots. It is not tied to your messages or account, and it is deleted whenever you ask.</p>
<p><strong>Names.</strong> Your AI agent can save a name for a phone number, for example after finding it in your contacts. The service stores the name and number the agent gives it, next to your messages. It never connects to a contacts service itself.</p>

<h2>What it keeps</h2>
<p>Message text (photos, voice notes and documents are kept only as labels like [image], never as files), chat and contact names, names you or your agent saved for phone numbers, and the WhatsApp session credentials. They are stored in a database at Cloudflare, one per user, kept apart from everyone else's. If a history is larger than the service takes, it is not kept: what arrived is deleted when the limit is reached and your phone is unlinked.</p>
${encryption(true)}

<h2>Who can see it</h2>
<p>You, and the AI agents you choose to connect. When an agent searches or reads your messages, the text it reads goes to whoever runs that agent, for example the company behind the AI model, under your own agreement with them. Cloudflare hosts the data as infrastructure and holds only the encrypted copy.</p>
<p>The service does not sell data, does not use it for advertising, does not use it to train models, and does not share it with anyone else. The operator does not look at your stored messages. As explained under encryption, the operator could work out your key, so this is a promise and not a lock.</p>

<h2>Other people's messages</h2>
<p>Your chats include things other people wrote to you. They have not agreed to this service handling them. That is a real tradeoff, and it is yours to weigh before you link an account.</p>

<h2>Deleting your data</h2>
<p>Sign in and choose "Delete my data" on the dashboard. It unlinks WhatsApp and erases your stored messages, names, keys and account. Unlinking alone (the "Unlink and scan again" button) keeps what is stored.</p>

<h2>Questions and changes</h2>
<p>Questions go in an <a href="${REPO}/issues">issue on GitHub</a>${contact ? `, or to ${xLink(contact)} on X` : ''}. If this policy changes, the new version replaces this page and the date above changes with it.</p>

<p style="margin-top:32px"><a href="/tos">Terms of service</a></p>
<p><a href="/">Back</a></p>`;
}
