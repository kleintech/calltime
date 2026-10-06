import { ExternalLink, FileText, Film, Link2, Music, ScrollText, Trash2 } from "lucide-react";
import type { resources } from "@/db/schema";
import { Badge } from "@/components/ui";
import { ConfirmForm, IconSubmit } from "@/app/(app)/productions/_components/form";
import { RESOURCE_KIND_LABEL } from "@/app/(app)/productions/_components/constants";
import { deleteResource } from "./actions";

type Resource = typeof resources.$inferSelect;

const ICONS = { script: ScrollText, track: Music, video: Film, doc: FileText, link: Link2 } as const;

export function ResourceIcon({ kind }: { kind: string }) {
  const Icon = ICONS[kind as keyof typeof ICONS] ?? Link2;
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent" aria-hidden>
      <Icon className="size-4" />
    </span>
  );
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Tappable list of links (open in a new tab). Editors get a delete button per row. */
export function ResourceList({
  items,
  context,
  canEdit = false,
  productionId,
}: {
  items: Resource[];
  /** Optional per-item label, e.g. which scene/role it belongs to. */
  context?: (r: Resource) => string | null;
  canEdit?: boolean;
  productionId: string;
}) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {items.map((r) => {
        const ctx = context?.(r);
        return (
          <div key={r.id} className="flex items-center">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-surface-2"
            >
              <ResourceIcon kind={r.kind} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{r.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  <span>{RESOURCE_KIND_LABEL[r.kind] ?? "Link"}</span>
                  <span className="truncate">· {host(r.url)}</span>
                  {ctx ? <Badge>{ctx}</Badge> : null}
                </span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-muted" aria-label="Opens in a new tab" />
            </a>
            {canEdit ? (
              <ConfirmForm
                action={deleteResource.bind(null, productionId, r.id)}
                confirm={`Remove the link “${r.title}”?`}
                className="pr-1"
              >
                <IconSubmit label={`Remove ${r.title}`}>
                  <Trash2 className="size-4" />
                </IconSubmit>
              </ConfirmForm>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
