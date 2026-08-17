// Only allow same-app relative paths as a post-login redirect target — blocks
// open-redirect payloads like "//evil.com" or "https://evil.com" in the query string
export function sanitizeRedirect(path: string | null): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return '/'
  return path
}
