export type FieldErrors = Record<string, string[]>;

/**
 * An expected, user-safe failure raised by a service. Adapters (server
 * actions, route handlers, queue workers) surface the message as-is; anything
 * that is not a DomainError is treated as a bug and hidden behind a generic
 * error.
 */
export class DomainError extends Error {
  readonly fieldErrors?: FieldErrors;

  constructor(message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = new.target.name;
    this.fieldErrors = fieldErrors;
  }
}

/** Also raised for other tenants' ids, so a cross-tenant probe looks identical to a missing row. */
export class NotFoundError extends DomainError {}

export class ForbiddenError extends DomainError {}

export class ConflictError extends DomainError {}
