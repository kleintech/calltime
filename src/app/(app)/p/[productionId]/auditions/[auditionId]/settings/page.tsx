import { requireProductionEditor } from "@/lib/access";
import { getAuditionForProduction } from "@/lib/auditions";
import { appBaseUrl } from "@/lib/invites";
import { Card, SectionTitle } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { deleteAudition, updateAudition } from "../../actions";
import { AuditionForm, ConfirmButton } from "../../_components/forms";

export default async function AuditionSettings({ params }: PageProps<"/p/[productionId]/auditions/[auditionId]/settings">) {
  const { productionId, auditionId } = await params;
  await requireProductionEditor(productionId);
  const audition = await getAuditionForProduction(productionId, auditionId);
  const url = `${await appBaseUrl()}/audition/${audition.slug}`;
  const hidden = { productionId, auditionId };

  return (
    <div>
      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Public signup link</p>
        <a href={url} target="_blank" className="block break-all font-display text-2xl font-semibold text-accent sm:text-3xl">
          {url.replace(/^https?:\/\//, "")}
        </a>
        <p className="text-sm text-muted">Big enough to photograph or project. Post it, text it, or print it on a flyer.</p>
        <CopyButton value={url} share />
      </Card>

      <SectionTitle>Details</SectionTitle>
      <Card>
        <AuditionForm
          key={audition.slug + audition.isOpen}
          action={updateAudition}
          hidden={hidden}
          showSlug
          submitLabel="Save audition"
          initial={{
            title: audition.title,
            description: audition.description,
            location: audition.location,
            isOpen: audition.isOpen,
            questions: audition.questions,
            slug: audition.slug,
          }}
        />
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      <form action={deleteAudition}>
        <input type="hidden" name="productionId" value={productionId} />
        <input type="hidden" name="auditionId" value={auditionId} />
        <ConfirmButton variant="danger" message="Delete this audition, its slots and every signup? This can't be undone.">
          Delete audition
        </ConfirmButton>
      </form>
    </div>
  );
}
