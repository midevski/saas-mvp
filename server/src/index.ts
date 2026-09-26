import http from 'http'
import Redis from 'ioredis'
import { app } from './app'
import { connectMongo } from './config/db'
import { env } from './config/env'
import { closeQueue, startQueue } from './jobs/queue'
import { registerSchedules } from './jobs/scheduler'
import { closeWorker, startWorker } from './jobs/worker'
import { createSocketServer } from './realtime/socket'

async function main() {
  await connectMongo()

  const redis = new Redis(env.REDIS_URL)
  redis.on('connect', () => console.log('[redis] connected'))
  redis.on('error', (err) => console.error('[redis] connection failed:', err))

  const server = http.createServer(app)
  const { closePresence } = createSocketServer(server, redis)

  // Background jobs run in this same process (see README "Future work: separate worker")
  startQueue()
  startWorker()
  // Not awaited: if Redis is down at boot this waits for it without blocking the HTTP server
  registerSchedules().catch((err: Error) =>
    console.error(`[jobs] could not register repeating schedules: ${err.message}`),
  )

  server.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT}`)
  })

  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[server] ${signal} received, shutting down`)
    // Give an in-flight job a moment to finish; queued jobs are safe in Redis regardless
    const timeout = setTimeout(() => process.exit(1), 10_000)
    // Other instances/clients stop counting this instance's sockets as online right away
    await closePresence().catch(() => {})
    await closeWorker().catch(() => {})
    await closeQueue().catch(() => {})
    clearTimeout(timeout)
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main()
