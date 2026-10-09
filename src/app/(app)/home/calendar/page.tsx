import { eq, inArray } from "drizzle-orm";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button, buttonClass, Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { db } from "@/db";
import { organizations, people } from "@/db/schema";
import { getCoveredPersonIds } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { appBaseUrl } from "@/lib/invites";
import { fmtDay } from "@/lib/time";
import { markCalendarConnected, markCalendarNotConnected, resetCalendarLink } from "./actions";
import { PlatformOptions } from "./platform-options";

export const metadata = { title: "Add to your calendar · Calltime" };

export default async function CalendarPage({ searchParams }: PageProps<"/home/calendar">) {
  const user = await requireUser();
  const { reset, connected: justConnected } = await searchParams;
  const base = await appBaseUrl();
  const covered = await getCoveredPersonIds(user.id);
  const connectedAt = user.calendarConnectedAt;

  // Dates render in the org's timezone (the first org this user belongs to), like the Calls home.
  let tz = "America/New_York";
  if (connectedAt && covered.length) {
    const [org] = await db
      .select({ timezone: organizations.timezone })
      .from(people)
      .innerJoin(organizations, eq(organizations.id, people.orgId))
      .where(inArray(people.id, covered))
      .limit(1);
    if (org) tz = org.timezone;
  }

  const httpsUrl = `${base}/api/calendar/${user.calendarToken}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, "webcal://");
  // Google: "add by URL" deep link; cid takes the (URL-encoded) webcal:// address.
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  // Outlook.com "Subscribe from web" deep link (personal accounts); work/school uses outlook.office.com.
  const calendarName = `Calltime — ${user.name}`;
  const outlookQuery = `url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(calendarName)}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/addfromweb?${outlookQuery}`;
  const outlookWorkUrl = `https://outlook.office.com/calendar/0/addfromweb?${outlookQuery}`;

  const options = (
    <>
      <div id="how" className="scroll-mt-20">
        <SectionTitle>Choose your calendar</SectionTitle>
        <PlatformOptions
          options={[
            {
              key: "apple",
              title: "iPhone, iPad or Mac",
              href: webcalUrl,
              button: "Add to iPhone Calendar",
              steps: [
                "Tap the button, then tap Subscribe.",
                "It shows up in the Calendar app under Calendars. New and changed calls arrive within about an hour.",
              ],
            },
            {
              key: "google",
              title: "Google Calendar (Android, Gmail)",
              href: googleUrl,
              button: "Add to Google Calendar",
              steps: [
                "Tap the button while signed in to your Google account, then tap Add.",
                "Google only checks for changes every several hours (sometimes up to a day) — for last-minute changes, check Calltime.",
              ],
            },
            {
              key: "outlook",
              title: "Outlook",
              href: outlookUrl,
              button: "Add to Outlook",
              steps: ["Sign in, check the name, then choose Import."],
              alt: { label: "Work or school Microsoft account? Use this link instead", href: outlookWorkUrl },
            },
          ]}
        />
      </div>

      <SectionTitle>Other apps</SectionTitle>
      <Card className="space-y-3">
        <p className="text-base">
          Any calendar app that can &ldquo;subscribe by URL&rdquo; or &ldquo;add an internet calendar&rdquo; works. Copy this
          link and paste it there:
        </p>
        <code className="block break-all rounded-xl bg-surface-2 px-3 py-2 text-xs">{httpsUrl}</code>
        <CopyButton value={httpsUrl} label="Copy calendar link" />
        <p className="text-sm text-muted">
          Keep this link private: anyone who has it can see these calls. Don&rsquo;t post it in a group chat.
        </p>
      </Card>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Add to your calendar"
        subtitle={
          connectedAt
            ? "Your calls show up in the calendar app you already use."
            : "See every call in the calendar app you already use."
        }
        back={{ href: "/home", label: "Calls" }}
      />

      {reset ? (
        <div className="mb-4">
          <Notice tone="success">
            Your calendar link was reset. Old subscriptions have stopped updating — subscribe again with the new link below.
          </Notice>
        </div>
      ) : null}

      {connectedAt ? (
        <>
          <div className="mb-4">
            <Notice
              tone="success"
              title={justConnected ? "You're all set" : `Calendar sync is on — connected ${fmtDay(connectedAt, tz)}`}
              action={
                <form action={markCalendarNotConnected}>
                  <Button type="submit" size="sm" variant="secondary">
                    Not seeing it?
                  </Button>
                </form>
              }
            >
              {justConnected
                ? `Calendar sync is on — connected ${fmtDay(connectedAt, tz)}. New and changed calls arrive in your calendar on their own.`
                : "New and changed calls arrive in your calendar on their own. Nothing else to do."}
            </Notice>
          </div>

          <SectionTitle>Another phone or app?</SectionTitle>
          <Card>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                <CalendarPlus className="size-4" aria-hidden /> Add it to another device or calendar app
              </summary>
              <div className="mt-2">{options}</div>
            </details>
          </Card>
        </>
      ) : (
        <>
          <Card className="space-y-3">
            <p className="text-base">
              Subscribe once and your calendar fills itself in: every rehearsal and performance you
              {covered.length > 1 ? " (and the people you look after)" : ""} are called to, with the exact time to
              arrive and when you&rsquo;re done. When the schedule changes or a rehearsal is cancelled, your calendar
              updates on its own.
            </p>
            <p className="text-base text-muted">It&rsquo;s read-only — changes you make in your calendar app won&rsquo;t affect Calltime.</p>
          </Card>

          {options}

          <SectionTitle>Did it work?</SectionTitle>
          <Card className="space-y-3">
            <p className="text-base">
              You should see a calendar named <span className="font-medium">&lsquo;{calendarName}&rsquo;</span> in your
              calendar app. New calls arrive within about an hour.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <form action={markCalendarConnected} className="contents">
                <Button type="submit" className="w-full sm:w-auto">
                  Yes, it&rsquo;s there
                </Button>
              </form>
              <a href="#how" className={buttonClass("secondary", "w-full sm:w-auto")}>
                Show me how
              </a>
            </div>
          </Card>
        </>
      )}

      <SectionTitle>Shared it by mistake?</SectionTitle>
      <Card>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
            <RefreshCw className="size-4" aria-hidden /> Reset my calendar link
          </summary>
          <div className="mt-2 space-y-3">
            <Notice tone="warn">
              Resetting makes a new link and turns off the old one. Every calendar already subscribed — on all your devices,
              and anyone you shared it with — stops updating, and you&rsquo;ll need to subscribe again.
            </Notice>
            <form action={resetCalendarLink}>
              <Button variant="danger" type="submit" className="w-full sm:w-auto">
                Yes, reset the link
              </Button>
            </form>
          </div>
        </details>
      </Card>
    </div>
  );
}
