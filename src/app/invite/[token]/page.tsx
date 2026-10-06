import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, LinkButton, buttonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { loadInvite } from "./accept";
import { signOutToInvite } from "./actions";
import { AcceptForm, CreateAccountForm, SignInAcceptForm } from "./forms";

export const metadata: Metadata = { title: "You're invited", robots: { index: false } };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <Link href="/" className="mb-5 text-center font-display text-2xl font-semibold tracking-tight">
        Call<span className="text-gold">time</span>
      </Link>
      {children}
    </div>
  );
}

function Problem({ title, body }: { title: string; body: ReactNode }) {
  return (
    <Shell>
      <Card className="p-6 text-center">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-base text-muted">{body}</p>
        <p className="mt-4 text-sm text-muted">Already set up? Sign in to see your calls.</p>
        <div className="mt-3 flex flex-col gap-2">
          <LinkButton href="/login">Sign in</LinkButton>
        </div>
      </Card>
    </Shell>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const data = await loadInvite(token);
  if (!data) {
    return (
      <Problem
        title="We can't find this invite"
        body="The link may be missing a few characters. Try opening it again from the message, or ask whoever sent it for a new one."
      />
    );
  }
  const { invite, org, production, person, ward, inviter, existingUser, castIn, status } = data;
  const askWho = inviter ? `${inviter.name} at ${org.name}` : org.name;
  if (status === "accepted") {
    return <Problem title="This invite has already been used" body={`If that wasn't you, ask ${askWho} for a new link.`} />;
  }
  if (status === "expired") {
    return <Problem title="This invite link has expired" body={`Ask ${askWho} for a new one.`} />;
  }

  const user = await getCurrentUser();
  const show = production?.title ?? castIn[0]?.production ?? null;
  const castRoles = [...new Set(castIn.filter((c) => c.production === castIn[0]?.production).map((c) => c.role))];

  // Headline + button in the invitee's terms (see docs/ux/GUIDELINES.md §4).
  let headline: ReactNode;
  let cta: string;
  let ctaSignedIn: string;
  if (ward) {
    headline = (
      <>
        {org.name} invited you to see <span className="text-[#f0b454]">{ward.firstName}&apos;s</span> rehearsal calls
        {show ? (
          <>
            {" "}
            for <em>{show}</em>
          </>
        ) : null}
        .
      </>
    );
    cta = `See ${ward.firstName}'s calls`;
    ctaSignedIn = `Add ${ward.firstName} to my account`;
  } else if (person && castRoles.length) {
    headline = (
      <>
        You&apos;ve been cast as <span className="text-[#f0b454]">{castRoles.join(" & ")}</span>
        {show ? (
          <>
            {" "}
            in <em>{show}</em>
          </>
        ) : null}
        !
      </>
    );
    cta = "See my calls";
    ctaSignedIn = "See my calls";
  } else if (person) {
    headline = <>{org.name} invited you to see your rehearsal calls.</>;
    cta = "See my calls";
    ctaSignedIn = "See my calls";
  } else if (production && invite.creativeTitle) {
    headline = (
      <>
        {inviter ? `${inviter.name} invited you` : "You're invited"} to join <em>{production.title}</em> as{" "}
        <span className="text-[#f0b454]">{invite.creativeTitle}</span>.
      </>
    );
    cta = `Join ${production.title}`;
    ctaSignedIn = cta;
  } else if (invite.orgRole === "admin") {
    headline = (
      <>
        {inviter ? `${inviter.name} invited you` : "You're invited"} to help run <span className="text-[#f0b454]">{org.name}</span> on
        Calltime.
      </>
    );
    cta = `Join ${org.name}`;
    ctaSignedIn = cta;
  } else {
    headline = (
      <>
        {inviter ? `${inviter.name} invited you` : "You're invited"} to join <span className="text-[#f0b454]">{org.name}</span> on
        Calltime.
      </>
    );
    cta = `Join ${org.name}`;
    ctaSignedIn = cta;
  }
  const sub = person && castRoles.length ? `${org.name} · Join to see your rehearsal calls.` : inviter ? `Sent by ${inviter.name}` : null;

  const nameGuess = invite.name ?? (person ? `${person.firstName} ${person.lastName}`.trim() : "");
  const loginHref = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;
  const sameAccount = user && user.email === invite.email;

  return (
    <Shell>
      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-sm">
        {/* ticket header */}
        <div className="relative bg-[#1b1726] px-6 pb-6 pt-6 text-[#f7f4ee]">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f0b454]">You&apos;re invited</p>
          <h1 className="mt-2 font-display text-[1.6rem] font-semibold leading-tight">{headline}</h1>
          {sub ? <p className="mt-2 text-base text-[#cfc8dc]">{sub}</p> : null}
          <span aria-hidden className="absolute -bottom-3 -left-3 size-6 rounded-full bg-bg" />
          <span aria-hidden className="absolute -bottom-3 -right-3 size-6 rounded-full bg-bg" />
        </div>
        <div className="border-t-2 border-dashed border-line px-6 py-6">
          {user ? (
            sameAccount ? (
              <div className="space-y-4">
                <p className="text-base text-muted">
                  Signed in as <span className="font-medium text-ink">{user.name}</span>.
                </p>
                <AcceptForm token={token} cta={ctaSignedIn} />
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-base">
                  You&apos;re signed in as <span className="font-semibold">{user.name}</span>{" "}
                  <span className="text-muted">({user.email})</span>, but this invite was sent to{" "}
                  <span className="font-semibold">{invite.email}</span>.
                </p>
                <AcceptForm token={token} cta={`Accept as ${user.name.split(" ")[0]}`} />
                <form action={signOutToInvite}>
                  <input type="hidden" name="token" value={token} />
                  <button type="submit" className={buttonClass("secondary", "w-full")}>
                    Use a different account
                  </button>
                </form>
              </div>
            )
          ) : existingUser?.passwordHash ? (
            <div className="space-y-4">
              <p className="text-base text-muted">
                You already have a Calltime account. Sign in to {ward ? `add ${ward.firstName}` : "accept"}.
              </p>
              <SignInAcceptForm token={token} email={invite.email} cta={ward ? ctaSignedIn : cta} />
              <Link href={loginHref} className="block text-center text-sm text-muted underline-offset-2 hover:underline">
                Use a different account
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <CreateAccountForm token={token} email={invite.email} name={existingUser?.name ?? nameGuess} cta={cta} />
              <Link href={loginHref} className="block text-center text-sm font-medium text-accent">
                I already have an account — sign in
              </Link>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
