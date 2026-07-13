import { History } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDate, formatRelative, initials } from "@/lib/format";
import type { ActivityFeedItem } from "@/server/queries/dashboard";

export function ActivityFeed({ items }: { items: ActivityFeedItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No activity yet"
        description="Actions your team takes will show up here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-accent/50"
        >
          <Avatar className="size-8 shrink-0">
            {item.actor.image ? (
              <AvatarImage src={item.actor.image} alt="" />
            ) : null}
            <AvatarFallback className="text-xs">
              {initials(item.actor.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-sm text-foreground">
              <span className="font-medium">{item.actor.name}</span>{" "}
              {item.summary}
            </p>
            <p
              className="text-xs text-muted-foreground"
              title={formatDate(item.createdAt)}
            >
              {formatRelative(item.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
