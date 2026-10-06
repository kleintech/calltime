import { CalendarDays, CalendarPlus, Copy, MapPin, Plus, Printer, Send, Sparkles, Trash2, TriangleAlert, UsersRound } from "lucide-react";
import { SegmentedControl } from "@/components/segmented-control";
import { Sheet, SheetClose } from "@/components/sheet";
import { Tabs } from "@/components/tabs";
import {
  ActionBar,
  Avatar,
  Badge,
  Button,
  CallTime,
  Card,
  CardLink,
  Checkbox,
  Chip,
  ChipToggle,
  Divider,
  EmptyState,
  Fab,
  Field,
  Heading,
  IconButton,
  IconTile,
  Input,
  LinkButton,
  List,
  ListRow,
  Menu,
  MenuItem,
  Notice,
  PageHeader,
  PersonChip,
  SectionTitle,
  SegmentedLinks,
  Select,
  Skeleton,
  SkeletonCard,
  Spinner,
  Stat,
  Switch,
  Textarea,
  Ticket,
  TimePill,
} from "@/components/ui";
import { ToastDemo } from "./toast-demo";

export const metadata = { title: "Design system" };

/** Living style guide: every shared component in one place. Not linked from the nav. */
export default async function DesignPage({ searchParams }: PageProps<"/design">) {
  const sp = await searchParams;
  const bar = sp.bar === "1";
  return (
    <div className={bar ? "pb-24" : undefined}>
      <PageHeader
        eyebrow="Calltime"
        title="Design system"
        subtitle="Every shared component, in both themes. See docs/DESIGN.md."
        actions={
          <>
            <LinkButton href="/design?bar=1" variant="secondary" size="sm">
              Show ActionBar
            </LinkButton>
          </>
        }
      />

      <SectionTitle>Buttons</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Button>Publish 3 rehearsals</Button>
        <Button variant="secondary">Duplicate</Button>
        <Button variant="soft">
          <Plus /> Add block
        </Button>
        <Button variant="gold">
          <CalendarPlus /> Add to my calendar
        </Button>
        <Button variant="ghost">Not yet</Button>
        <Button variant="danger">Cancel rehearsal</Button>
        <Button variant="danger-solid">Delete scene</Button>
        <Button disabled>
          <Spinner className="size-4" /> Saving…
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
        <IconButton label="Print call sheet" variant="secondary">
          <Printer />
        </IconButton>
        <IconButton label="Add" variant="primary">
          <Plus />
        </IconButton>
        <IconButton label="Copy link">
          <Copy />
        </IconButton>
        <Menu id="demo-menu" label="Week actions">
          <MenuItem icon={<Copy />}>Duplicate last week</MenuItem>
          <MenuItem icon={<Send />}>Publish all drafts</MenuItem>
          <MenuItem icon={<Printer />}>Print call sheet</MenuItem>
          <MenuItem icon={<Trash2 />} tone="danger">
            Delete drafts
          </MenuItem>
        </Menu>
      </div>

      <SectionTitle>The next call</SectionTitle>
      <Ticket
        accent="#c2410c"
        stub={
          <div className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <MapPin className="size-4" /> Riverside Hall, Room B
            </span>
            <Button size="sm" variant="secondary">
              Details
            </Button>
          </div>
        }
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-[.08em] text-gold">Tomorrow · Tue Oct 7</span>
          <Badge tone="warn">
            <TriangleAlert /> Changed
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <PersonChip name="Maya" />
          <PersonChip name="Leo" />
        </div>
        <CallTime className="mt-3">6:00–7:30 PM</CallTime>
        <p className="mt-1 text-base">Pirates of Penzance · Rehearsal</p>
        <p className="text-[15px] text-muted">Act 1 Sc 2 “Pour, O pour” · Pirates</p>
      </Ticket>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2">
            <TimePill tone="accent">6:00 PM</TimePill>
            <TimePill>7:30 PM</TimePill>
            <TimePill tone="danger" strike>
              4:00 PM
            </TimePill>
          </div>
          <CallTime size="md" strike className="mt-3" label="Cancelled">
            4:00–5:30 PM
          </CallTime>
        </Card>
        <CardLink href="/home/calendar" tone="gold">
          <div className="flex items-center gap-3">
            <IconTile tone="gold">
              <CalendarPlus />
            </IconTile>
            <div>
              <div className="font-semibold">Add to my calendar</div>
              <div className="text-sm text-muted">Updates automatically.</div>
            </div>
          </div>
        </CardLink>
      </div>

      <SectionTitle>Badges & chips</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        <Badge>Neutral</Badge>
        <Badge tone="accent" dot>
          In rehearsal
        </Badge>
        <Badge tone="gold">
          <Sparkles /> Opens in 12 days
        </Badge>
        <Badge tone="success">Published</Badge>
        <Badge tone="warn">Draft</Badge>
        <Badge tone="danger">Cancelled</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip href="/design" active>
          Everyone
        </Chip>
        <Chip href="/design?p=maya" color="hsl(200 45% 45%)">
          Maya
        </Chip>
        <Chip href="/design?p=leo" color="hsl(320 45% 45%)" count={3}>
          Leo
        </Chip>
      </div>
      <form className="mt-3 flex flex-wrap gap-2">
        <ChipToggle name="d" value="30" label="30m" type="radio" />
        <ChipToggle name="d" value="45" label="45m" type="radio" defaultChecked />
        <ChipToggle name="d" value="60" label="1h" type="radio" />
        <ChipToggle name="d" value="90" label="1.5h" type="radio" />
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SegmentedLinks
          aria-label="View"
          items={[
            { href: "/design", label: "Week", active: true },
            { href: "/design?v=month", label: "Month" },
          ]}
        />
        <SegmentedControl
          aria-label="Picker"
          name="picker"
          options={[
            { value: "scenes", label: "Scenes" },
            { value: "groups", label: "Groups" },
            { value: "people", label: "People" },
          ]}
        />
      </div>

      <SectionTitle>Stats</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Called" value={23} hint="first call 6:00" icon={<UsersRound />} tone="accent" />
        <Stat label="Conflicts" value={2} icon={<TriangleAlert />} tone="warn" />
        <Stat label="Rehearsals" value={14} icon={<CalendarDays />} tone="gold" />
      </div>

      <SectionTitle action={<LinkButton href="/design" variant="ghost" size="sm">See all</LinkButton>}>Lists</SectionTitle>
      <List>
        <ListRow href="/design" leading={<Avatar name="Maya Chen" />} title="Maya Chen" subtitle="Mabel · Daughters" />
        <ListRow href="/design" leading={<Avatar name="Leo Chen" />} title="Leo Chen" subtitle="Police" right={<Badge tone="warn">Conflict</Badge>} />
        <ListRow
          leading={
            <IconTile>
              <CalendarDays />
            </IconTile>
          }
          title="Tue, Oct 7"
          subtitle="Rehearsal · 6:00–9:00 PM"
          right={<TimePill size="sm">6:00</TimePill>}
        />
      </List>

      <SectionTitle>Notices</SectionTitle>
      <div className="space-y-2">
        <Notice tone="warn" title="2 changes since you last looked" action={<Button size="sm" variant="secondary">Review</Button>}>
          Thu rehearsal cancelled · Sat call moved to 10:00 AM
        </Notice>
        <Notice tone="success">Saved.</Notice>
        <Notice tone="danger">Enter an email like name@example.com</Notice>
        <Notice>Drafts are only visible to the creative team.</Notice>
      </div>

      <SectionTitle>Forms</SectionTitle>
      <Card padding="lg" className="space-y-4">
        <Field label="Rehearsal title" optional hint="Families see this on their call card.">
          <Input placeholder="Act 1 run" />
        </Field>
        <Field label="Email" error="Enter an email like name@example.com">
          <Input type="email" aria-invalid defaultValue="dana@" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="time" defaultValue="18:00" step={900} />
          </Field>
          <Field label="Room">
            <Select defaultValue="b">
              <option value="a">Main stage</option>
              <option value="b">Room B</option>
            </Select>
          </Field>
        </div>
        <Field label="Notes" optional>
          <Textarea placeholder="Bring character shoes" />
        </Field>
        <Checkbox label="Notify families" description="Sends to 31 people" defaultChecked />
        <Switch label="Calendar sync" description="Keep my phone's calendar up to date" defaultChecked />
        <Button className="w-full sm:w-auto">Publish rehearsal</Button>
      </Card>

      <SectionTitle>Overlays</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Sheet
          trigger={<Button variant="secondary">Open sheet</Button>}
          title="Publish 3 rehearsals?"
          description="31 people will see their calls. Families with calendar sync get them automatically."
          footer={
            <>
              <SheetClose variant="ghost">Not yet</SheetClose>
              <SheetClose variant="primary">Publish</SheetClose>
            </>
          }
        >
          <List>
            <ListRow title="Tue, Oct 7" subtitle="6:00–9:00 PM · 23 called" />
            <ListRow title="Thu, Oct 9" subtitle="6:00–9:00 PM · 18 called" />
            <ListRow title="Sat, Oct 11" subtitle="10:00 AM–1:00 PM · 31 called" />
          </List>
        </Sheet>
      </div>
      <div className="mt-3">
        <ToastDemo />
      </div>

      <SectionTitle>Tabs</SectionTitle>
      <Tabs
        aria-label="Call picker"
        items={[
          { value: "scenes", label: "Scenes", count: 14, content: <p className="text-muted">Scenes list…</p> },
          { value: "groups", label: "Groups", content: <p className="text-muted">Groups…</p> },
          { value: "roles", label: "Roles", content: <p className="text-muted">Roles…</p> },
          { value: "people", label: "People", content: <p className="text-muted">People…</p> },
        ]}
      />

      <Heading>Loading</Heading>
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <SkeletonCard />
        <SkeletonCard lines={3} />
      </div>

      <Divider label="Empty" />
      <EmptyState
        icon={<CalendarDays />}
        title="No calls yet for Maya"
        body="When the director publishes the rehearsal schedule, calls show up here and in your calendar."
        action={<Button variant="gold">Add to my calendar</Button>}
      />

      <Fab href="/design" label="New rehearsal" icon={<Plus />} />
      {bar ? (
        <ActionBar>
          <span className="min-w-0 flex-1 truncate pl-2 text-[15px] font-medium">3 drafts this week</span>
          <Button>Review & publish</Button>
        </ActionBar>
      ) : null}
    </div>
  );
}
