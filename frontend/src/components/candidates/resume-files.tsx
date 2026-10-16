"use client";

import { Download, FileUp, Loader2, Paperclip, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { RESUME_FILE_ACCEPT, resumeFileUploadSchema } from "@resumerank/core/validators/resume-file";
import { EmptyState } from "@/components/shared/empty-state";
import { ResumeFileStatusBadge } from "@/components/shared/status-badges";
import { Button } from "@/components/ui/button";
import { formatDate, formatFileSize, formatNumber } from "@/lib/format";
import { uploadResumeFileAction } from "@/server/actions/resume-files";
import type { ResumeFileItem } from "@/server/queries/resume-files";

const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_FAILURES = 3;

const statusSchema = z.array(
  z.object({
    id: z.string(),
    status: z.enum(["QUEUED", "RUNNING", "PARSED", "FAILED"]),
    error: z.string().nullable(),
  }),
);

function isPending(file: Pick<ResumeFileItem, "status">): boolean {
  return file.status === "QUEUED" || file.status === "RUNNING";
}

function statusKey(files: ReadonlyArray<Pick<ResumeFileItem, "id" | "status">>): string {
  return files.map((file) => `${file.id}:${file.status}`).join(",");
}

function detail(file: ResumeFileItem): string {
  if (file.status === "PARSED" && file.extractedChars !== null) {
    const how = file.extraction === "OCR" ? "read from the scanned pages" : "read";
    return `${formatNumber(file.extractedChars)} characters ${how}`;
  }
  if (file.status === "FAILED") return file.error ?? "We couldn't read this file.";
  return "The text will replace the resume below once it's read.";
}

/**
 * The candidate's uploaded originals. While one is being read the panel
 * polls for its status and refreshes the page when it lands, so the resume
 * text above picks up the new text.
 */
export function ResumeFiles({
  candidateId,
  files,
  canUpload,
}: {
  candidateId: string;
  files: ResumeFileItem[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUpload] = useTransition();
  const [pollFailed, setPollFailed] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);

  const pending = files.some(isPending);
  const currentKey = statusKey(files);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    let failures = 0;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/candidates/${candidateId}/resume-files`, { cache: "no-store" });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const next = statusSchema.parse(await response.json());
        failures = 0;
        if (cancelled) return;
        if (statusKey(next) !== currentKey) router.refresh();
      } catch {
        failures += 1;
        if (!cancelled && failures >= MAX_POLL_FAILURES) {
          clearInterval(timer);
          setPollFailed(true);
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pending, currentKey, candidateId, router, pollAttempt]);

  function retryPolling() {
    setPollFailed(false);
    setPollAttempt((attempt) => attempt + 1);
    router.refresh();
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const parsed = resumeFileUploadSchema.safeParse({ candidateId, file });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Choose a PDF or Word (.docx) file.");
      return;
    }
    const formData = new FormData();
    formData.set("candidateId", candidateId);
    formData.set("file", file);

    startUpload(async () => {
      const result = await uploadResumeFileAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Uploaded ${file.name}. Reading it now.`);
      router.refresh();
    });
  }

  const uploadButton = canUpload ? (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={RESUME_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFile}
      />
      <Button type="button" variant="outline" disabled={isUploading} onClick={() => inputRef.current?.click()}>
        {isUploading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileUp aria-hidden="true" />}
        {isUploading ? "Uploading…" : "Upload PDF or Word"}
      </Button>
    </>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {files.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No resume files"
          description={
            canUpload
              ? "Upload the candidate's PDF or Word resume (up to 4 MB). We keep the original and read its text into the resume."
              : "Nobody has uploaded a resume file for this candidate."
          }
          action={uploadButton}
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {files.map((file) => (
              <li key={file.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-foreground">{file.fileName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {file.kind} · {formatFileSize(file.sizeBytes)} · {formatDate(file.createdAt)}
                    {file.uploadedBy?.name ? ` · ${file.uploadedBy.name}` : ""}
                  </span>
                  <span
                    className={
                      file.status === "FAILED" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
                    }
                  >
                    {detail(file)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ResumeFileStatusBadge status={file.status} />
                  <Button asChild variant="ghost" size="icon" aria-label={`Download ${file.fileName}`}>
                    <a href={`/api/resume-files/${file.id}`} download>
                      <Download aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {pollFailed ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">We lost track of the file being read. Check again to see if it&apos;s done.</span>
              <Button type="button" variant="outline" size="sm" onClick={retryPolling}>
                <RefreshCw aria-hidden="true" />
                Check again
              </Button>
            </div>
          ) : null}
          {uploadButton ? <div>{uploadButton}</div> : null}
        </>
      )}
    </div>
  );
}
