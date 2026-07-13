import { cloneElement, useId, type ReactElement } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FormFieldProps = {
  label: string;
  htmlFor?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  errors?: string[];
  hint?: string;
  required?: boolean;
  className?: string;
};

function FormField({
  label,
  htmlFor,
  children,
  errors,
  hint,
  required,
  className,
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = errors && errors.length > 0 ? `${fieldId}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {cloneElement(children, {
        id: fieldId,
        "aria-describedby": describedBy,
        "aria-invalid": errorId ? true : undefined,
      })}
      {hint && !errorId ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {errorId ? (
        <ul id={errorId} className="flex flex-col gap-0.5">
          {errors?.map((error) => (
            <li key={error} className="text-xs font-medium text-destructive">
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export { FormField };
