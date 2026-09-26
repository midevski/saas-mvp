// Fake BullMQ Queue: tests the enqueue contract without Redis
const add = jest.fn()
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add, on: jest.fn(), close: jest.fn() })),
}))

import { closeQueue, enqueueWelcomeEmail, JOB_NAMES, startQueue } from './queue'

const data = { userId: 'u1', email: 'new@example.com', name: 'New User' }

afterEach(async () => {
  await closeQueue()
  jest.restoreAllMocks()
  add.mockReset()
})

describe('enqueueWelcomeEmail', () => {
  it('is a silent no-op when the job system has not been started', () => {
    enqueueWelcomeEmail(data)
    expect(add).not.toHaveBeenCalled()
  })

  it('adds a welcome-email job with the user details', async () => {
    add.mockResolvedValue({ id: '1' })
    jest.spyOn(console, 'log').mockImplementation(() => {})
    startQueue()

    enqueueWelcomeEmail(data)

    expect(add).toHaveBeenCalledWith(JOB_NAMES.WELCOME_EMAIL, data)
  })

  it('never throws or rejects when Redis is unavailable — it logs instead', async () => {
    add.mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false"))
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
    startQueue()

    expect(() => enqueueWelcomeEmail(data)).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))

    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('could not queue welcome-email for new@example.com'))
  })
})
