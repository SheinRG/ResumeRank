import { z } from "zod";

/**
 * Uploads go through a server function, and Vercel caps a function's request
 * body at 4.5 MB, so 4 MB leaves room for the multipart envelope.
 */
export const RESUME_FILE_MAX_BYTES = 4 * 1024 * 1024;

export const RESUME_FILE_TYPES = {
  PDF: { mime: "application/pdf", extension: "pdf" },
  DOCX: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
} as const;

/** For the file picker; the server decides the type from the bytes, not from these. */
export const RESUME_FILE_ACCEPT = Object.values(RESUME_FILE_TYPES)
  .flatMap(({ mime, extension }) => [mime, `.${extension}`])
  .join(",");

export const resumeFileUploadSchema = z.object({
  candidateId: z.string().min(1, "Choose a candidate."),
  file: z
    .file("Choose a PDF or Word (.docx) file.")
    .min(1, "That file is empty.")
    .max(RESUME_FILE_MAX_BYTES, "Files can be at most 4 MB.")
    .mime(
      Object.values(RESUME_FILE_TYPES).map(({ mime }) => mime),
      "Upload a PDF or Word (.docx) file.",
    ),
});
export type ResumeFileUploadInput = z.infer<typeof resumeFileUploadSchema>;
