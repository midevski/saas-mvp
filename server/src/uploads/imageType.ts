export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ImageType {
  mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  ext: 'jpg' | 'png' | 'gif' | 'webp'
}

// Identifies an image by its actual bytes ("magic numbers"), not by the filename or the
// client-declared MIME type, both of which are trivially spoofable. Anything else — including
// SVG, which can carry scripts — is rejected.
export function detectImageType(buffer: Buffer): ImageType | null {
  const startsWith = (bytes: number[], offset = 0) => bytes.every((b, i) => buffer[offset + i] === b)

  if (startsWith([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' }
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' }
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return { mime: 'image/gif', ext: 'gif' } // "GIF8"
  // "RIFF" <size> "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}
