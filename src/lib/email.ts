import "server-only";

/**
 * Transactional email through Resend (plain fetch, no SDK). Off until RESEND_API_KEY and
 * RESEND_FROM are set; callers must offer a no-email path (e.g. a link an admin can text).
 */
export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; idempotencyKey?: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM; // e.g. "Calltime <schedule@yourdomain.org>" (verified in Resend)
  if (!apiKey || !from) return { ok: false as const, reason: "skipped: RESEND_API_KEY / RESEND_FROM not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) return { ok: false as const, reason: `resend ${res.status}: ${await res.text()}` };
  return { ok: true as const, id: ((await res.json()) as { id?: string }).id };
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
