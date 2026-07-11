"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_LABELS } from "@/components/shared/status-badges";
import { STAGES, type Stage } from "@/lib/validators/enums";
import { updateStageAction } from "@/server/actions/applications";

export function StageSelect({
  applicationId,
  stage,
}: {
  applicationId: string;
  stage: Stage;
}) {
  const [value, setValue] = useState<Stage>(stage);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: Stage) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await updateStageAction({ id: applicationId, stage: next });
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
        return;
      }
      toast.success(`Moved to ${STAGE_LABELS[result.data.stage]}.`);
    });
  }

  return (
    <Select
      value={value}
      disabled={isPending}
      onValueChange={(next) => handleChange(next as Stage)}
    >
      <SelectTrigger className="w-40" aria-label="Change stage">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((option) => (
          <SelectItem key={option} value={option}>
            {STAGE_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
