import { RefreshCw } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button, Card, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { getCoveredPersonIds } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { appBaseUrl } from "@/lib/invites";
import { resetCalendarLink } from "./actions";
import { PlatformOptions } from "./platform-options";

export const metadata = { title: "Add to your calendar · Calltime" };

export default async function CalendarPage({ searchParams }: PageProps<"/home/calendar">) {
  const user = await requireUser();
  const { reset } = await searchParams;
  const base = await appBaseUrl();
  const covered = await getCoveredPersonIds(user.id);

  const httpsUrl = `${base}/api/calendar/${user.calendarToken}.ics`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, "webcal://");
  // Google: "add by URL" deep link; cid takes the (URL-encoded) webcal:// address.
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  // Outlook.com "Subscribe from web" deep link (personal accounts); work/school uses outlook.office.com.
  const outlookQuery = `url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(`Calltime — ${user.name}`)}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/addfromweb?${outlookQuery}`;
  const outlookWorkUrl = `https://outlook.office.com/calendar/0/addfromweb?${outlookQuery}`;

  return (
    <div>
      <PageHeader
        title="Add to your calendar"
        subtitle="See every call in the calendar app you already use."
        back={{ href: "/home", label: "Calls" }}
      />

      {reset ? (
        <div className="mb-4">
          <Notice tone="success">
            Your calendar link was reset. Old subscriptions have stopped updating — subscribe again with the new link below.
          </Notice>
        </div>
      ) : null}

      <Card className="space-y-3">
        <p className="text-base">
          Subscribe once and your calendar fills itself in: every rehearsal and performance you
          {covered.length > 1 ? " (and the people you look after)" : ""} are called to, with the exact time to
          arrive and when you&rsquo;re done. When the schedule changes or a rehearsal is cancelled, your calendar
          updates on its own.
        </p>
        <p className="text-base text-muted">It&rsquo;s read-only — changes you make in your calendar app won&rsquo;t affect Calltime.</p>
      </Card>

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

