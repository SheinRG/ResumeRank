"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AUDIT_EXPORT_FORMATS,
  auditExportParamsSchema,
  type AuditExportFormat,
} from "@resumerank/core/validators/audit";

const FORMAT_LABELS: Record<AuditExportFormat, string> = {
  csv: "CSV (spreadsheets)",
  jsonl: "JSON Lines (SIEM import)",
};

function isFormat(value: string): value is AuditExportFormat {
  return (AUDIT_EXPORT_FORMATS as readonly string[]).includes(value);
}

type FieldErrors = Partial<Record<"from" | "to", string[]>>;

export function AuditExport() {
  const [format, setFormat] = useState<AuditExportFormat>("csv");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const parsed = auditExportParamsSchema.safeParse({
    format,
    from: from || undefined,
    to: to || undefined,
  });
  const query = new URLSearchParams({ format });
  if (parsed.success && parsed.data.from) query.set("from", parsed.data.from);
  if (parsed.success && parsed.data.to) query.set("to", parsed.data.to);

  // A plain download link rather than a fetch: the browser streams the file
  // to disk instead of this page holding a large export in memory.
  function checkRange(clickEvent: React.MouseEvent<HTMLAnchorElement>) {
    if (parsed.success) {
      setErrors({});
      return;
    }
    clickEvent.preventDefault();
    setErrors(parsed.error.flatten().fieldErrors);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
        <CardDescription>
          Download the log, oldest entry first, with each entry&apos;s chain hashes so the copy can be
          checked against the original later. Exports are recorded in the log too. Dates are in UTC.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Format" htmlFor="audit-export-format">
              <Select value={format} onValueChange={(value) => isFormat(value) && setFormat(value)}>
                <SelectTrigger id="audit-export-format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIT_EXPORT_FORMATS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {FORMAT_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="From" htmlFor="audit-export-from" errors={errors.from} hint="Blank for the start">
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </FormField>
            <FormField label="To" htmlFor="audit-export-to" errors={errors.to} hint="Blank for today">
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </FormField>
          </div>
          <div>
            <Button asChild variant="outline">
              <a href={`/activity/export?${query.toString()}`} download onClick={checkRange}>
                <Download aria-hidden="true" />
                Download export
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
