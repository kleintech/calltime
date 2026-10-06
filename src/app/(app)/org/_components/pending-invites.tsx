import { Badge, List } from "@/components/ui";
import { fmtDay } from "@/lib/time";
import { revokeInvite } from "../members/actions";
import type { getPendingInvites } from "../_lib/org";
import { SubmitButton } from "./action-form";
import { ShareInvite } from "./share-invite";

/** Pending invite links with copy + revoke. */
export function PendingInvites({
  orgId,
  timezone,
  items,
}: {
  orgId: string;
  timezone: string;
  items: Awaited<ReturnType<typeof getPendingInvites>>;
}) {
  if (items.length === 0) return null;
  return (
    <List>
      {items.map(({ invite, grants, url, message }) => (
        <div key={invite.id} className="space-y-2 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <div className="truncate font-medium">{invite.name || invite.email}</div>
              {invite.name ? <div className="truncate text-sm text-muted">{invite.email}</div> : null}
            </div>
            <span className="text-xs text-muted">Expires {fmtDay(invite.expiresAt, timezone)}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {grants.map((g) => (
              <Badge key={g} tone="gold">
                {g}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShareInvite url={url} message={message} compact />
            <form action={revokeInvite}>
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="inviteId" value={invite.id} />
              <SubmitButton variant="danger" size="sm" confirm={`Revoke the invite for ${invite.name || invite.email}? The link will stop working.`}>
                Revoke invite
              </SubmitButton>
            </form>
          </div>
        </div>
      ))}
    </List>
  );
}
