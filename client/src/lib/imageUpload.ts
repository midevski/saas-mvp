// Client-side checks mirror the server's rules for instant feedback. The server re-checks
// everything (by file content, not name or declared type), so this is convenience, not security.

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return `"${file.name}" isn't a supported image. Use JPEG, PNG, WebP or GIF.`
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB. Images must be 5 MB or smaller.`
  }
  return null
}
