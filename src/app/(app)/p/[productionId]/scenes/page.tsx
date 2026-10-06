import { asc, eq, inArray } from "drizzle-orm";
import { ArrowDown, ArrowUp, ChevronRight, Clapperboard, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { roles, sceneRoles, scenes } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, SectionTitle } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { requireProductionEditor } from "@/lib/access";
import { daysSince, getRehearsalStats } from "@/lib/production-queries";
import { fmtDay } from "@/lib/time";
import { RehearsalMeter, type MeterData } from "./rehearsal-meter";
import { IconSubmit } from "@/app/(app)/productions/_components/form";
import { moveScene, createScene } from "./actions";
import { SceneForm } from "./scene-form";

export default async function ScenesPage({ params }: PageProps<"/p/[productionId]/scenes">) {
  const { productionId } = await params;
  const { org } = await requireProductionEditor(productionId);
  const tz = org.timezone;
  const now = new Date();
  const stats = await getRehearsalStats(productionId, now);
  const maxCount = Math.max(0, ...[...stats.scenes.values()].map((s) => s.count));
  const meter = (id: string): MeterData => {
    const st = stats.scenes.get(id);
    return {
      count: st?.count ?? 0,
      last: st?.last?.toISOString() ?? null,
      daysAgo: st?.last ? daysSince(st.last, now) : null,
      nextLabel: st?.next ? `${fmtDay(st.next.at, tz)}${st.next.draft ? " (draft)" : ""}` : null,
    };
  };

  const [sceneRows, roleRows] = await Promise.all([
    db.select().from(scenes).where(eq(scenes.productionId, productionId)).orderBy(asc(scenes.act), asc(scenes.sortOrder), asc(scenes.createdAt)),
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
  ]);
  const links = sceneRows.length
    ? await db.select().from(sceneRoles).where(inArray(sceneRoles.sceneId, sceneRows.map((s) => s.id)))
    : [];
  const roleById = new Map(roleRows.map((r) => [r.id, r]));
  const roleOrder = new Map(roleRows.map((r, i) => [r.id, i]));
  const rolesByScene = new Map<string, string[]>();
  for (const l of links) rolesByScene.set(l.sceneId, [...(rolesByScene.get(l.sceneId) ?? []), l.roleId]);

  const acts = [...new Set(sceneRows.map((s) => s.act))];
  const base = `/p/${productionId}`;
  const nextAct = sceneRows.at(-1)?.act ?? 1;

  const addScene = (
    <Sheet
      trigger={
        <Button variant={sceneRows.length ? "soft" : "primary"} size={sceneRows.length ? "sm" : "md"}>
          <Plus /> Add scene
        </Button>
      }
      title="Add a scene"
      description="Stays open so you can add the next one."
    >
      <SceneForm
        action={createScene.bind(null, productionId)}
        scene={{ act: nextAct, number: "", name: "", description: null, songs: null, pages: null }}
        roles={roleRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
        submitLabel="Add scene"
        resetOnSuccess
      />
    </Sheet>
  );

  return (
    <div>
      {sceneRows.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[15px] text-muted">
            {sceneRows.length} scene{sceneRows.length === 1 ? "" : "s"} · tap one to edit its roles
          </p>
          <div className="flex items-center gap-1">
            <LinkButton href={`${base}/breakdown`} variant="ghost" size="sm">
              Breakdown
            </LinkButton>
            {addScene}
          </div>
        </div>
      ) : null}

      {sceneRows.length && stats.started ? (
        <p className="mt-2 text-xs text-muted">
          Bars show how often each scene has been called to rehearsal (green this week, gold last week, orange
          longer). Full-cast runs are counted separately: {stats.runs.count}
          {stats.runs.last ? `, last ${fmtDay(stats.runs.last, tz)}` : ""}.
        </p>
      ) : null}

      {sceneRows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<Clapperboard />}
            title="No scenes yet"
            body="Add the scenes of the show in running order. Then mark which roles appear in each one."
            action={
              <>
                {addScene}
                <LinkButton href={`${base}/import`} variant="secondary">
                  Import from a spreadsheet
                </LinkButton>
              </>
            }
          />
        </div>
      ) : (
        acts.map((act) => {
          const inAct = sceneRows.filter((s) => s.act === act);
          return (
            <section key={act}>
              <SectionTitle>{act === 0 ? "Prologue" : `Act ${act}`}</SectionTitle>
              <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line/80 bg-surface shadow-card">
                {inAct.map((s, i) => {
                  const rs = (rolesByScene.get(s.id) ?? [])
                    .sort((a, b) => (roleOrder.get(a) ?? 0) - (roleOrder.get(b) ?? 0))
                    .map((id) => roleById.get(id))
                    .filter((r) => !!r);
                  return (
                    <div key={s.id} className="flex items-stretch">
                      <Link href={`${base}/scenes/${s.id}`} className="min-w-0 flex-1 px-4 py-3 hover:bg-surface-2">
                        <div className="flex items-baseline gap-2">
                          <span className="shrink-0 text-xs font-semibold text-accent">
                            {/^\d+[A-Za-z]?$/.test(s.number) ? `Sc ${s.number}` : s.number}
                          </span>
                          <span className="truncate font-medium">{s.name}</span>
                          <ChevronRight className="ml-auto size-4 shrink-0 text-muted" />
                        </div>
                        {s.songs || s.pages ? (
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {[s.songs, s.pages ? `pp. ${s.pages}` : null].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        <RehearsalMeter d={meter(s.id)} max={maxCount} started={stats.started} />
                        <div className="mt-2 flex flex-wrap gap-1">
                          {rs.length ? (
                            rs.map((r) => (
                              <Badge key={r.id} tone={r.kind === "lead" ? "accent" : "neutral"}>
                                {r.name}
                              </Badge>
                            ))
                          ) : (
                            <Badge tone="warn">No roles yet</Badge>
                          )}
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col justify-center border-l border-line">
                        <form action={moveScene.bind(null, productionId, s.id, "up")}>
                          <IconSubmit label="Move up" className={i === 0 ? "invisible" : ""}>
                            <ArrowUp className="size-4" />
                          </IconSubmit>
                        </form>
                        <form action={moveScene.bind(null, productionId, s.id, "down")}>
                          <IconSubmit label="Move down" className={i === inAct.length - 1 ? "invisible" : ""}>
                            <ArrowDown className="size-4" />
                          </IconSubmit>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

    </div>
  );
}
