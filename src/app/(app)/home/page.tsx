import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await requireUser();
  return <PageHeader title={`Hi, ${user.name.split(" ")[0]}`} subtitle="Your upcoming calls will appear here." />;
}
