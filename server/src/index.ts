import http from 'http'
import Redis from 'ioredis'
import { app } from './app'
import { connectMongo } from './config/db'
import { env } from './config/env'

async function main() {
  await connectMongo()

  const redis = new Redis(env.REDIS_URL)
  redis.on('connect', () => console.log('[redis] connected'))
  redis.on('error', (err) => console.error('[redis] connection failed:', err))

  const server = http.createServer(app)
  server.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT}`)
  })
}

main()
