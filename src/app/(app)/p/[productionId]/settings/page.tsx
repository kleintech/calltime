import { Card, SectionTitle } from "@/components/ui";
import { requireProductionEditor } from "@/lib/access";
import { ProductionFields } from "@/app/(app)/productions/_components/production-fields";
import { deleteProduction, updateProduction } from "./actions";
import { DeleteForm, SettingsForm } from "./forms";

export default async function SettingsPage({ params }: PageProps<"/p/[productionId]/settings">) {
  const { productionId } = await params;
  const { production, isOrgAdmin } = await requireProductionEditor(productionId);
  return (
    <div>
      <SectionTitle>Production details</SectionTitle>
      <Card>
        <SettingsForm
          key={production.id}
          action={updateProduction.bind(null, productionId)}
          fields={<ProductionFields p={production} />}
        />
      </Card>
      {isOrgAdmin ? (
        <>
          <SectionTitle>Danger zone</SectionTitle>
          <Card className="border-danger/40">
            <p className="mb-4 text-sm text-muted">
              Deleting removes every scene, role, assignment, rehearsal, audition and announcement in this production. People
              records stay with the company.
            </p>
            <DeleteForm action={deleteProduction.bind(null, productionId)} title={production.title} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
