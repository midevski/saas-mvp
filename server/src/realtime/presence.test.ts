import type Redis from 'ioredis'
import { MemoryPresenceStore, PresenceBroadcaster, RedisPresenceStore } from './presence'

// Just enough of ioredis for RedisPresenceStore, backed by Maps — no Redis server needed.
// Key expiry is ignored; "instance died" is simulated by deleting its heartbeat key.
class FakeRedis {
  strings = new Map<string, string>()
  hashes = new Map<string, Map<string, string>>()

  async set(key: string, value: string) {
    this.strings.set(key, value)
    return 'OK'
  }
  async mget(...keys: string[]) {
    return keys.map((k) => this.strings.get(k) ?? null)
  }
  async del(key: string) {
    return Number(this.strings.delete(key))
  }
  async hset(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>()
    hash.set(field, value)
    this.hashes.set(key, hash)
    return 1
  }
  async hdel(key: string, ...fields: string[]) {
    const hash = this.hashes.get(key)
    return fields.filter((f) => hash?.delete(f)).length
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? [])
  }
  async hkeys(key: string) {
    return [...(this.hashes.get(key)?.keys() ?? [])]
  }
}

function heartbeatKeys(redis: FakeRedis) {
  return [...redis.strings.keys()].filter((k) => k.startsWith('presence:instance:'))
}

describe.each([
  ['MemoryPresenceStore', () => new MemoryPresenceStore()],
  ['RedisPresenceStore', () => new RedisPresenceStore(new FakeRedis() as unknown as Redis)],
])('%s', (_name, makeStore) => {
  it('counts a user once however many sockets they have, until the last one leaves', async () => {
    const store = makeStore()
    await store.add('org1', 'tab1', 'alice')
    await store.add('org1', 'tab2', 'alice')
    await store.add('org1', 'sock3', 'bob')
    expect(await store.onlineUserIds('org1')).toEqual(['alice', 'bob'])

    await store.remove('org1', 'tab1')
    expect(await store.onlineUserIds('org1')).toEqual(['alice', 'bob'])

    await store.remove('org1', 'tab2')
    expect(await store.onlineUserIds('org1')).toEqual(['bob'])
    await store.close()
  })

  it('keeps orgs separate', async () => {
    const store = makeStore()
    await store.add('org1', 's1', 'alice')
    await store.add('org2', 's2', 'bob')
    expect(await store.onlineUserIds('org1')).toEqual(['alice'])
    expect(await store.onlineUserIds('org2')).toEqual(['bob'])
    expect(await store.onlineUserIds('org3')).toEqual([])
    await store.close()
  })
})

describe('RedisPresenceStore across server instances', () => {
  it('shares presence between instances using the same Redis', async () => {
    const redis = new FakeRedis()
    const a = new RedisPresenceStore(redis as unknown as Redis)
    const b = new RedisPresenceStore(redis as unknown as Redis)
    await a.add('org1', 's1', 'alice')
    await b.add('org1', 's2', 'bob')
    expect(await a.onlineUserIds('org1')).toEqual(['alice', 'bob'])
    expect(await b.onlineUserIds('org1')).toEqual(['alice', 'bob'])
    await a.close()
    await b.close()
  })

  it("ignores and cleans up a dead instance's entries (crash/restart without disconnect handlers)", async () => {
    const redis = new FakeRedis()
    const crashed = new RedisPresenceStore(redis as unknown as Redis)
    const survivor = new RedisPresenceStore(redis as unknown as Redis)
    await crashed.add('org1', 's1', 'alice')
    await survivor.add('org1', 's2', 'bob')

    // The crashed instance's heartbeat expires (its disconnect handlers never ran).
    // Each store writes its heartbeat on construction, so the first key is `crashed`'s.
    const [crashedKey] = heartbeatKeys(redis)
    redis.strings.delete(crashedKey!)

    expect(await survivor.onlineUserIds('org1')).toEqual(['bob'])
    // The stale entry was removed, not just skipped
    expect([...redis.hashes.get('presence:org1')!.values()]).toEqual(['bob'])
    await crashed.close()
    await survivor.close()
  })

  it('a gracefully closed instance stops counting as online immediately', async () => {
    const redis = new FakeRedis()
    const leaving = new RedisPresenceStore(redis as unknown as Redis)
    const staying = new RedisPresenceStore(redis as unknown as Redis)
    await leaving.add('org1', 's1', 'alice')
    await staying.add('org1', 's2', 'bob')

    await leaving.close()
    expect(await staying.onlineUserIds('org1')).toEqual(['bob'])
    await staying.close()
  })
})

describe('PresenceBroadcaster', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('does not schedule rechecks when every entry is its own', async () => {
    const redis = new FakeRedis()
    const store = new RedisPresenceStore(redis as unknown as Redis)
    await store.add('org1', 's1', 'alice')
    expect(await store.recheckDelayMs('org1')).toBeNull()
    expect(await new MemoryPresenceStore().recheckDelayMs()).toBeNull()
    await store.close()
  })

  it("drops a crashed instance's user once its heartbeat would have expired, with no other event", async () => {
    jest.useFakeTimers()
    const redis = new FakeRedis()
    // What a crashed instance leaves behind: its entries and a not-yet-expired heartbeat, but
    // no running process (so, unlike a live store, nothing will refresh that heartbeat)
    await redis.set('presence:instance:dead-instance', '1')
    await redis.hset('presence:org1', 'dead-instance|s-old', 'alice') // alice closed her tab meanwhile

    const restarted = new RedisPresenceStore(redis as unknown as Redis)
    await restarted.add('org1', 's-new', 'bob') // bob reconnected to the restarted server

    const sent: string[][] = []
    const broadcaster = new PresenceBroadcaster(restarted, (_org, ids) => sent.push(ids))

    // Right after the restart, the old heartbeat is still valid: alice still looks online
    await broadcaster.broadcast('org1')
    expect(sent).toEqual([['alice', 'bob']])

    // The old heartbeat then expires silently...
    redis.strings.delete('presence:instance:dead-instance')
    // ...and the scheduled recheck corrects everyone's list
    await jest.advanceTimersByTimeAsync(20_000)
    expect(sent).toEqual([['alice', 'bob'], ['bob']])

    broadcaster.close()
    await restarted.close()
  })

  it('stays quiet on a recheck when nothing changed', async () => {
    jest.useFakeTimers()
    const redis = new FakeRedis()
    const other = new RedisPresenceStore(redis as unknown as Redis)
    const self = new RedisPresenceStore(redis as unknown as Redis)
    await other.add('org1', 's1', 'alice')
    await self.add('org1', 's2', 'bob')

    const sent: string[][] = []
    const broadcaster = new PresenceBroadcaster(self, (_org, ids) => sent.push(ids))
    await broadcaster.broadcast('org1')
    await jest.advanceTimersByTimeAsync(20_000)

    // The other instance is alive, so the recheck found the same list and sent nothing
    expect(sent).toEqual([['alice', 'bob']])
    broadcaster.close()
    await other.close()
    await self.close()
  })
})
