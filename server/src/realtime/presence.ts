import crypto from 'crypto'
import type Redis from 'ioredis'

// Board presence: who has a given org's board open right now. Stored per socket, so a user
// with two tabs stays online until *all* of their sockets for that org are gone.
export interface PresenceStore {
  add(orgId: string, socketId: string, userId: string): Promise<void>
  remove(orgId: string, socketId: string): Promise<void>
  onlineUserIds(orgId: string): Promise<string[]>
  // If the current list relies on another server instance still being alive, how long until
  // that would be known for sure (its heartbeat would have expired); otherwise null
  recheckDelayMs(orgId: string): Promise<number | null>
  close(): Promise<void>
}

// Single-process store — used by tests and whenever no Redis connection is provided
export class MemoryPresenceStore implements PresenceStore {
  private readonly orgs = new Map<string, Map<string, string>>() // orgId -> socketId -> userId

  async add(orgId: string, socketId: string, userId: string) {
    const sockets = this.orgs.get(orgId) ?? new Map<string, string>()
    sockets.set(socketId, userId)
    this.orgs.set(orgId, sockets)
  }

  async remove(orgId: string, socketId: string) {
    const sockets = this.orgs.get(orgId)
    sockets?.delete(socketId)
    if (sockets?.size === 0) this.orgs.delete(orgId)
  }

  async onlineUserIds(orgId: string) {
    return [...new Set(this.orgs.get(orgId)?.values() ?? [])].sort()
  }

  async recheckDelayMs() {
    return null // one process: nothing can die behind its back
  }

  async close() {}
}

const HEARTBEAT_INTERVAL_MS = 5_000
const HEARTBEAT_TTL_SECONDS = 15

// Redis-backed store, shared by every server instance (same Redis as the Socket.io adapter).
//
//   presence:<orgId>               hash   "<instanceId>|<socketId>" -> userId
//   presence:instance:<instanceId> string heartbeat, expires unless refreshed
//
// A crashed or restarted instance never runs its sockets' disconnect handlers, so its entries
// would otherwise stay "online" forever. Each entry records its owning instance; once that
// instance's heartbeat expires, its entries are ignored and cleaned up on the next read.
export class RedisPresenceStore implements PresenceStore {
  private readonly instanceId = crypto.randomUUID()
  private readonly heartbeat: NodeJS.Timeout

  constructor(private readonly redis: Redis) {
    const beat = () =>
      this.redis
        .set(this.instanceKey(this.instanceId), '1', 'EX', HEARTBEAT_TTL_SECONDS)
        .catch((err: Error) => console.error(`[presence] heartbeat failed: ${err.message}`))
    void beat()
    this.heartbeat = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    this.heartbeat.unref()
  }

  private orgKey(orgId: string) {
    return `presence:${orgId}`
  }

  private instanceKey(instanceId: string) {
    return `presence:instance:${instanceId}`
  }

  private field(socketId: string) {
    return `${this.instanceId}|${socketId}`
  }

  async add(orgId: string, socketId: string, userId: string) {
    await this.redis.hset(this.orgKey(orgId), this.field(socketId), userId)
  }

  async remove(orgId: string, socketId: string) {
    await this.redis.hdel(this.orgKey(orgId), this.field(socketId))
  }

  async onlineUserIds(orgId: string) {
    const entries = await this.redis.hgetall(this.orgKey(orgId))
    const fields = Object.keys(entries)
    if (fields.length === 0) return []

    const instanceIds = [...new Set(fields.map((f) => f.split('|')[0]!))]
    const alive = await this.redis.mget(...instanceIds.map((id) => this.instanceKey(id)))
    const liveInstances = new Set(instanceIds.filter((_, i) => alive[i] !== null))

    const online = new Set<string>()
    const stale: string[] = []
    for (const field of fields) {
      if (liveInstances.has(field.split('|')[0]!)) online.add(entries[field]!)
      else stale.push(field)
    }
    if (stale.length > 0) await this.redis.hdel(this.orgKey(orgId), ...stale)

    return [...online].sort()
  }

  async recheckDelayMs(orgId: string) {
    const fields = await this.redis.hkeys(this.orgKey(orgId))
    const hasForeign = fields.some((f) => f.split('|')[0] !== this.instanceId)
    return hasForeign ? (HEARTBEAT_TTL_SECONDS + 1) * 1000 : null
  }

  // Graceful shutdown: drop this instance's heartbeat so its entries count as offline immediately
  async close() {
    clearInterval(this.heartbeat)
    await this.redis.del(this.instanceKey(this.instanceId)).catch(() => {})
  }
}

// Sends presence:update to an org's room. A crashed instance's entries only disappear when its
// heartbeat expires, and nothing emits an event at that moment. So whenever a broadcast list
// depends on other instances, recheck once after their heartbeats would have lapsed and
// re-broadcast if the list changed (e.g. a user whose server crashed is dropped).
export class PresenceBroadcaster {
  private readonly lastSent = new Map<string, string>()
  private readonly rechecks = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly store: PresenceStore,
    private readonly emit: (orgId: string, onlineUserIds: string[]) => void,
  ) {}

  async broadcast(orgId: string) {
    const onlineUserIds = await this.store.onlineUserIds(orgId)
    this.send(orgId, onlineUserIds)
    await this.scheduleRecheck(orgId)
  }

  private send(orgId: string, onlineUserIds: string[]) {
    this.emit(orgId, onlineUserIds)
    if (onlineUserIds.length === 0) this.lastSent.delete(orgId)
    else this.lastSent.set(orgId, onlineUserIds.join(','))
  }

  private async scheduleRecheck(orgId: string) {
    const delay = await this.store.recheckDelayMs(orgId)
    if (delay === null || this.rechecks.has(orgId)) return
    const timer = setTimeout(() => {
      this.rechecks.delete(orgId)
      this.store
        .onlineUserIds(orgId)
        .then((ids) => {
          // Only speak up if something actually changed
          if (ids.join(',') !== (this.lastSent.get(orgId) ?? '')) this.send(orgId, ids)
        })
        .catch((err: Error) => console.error(`[presence] recheck failed: ${err.message}`))
    }, delay)
    timer.unref()
    this.rechecks.set(orgId, timer)
  }

  close() {
    for (const timer of this.rechecks.values()) clearTimeout(timer)
    this.rechecks.clear()
  }
}
