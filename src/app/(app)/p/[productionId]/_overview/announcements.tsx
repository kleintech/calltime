import { Pin, PinOff, Trash2 } from "lucide-react";
import type { announcements } from "@/db/schema";
import { Badge, Card, EmptyState } from "@/components/ui";
import { fmtDay } from "@/lib/time";
import { ConfirmForm, IconSubmit } from "@/app/(app)/productions/_components/form";
import { deleteAnnouncement, setAnnouncementPinned } from "./actions";

type Row = typeof announcements.$inferSelect & { authorName: string | null };

export function AnnouncementList({
  rows,
  tz,
  canEdit,
  productionId,
}: {
  rows: Row[];
  tz: string;
  canEdit: boolean;
  productionId: string;
}) {
  if (!rows.length) {
    return <EmptyState title="No announcements" body={canEdit ? "Post updates here instead of the group chat." : "Updates from the creative team will appear here."} />;
  }
  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <Card key={a.id} className={a.pinned ? "border-gold/50 bg-gold-soft/40" : undefined}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned ? (
                  <Badge tone="gold">
                    <Pin className="size-3" /> Pinned
                  </Badge>
                ) : null}
                <p className="font-semibold">{a.title}</p>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{a.body}</p>
              <p className="mt-2 text-xs text-muted">
                {a.authorName ? `${a.authorName} · ` : ""}
                {fmtDay(a.createdAt, tz)}
              </p>
            </div>
            {canEdit ? (
              <div className="-mr-2 -mt-2 flex shrink-0">
                <form action={setAnnouncementPinned.bind(null, productionId, a.id, !a.pinned)}>
                  <IconSubmit label={a.pinned ? "Unpin" : "Pin"}>
                    {a.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  </IconSubmit>
                </form>
                <ConfirmForm action={deleteAnnouncement.bind(null, productionId, a.id)} confirm={`Delete “${a.title}”? Families will no longer see it.`}>
                  <IconSubmit label="Delete">
                    <Trash2 className="size-4" />
                  </IconSubmit>
                </ConfirmForm>
              </div>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}
