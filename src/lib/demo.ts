import "server-only";

/** Seeded demo accounts (scripts/seed.ts). One-tap sign-in is offered only for these. */
export const DEMO_ACCOUNTS = [
  { email: "dana@family.dev", name: "Dana Rivera", role: "Parent", blurb: "Guardian of Maya & Leo — sees both kids' calls in one list." },
  { email: "sam@family.dev", name: "Sam Chen", role: "Teen performer", blurb: "Plays Frederic. Own account, own calendar feed." },
  { email: "director@riverside.dev", name: "Jordan Ellis", role: "Director", blurb: "Builds the schedule scene by scene and publishes it." },
  { email: "sm@riverside.dev", name: "Casey Lin", role: "Stage manager", blurb: "Runs rehearsal reports, conflicts and call sheets." },
  { email: "office@riverside.dev", name: "Pat Okafor", role: "Company admin", blurb: "Creates productions, manages families and invites." },
  { email: "marcus@family.dev", name: "Marcus Webb", role: "Parent", blurb: "Guardian of Ava, one of Stanley's daughters." },
  { email: "choreo@riverside.dev", name: "Alex Moreau", role: "Choreographer", blurb: "Calls dancers by group for their numbers." },
  { email: "music@riverside.dev", name: "Priya Natarajan", role: "Music director", blurb: "Runs vocal sessions alongside staging." },
  { email: "admin@calltime.dev", name: "Platform Admin", role: "Platform admin", blurb: "Sets up new theater companies on Calltime." },
] as const;

/** Demo sign-in is available in dev, or in production only when DEMO_MODE=1. */
export function demoEnabled() {
  return process.env.DEMO_MODE === "1" || process.env.NODE_ENV !== "production";
}

export function isDemoEmail(email: string) {
  return DEMO_ACCOUNTS.some((a) => a.email === email);
}
