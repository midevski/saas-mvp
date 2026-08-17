// Thrown by services; mapped to HTTP status codes by app.ts's error handler
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
