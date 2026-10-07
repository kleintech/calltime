"use client";

import { Check, Clock, LogOut, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { SegmentedControl } from "@/components/segmented-control";
import { Sheet } from "@/components/sheet";
import { toast } from "@/components/toast";
import { Avatar, Badge, Button, cn, Input, TimePill } from "@/components/ui";
import { fmtRange, fmtTime } from "@/lib/time";
import { markAttendance, signOut } from "./actions";

type Status = "present" | "late" | "absent" | "excused";
export type AttendancePerson = {
  id: string;
  name: string;
  isMinor: boolean;
  callAt: string;
  releaseAt: string;
  reasons: string[];
  status: Status | null;
  note: string | null;
  /** Overlapping conflict they reported (shown as a hint once the auto-excuse has been applied or cleared). */
  conflict: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  pickedUpBy: string | null;
  guardians: string[];
};

const BUTTONS: { status: Status; label: string; on: string }[] = [
  { status: "present", label: "Here", on: "border-success bg-success text-surface" },
  { status: "late", label: "Late", on: "border-warn bg-warn text-surface" },
  { status: "absent", label: "Absent", on: "border-danger bg-danger text-surface" },
];

export function AttendanceSheet({
  productionId,
  eventId,
  tz,
  people: initial,
}: {
  productionId: string;
  eventId: string;
  tz: string;
  people: AttendancePerson[];
}) {
  const [people, setPeople] = useState(initial);
  const [filter, setFilter] = useState<"todo" | "all" | "here">("all");
  const [signingOut, setSigningOut] = useState<AttendancePerson | null>(null);
  const [pickup, setPickup] = useState("");
  const [, start] = useTransition();
  // Re-render every 30s so "call time passed" highlighting stays current during rehearsal
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const patch = (id: string, p: Partial<AttendancePerson>) => setPeople((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const mark = (person: AttendancePerson, status: Status) => {
    const next = person.status === status ? null : status; // tap again to clear
    const before = person;
    const here = next === "present" || next === "late";
    patch(person.id, {
      status: next,
      checkedInAt: here ? (person.checkedInAt ?? new Date().toISOString()) : null,
      ...(here ? {} : { checkedOutAt: null, pickedUpBy: null }),
    });
    start(async () => {
      const r = await markAttendance(productionId, eventId, person.id, next);
      if (!r.ok) {
        patch(person.id, before);
        toast(r.error, { tone: "danger" });
      }
    });
  };

  const doSignOut = (person: AttendancePerson, who: string | null) => {
    patch(person.id, { checkedOutAt: new Date().toISOString(), pickedUpBy: who });
    setSigningOut(null);
    start(async () => {
      const r = await signOut(productionId, eventId, person.id, who);
      if (!r.ok) {
        patch(person.id, { checkedOutAt: person.checkedOutAt, pickedUpBy: person.pickedUpBy });
        toast(r.error, { tone: "danger" });
      } else
        toast(`${person.name.split(" ")[0]} signed out${who ? ` with ${who}` : ""}`, {
          tone: "success",
          action: {
            label: "Undo",
            onClick: () => {
              patch(person.id, { checkedOutAt: null, pickedUpBy: null });
              void signOut(productionId, eventId, person.id, null, true);
            },
          },
        });
    });
  };

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, excused: 0, none: 0 };
    for (const p of people) c[p.status ?? "none"] += 1;
    return c;
  }, [people]);

  const overdue = (p: AttendancePerson) => !p.status && new Date(p.callAt).getTime() <= now;
  const missing = people.filter(overdue);
  const shown = people.filter((p) =>
    filter === "all" ? true : filter === "here" ? p.status === "present" || p.status === "late" : !p.status,
  );

  return (
    <div className="mt-4">
      <div className="grid grid-cols-5 gap-1.5 text-center">
        {[
          ["Here", counts.present, "text-success"],
          ["Late", counts.late, "text-warn"],
          ["Absent", counts.absent, "text-danger"],
          ["Excused", counts.excused, "text-muted"],
          ["Not yet", counts.none, "text-ink"],
        ].map(([label, n, tone]) => (
          <div key={label as string} className="rounded-2xl border border-line/80 bg-surface px-1 py-2.5 shadow-xs">
            <p className={cn("tabular font-display text-2xl font-semibold leading-7", tone as string)}>{n}</p>
            <p className="text-[12px] font-medium text-muted">{label}</p>
          </div>
        ))}
      </div>

      {missing.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="flex items-center gap-1.5 font-semibold">
            <TriangleAlert className="size-4" /> {missing.length} past their call and not checked in
          </p>
          <p className="mt-0.5">{missing.map((p) => p.name.split(" ")[0]).join(", ")}</p>
        </div>
      ) : null}

      <div className="mt-4">
        <SegmentedControl
          aria-label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All ${people.length}` },
            { value: "todo", label: `To mark ${counts.none}` },
            { value: "here", label: `Here ${counts.present + counts.late}` },
          ]}
        />
      </div>

      <ul className="mt-3 space-y-2 pb-6">
        {shown.map((p) => {
          const late = overdue(p);
          const here = p.status === "present" || p.status === "late";
          return (
            <li
              key={p.id}
              className={cn(
                "rounded-2xl border bg-surface p-3.5 shadow-card",
                late ? "border-warn/60 bg-warn-soft/40" : "border-line/80",
                p.status === "excused" && "opacity-75",
              )}
            >
              <div className="flex items-center gap-3">
                <Avatar name={p.name} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {p.name} {p.isMinor ? <span className="text-xs font-normal text-muted">· minor</span> : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <TimePill size="sm" tone={late ? "warn" : "neutral"}>
                      <Clock aria-hidden /> {fmtRange(p.callAt, p.releaseAt, tz)}
                    </TimePill>
                    {late ? <span className="text-xs font-semibold text-warn">Call passed</span> : null}
                  </p>
                </div>
                {p.status === "excused" ? (
                  <Badge>Excused</Badge>
                ) : null}
              </div>
              {p.status === "excused" && p.note ? (
                <p className="mt-1 text-xs text-muted">{p.note}</p>
              ) : p.conflict && p.status !== "excused" ? (
                <p className="mt-1 text-xs text-warn">{p.conflict}</p>
              ) : null}
              <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label={`Attendance for ${p.name}`}>
                {BUTTONS.map((b) => {
                  const on = p.status === b.status;
                  return (
                    <button
                      key={b.status}
                      type="button"
                      aria-pressed={on}
                      onClick={() => mark(p, b.status)}
                      className={cn(
                        "inline-flex min-h-12 items-center justify-center gap-1 rounded-xl border text-[15px] font-semibold transition active:scale-[.96]",
                        on ? b.on : "border-line-strong/70 bg-surface text-ink hover:bg-surface-2",
                      )}
                    >
                      {on ? <Check className="size-4" /> : null}
                      {b.label}
                    </button>
                  );
                })}
              </div>
              {here ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {p.checkedInAt ? <span>In {fmtTime(p.checkedInAt, tz)}</span> : null}
                  {p.checkedOutAt ? (
                    <span className="inline-flex items-center gap-1">
                      · Out {fmtTime(p.checkedOutAt, tz)}
                      {p.pickedUpBy ? ` with ${p.pickedUpBy}` : ""}
                      <button
                        type="button"
                        className="ml-1 inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2"
                        aria-label="Undo sign-out"
                        onClick={() => {
                          patch(p.id, { checkedOutAt: null, pickedUpBy: null });
                          void signOut(productionId, eventId, p.id, null, true);
                        }}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!p.isMinor) return doSignOut(p, null);
                        setPickup("");
                        setSigningOut(p);
                      }}
                      className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
                    >
                      <LogOut className="size-3.5" /> Sign out
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
        {shown.length === 0 ? <li className="py-8 text-center text-sm text-muted">No one in this list.</li> : null}
      </ul>

      <Sheet
        open={!!signingOut}
        onOpenChange={(o) => !o && setSigningOut(null)}
        title={signingOut ? `Sign out ${signingOut.name.split(" ")[0]}` : "Sign out"}
        description="Who picked them up?"
        footer={
          signingOut ? (
            <Button type="button" className="w-full" disabled={!pickup.trim()} onClick={() => doSignOut(signingOut, pickup.trim())}>
              Sign out{pickup.trim() ? ` with ${pickup.trim()}` : ""}
            </Button>
          ) : null
        }
      >
        {signingOut ? (
          <div className="space-y-3">
            {signingOut.guardians.length ? (
              <div className="flex flex-wrap gap-2">
                {signingOut.guardians.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => doSignOut(signingOut, g)}
                    className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-medium hover:bg-surface-2"
                  >
                    {g}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No guardian on file — type who collected them.</p>
            )}
            <Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Someone else (name)" maxLength={120} aria-label="Picked up by" />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
