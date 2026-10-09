import { redirect } from "next/navigation";

export default async function AuditionIndex({ params }: PageProps<"/p/[productionId]/auditions/[auditionId]">) {
  const { productionId, auditionId } = await params;
  redirect(`/p/${productionId}/auditions/${auditionId}/signups`);
}
