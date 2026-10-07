import "server-only";

/**
 * Seeded demo accounts (scripts/seed.ts). One-tap sign-in is offered only for these.
 * Never add a platform admin here: one-tap sign-in needs no credentials, so anyone on the internet
 * could become one on a DEMO_MODE deployment.
 */
export const DEMO_ACCOUNTS = [
  { email: "dana@family.dev", name: "Dana Rivera", role: "Parent", blurb: "Guardian of Maya & Leo — sees both kids' calls in one list." },
  { email: "sam@family.dev", name: "Sam Chen", role: "Teen performer", blurb: "Plays Frederic. Own account, own calendar feed." },
  { email: "director@riverside.dev", name: "Jordan Ellis", role: "Director", blurb: "Builds the schedule scene by scene and publishes it." },
  { email: "sm@riverside.dev", name: "Casey Lin", role: "Stage manager", blurb: "Runs rehearsal reports, conflicts and call sheets." },
  { email: "office@riverside.dev", name: "Pat Okafor", role: "Company admin", blurb: "Creates productions, manages families and invites." },
  { email: "marcus@family.dev", name: "Marcus Webb", role: "Parent", blurb: "Guardian of Ava, one of Stanley's daughters." },
  { email: "choreo@riverside.dev", name: "Alex Moreau", role: "Choreographer", blurb: "Calls dancers by group for their numbers." },
  { email: "music@riverside.dev", name: "Priya Natarajan", role: "Music director", blurb: "Runs vocal sessions alongside staging." },
] as const;

/** Demo sign-in is available in dev, or in production only when DEMO_MODE=1. */
export function demoEnabled() {
  return process.env.DEMO_MODE === "1" || process.env.NODE_ENV !== "production";
}

export function isDemoEmail(email: string) {
  return DEMO_ACCOUNTS.some((a) => a.email === email);
}

/**
 * Anyone on the internet can become a demo account, so the demo can't be allowed to reach out of
 * the sandbox: no invite links to real inboxes, no API keys, no changing who an email points at.
 * Returns the message to show, or null when the action is fine.
 */
export function demoRestriction(email: string, what = "do that"): string | null {
  if (!demoEnabled() || !isDemoEmail(email)) return null;
  return `Demo accounts can't ${what}. Create your own company to try it for real.`;
}
