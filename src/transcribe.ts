/**
 * Voice notes to text with Workers AI, Cloudflare's own models, through the `AI` binding. The audio goes to a
 * model running on Cloudflare and nowhere else, and only when an agent asks for a transcript. No binding, no tool.
 */

/** The model used unless TRANSCRIBE_MODEL names another. See "Transcribing voice notes" in the README. */
export const DEFAULT_TRANSCRIBE_MODEL = '@cf/openai/whisper-large-v3-turbo';
/** Longest voice note sent in one request. WhatsApp voice notes run about 2 KB a second, so this is over an hour. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** WhatsApp sends "audio/ogg; codecs=opus"; the models want the plain type. */
const baseMime = (mime?: string) => mime?.split(';')[0].trim().toLowerCase() || 'audio/ogg';

export async function transcribe(ai: Ai, audio: Uint8Array, opts: { mime?: string; model?: string }): Promise<string> {
  const model = opts.model || DEFAULT_TRANSCRIBE_MODEL;
  const run = ai.run.bind(ai) as (model: string, input: unknown) => Promise<any>;
  if (model.startsWith('@cf/deepgram/')) {
    const out = await run(model, {
      audio: { body: new Blob([audio]).stream(), contentType: baseMime(opts.mime) },
      detect_language: true, smart_format: true, punctuate: true,
    });
    return (out?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
  }
  // the Whisper family: large-v3-turbo takes base64, the older ones a byte array
  const input = model.includes('large-v3') ? { audio: Buffer.from(audio).toString('base64'), vad_filter: true } : { audio: [...audio] };
  const out = await run(model, input);
  return (out?.text ?? '').trim();
}
