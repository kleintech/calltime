import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, roles, scenes } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { Importer } from "./importer";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export default async function ImportPage({ params }: PageProps<"/p/[productionId]/import">) {
  const { productionId } = await params;
  const { org } = await requireProductionEditor(productionId);
  const [roleRows, sceneRows, peopleRows] = await Promise.all([
    db.select({ name: roles.name }).from(roles).where(eq(roles.productionId, productionId)),
    db.select({ act: scenes.act, number: scenes.number }).from(scenes).where(eq(scenes.productionId, productionId)),
    db.select({ email: people.email, firstName: people.firstName, lastName: people.lastName }).from(people).where(eq(people.orgId, org.id)),
  ]);

  return (
    <div>
      <PageHeader as="h2"
        title="Import from a spreadsheet"
        subtitle="Already have your roles, scene breakdown or cast list in Google Sheets or Excel? Paste it here. Do roles first, then scenes, then cast."
        back={{ href: `/p/${productionId}`, label: "Overview" }}
      />
      <Card>
        <Importer
          productionId={productionId}
          existing={{
            roles: roleRows.map((r) => r.name),
            scenes: sceneRows.map((s) => `${s.act}|${norm(s.number)}`),
            emails: peopleRows.map((p) => p.email?.toLowerCase()).filter((e): e is string => !!e),
            names: peopleRows.map((p) => norm(`${p.firstName} ${p.lastName}`)),
          }}
        />
      </Card>
    </div>
  );
}
