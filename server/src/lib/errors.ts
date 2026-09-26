// Thrown by services; mapped to HTTP status codes by app.ts's error handler
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {} // 400
export class PayloadTooLargeError extends Error {} // 413
export class UnsupportedMediaTypeError extends Error {} // 415
