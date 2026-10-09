import { and, asc, eq } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { resources, roles, sceneRoles, scenes } from "@/db/schema";
import Link from "next/link";
import { fmtDay } from "@/lib/time";
import { addResource } from "../../resources/actions";
import { ResourceForm } from "../../resources/resource-form";
import { ResourceList } from "../../resources/resource-list";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { daysSince, getRehearsalStats, isUuid } from "@/lib/production-queries";
import { ConfirmForm, SubmitButton } from "@/app/(app)/productions/_components/form";
import { deleteScene, updateScene } from "../actions";
import { SceneForm } from "../scene-form";

export default async function ScenePage({ params }: PageProps<"/p/[productionId]/scenes/[sceneId]">) {
  const { productionId, sceneId } = await params;
  await requireProductionEditor(productionId);
  if (!isUuid(sceneId)) notFound();
  const scene = await db.query.scenes.findFirst({ where: and(eq(scenes.id, sceneId), eq(scenes.productionId, productionId)) });
  if (!scene) notFound();
  const [roleRows, links, sceneResources, stats, { org }] = await Promise.all([
    db.select().from(roles).where(eq(roles.productionId, productionId)).orderBy(asc(roles.sortOrder), asc(roles.name)),
    db.select().from(sceneRoles).where(eq(sceneRoles.sceneId, sceneId)),
    db
      .select()
      .from(resources)
      .where(and(eq(resources.productionId, productionId), eq(resources.sceneId, sceneId)))
      .orderBy(asc(resources.sortOrder), asc(resources.createdAt)),
    getRehearsalStats(productionId),
    requireProductionEditor(productionId),
  ]);
  const st = stats.scenes.get(sceneId);
  const tz = org.timezone;
  const num = /^\d+[A-Za-z]?$/.test(scene.number) ? `Sc ${scene.number}` : scene.number;

  return (
    <div>
      <PageHeader as="h2"
        title={scene.name}
        subtitle={`Act ${scene.act} · ${num}`}
        back={{ href: `/p/${productionId}/scenes`, label: "Scenes" }}
      />
      <Card>
        <SceneForm
          key={scene.id}
          action={updateScene.bind(null, productionId, sceneId)}
          scene={scene}
          roles={roleRows.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
          selectedRoleIds={links.map((l) => l.roleId)}
          submitLabel="Save scene"
        />
      </Card>
      <SectionTitle>Rehearsal history</SectionTitle>
      <Card className="space-y-1 text-sm">
        {st ? (
          <>
            <p>
              <span className="font-semibold">
                {st.count === 0 ? "Not rehearsed yet" : `Rehearsed ${st.count} time${st.count === 1 ? "" : "s"}`}
              </span>
              {st.last ? <span className="text-muted"> · last {fmtDay(st.last, tz)} ({daysSince(st.last)} days ago)</span> : null}
            </p>
            <p className="text-muted">
              {st.next ? (
                <Link href={`/p/${productionId}/schedule/${st.next.eventId}`} className="text-accent">
                  Next: {fmtDay(st.next.at, tz)}
                  {st.next.draft ? " (draft)" : ""} →
                </Link>
              ) : (
                "Not on the schedule yet."
              )}
            </p>
            <p className="text-xs text-muted">Counts rehearsals that call this scene. Full-cast runs aren&apos;t counted.</p>
          </>
        ) : null}
      </Card>

      <SectionTitle>Links for this scene</SectionTitle>
      {sceneResources.length ? (
        <ResourceList items={sceneResources} canEdit productionId={productionId} />
      ) : (
        <p className="text-sm text-muted">Script pages, tracks or choreo videos. Everyone in this scene will see them.</p>
      )}
      <Card className="mt-3">
        <ResourceForm action={addResource.bind(null, productionId)} fixed={{ sceneId }} />
      </Card>

      <SectionTitle>Remove</SectionTitle>
      <ConfirmForm
        action={deleteScene.bind(null, productionId, sceneId)}
        confirm={`Delete “${scene.name}”? Rehearsal blocks calling this scene will no longer call anyone for it.`}
      >
        <SubmitButton variant="danger" pendingLabel="Deleting…">
          <Trash2 className="size-4" /> Delete scene
        </SubmitButton>
      </ConfirmForm>
    </div>
  );
}
