import crypto from 'crypto'
import { env } from '../config/env'
import { detectImageType } from './imageType'
import { cloudinaryDriver, cloudinarySignature, localDriver } from './storage'

describe('detectImageType (by content, not name or declared type)', () => {
  it.each([
    [[0xff, 0xd8, 0xff, 0xdb], 'image/jpeg'],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    [[...Buffer.from('GIF89a')], 'image/gif'],
    [[...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')], 'image/webp'],
  ])('recognizes %j as %s', (bytes, mime) => {
    expect(detectImageType(Buffer.from([...bytes, 0, 0, 0]))?.mime).toBe(mime)
  })

  it.each([
    ['plain text', Buffer.from('hello')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['a RIFF file that is not WebP (e.g. WAV)', Buffer.from('RIFF\0\0\0\0WAVEfmt ')],
    ['an empty file', Buffer.alloc(0)],
  ])('rejects %s', (_kind, buffer) => {
    expect(detectImageType(buffer)).toBeNull()
  })
})

describe('local storage driver', () => {
  it('refuses to delete anything that is not one of its own generated ids', async () => {
    for (const id of ['../../package.json', '..\\secrets.png', 'x.png', `${'a'.repeat(32)}.svg`]) {
      await expect(localDriver.remove(id)).rejects.toThrow('Refusing to delete')
    }
  })

  it('treats deleting an already-missing file as success', async () => {
    await expect(localDriver.remove(`${'b'.repeat(32)}.png`)).resolves.toBeUndefined()
  })
})

describe('cloudinary storage driver', () => {
  const credentials = { CLOUDINARY_CLOUD_NAME: 'demo-cloud', CLOUDINARY_API_KEY: 'key123', CLOUDINARY_API_SECRET: 'shh' }
  const originalFetch = global.fetch

  beforeEach(() => Object.assign(env, credentials))
  afterEach(() => {
    global.fetch = originalFetch
    for (const key of Object.keys(credentials)) delete (env as Record<string, unknown>)[key]
  })

  function mockFetch(body: object) {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => body, text: async () => '' })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it("signs params the way Cloudinary documents: sorted k=v pairs joined by '&', secret appended, SHA-1", () => {
    const expected = crypto.createHash('sha1').update('folder=saas-mvp&timestamp=1700000000shh').digest('hex')
    // Given out of order on purpose
    expect(cloudinarySignature({ timestamp: '1700000000', folder: 'saas-mvp' }, 'shh')).toBe(expected)
  })

  it('uploads to the image endpoint with a signed request and returns the hosted URL', async () => {
    const fetchMock = mockFetch({ secure_url: 'https://res.cloudinary.com/demo-cloud/x.png', public_id: 'saas-mvp/x' })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

    const stored = await cloudinaryDriver.save(png, { mime: 'image/png', ext: 'png' })
    expect(stored).toEqual({ url: 'https://res.cloudinary.com/demo-cloud/x.png', publicId: 'saas-mvp/x' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload')
    const form = init.body as FormData
    expect(form.get('api_key')).toBe('key123')
    expect(form.get('folder')).toBe('saas-mvp')
    expect(form.get('signature')).toBe(
      cloudinarySignature({ folder: 'saas-mvp', timestamp: String(form.get('timestamp')) }, 'shh'),
    )
    expect((form.get('file') as Blob).type).toBe('image/png')
    // The secret itself never leaves the server
    expect([...form.values()].map(String)).not.toContain('shh')
  })

  it('deletes by public_id with a signed destroy request', async () => {
    const fetchMock = mockFetch({ result: 'ok' })
    await cloudinaryDriver.remove('saas-mvp/x')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/destroy')
    const form = init.body as FormData
    expect(form.get('public_id')).toBe('saas-mvp/x')
    expect(form.get('signature')).toBe(
      cloudinarySignature({ public_id: 'saas-mvp/x', timestamp: String(form.get('timestamp')) }, 'shh'),
    )
  })

  it('surfaces Cloudinary errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Invalid Signature' }) as never
    await expect(cloudinaryDriver.remove('saas-mvp/x')).rejects.toThrow('Cloudinary destroy failed: 401 Invalid Signature')
  })
})
