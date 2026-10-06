import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getUserOrgs } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ProductionFields } from "../_components/production-fields";
import { NewProductionForm } from "./new-production-form";

export default async function NewProductionPage() {
  const user = await requireUser();
  const orgs = (await getUserOrgs(user)).filter((o) => o.role === "admin");
  if (orgs.length === 0) redirect("/productions");
  return (
    <div>
      <PageHeader title="New production" back={{ href: "/productions", label: "Shows" }} />
      <Card>
        <NewProductionForm orgs={orgs.map((o) => ({ id: o.org.id, name: o.org.name }))} fields={<ProductionFields collapseDetails />} />
      </Card>
    </div>
  );
}
