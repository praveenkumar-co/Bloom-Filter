# scalable-bloom-kit

A TypeScript toolkit for production-friendly, Redis-backed scalable Bloom filters in Node.js.

Bloom filters are useful when you want to avoid expensive database, cache, or disk lookups for values that definitely do not exist.

Local : redis-stack-server

CLoud : REDIS_URL=rediss://username:password@host:port

Finally :  Install scalable-bloom-kit
Have RedisBloom-compatible Redis running
Use REDIS_URL to connect

```ts
import { createClient } from "redis";
import { BloomFilter } from "scalable-bloom-kit";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const videos = new BloomFilter({
  client,
  key: "videos:bloom",
  expectedItems: 1_000_000,
  errorRate: 0.01,
  expansion: 2
});

await videos.init();
await videos.add("video:abc123");

const maybeExists = await videos.mightContain("video:abc123");
```

## Why RedisBloom?

In-memory Bloom filters are fast, but every Node.js process gets its own copy and the filter disappears when the process restarts. RedisBloom keeps the filter in Redis, so multiple app instances can share one filter and Redis persistence can survive restarts.

This package does not require Docker. Your application only needs access to Redis Stack or Redis with the RedisBloom module enabled.

## Install

```bash
npm install scalable-bloom-kit redis
```

`redis` is a peer dependency. You own the Redis connection, which makes the package easy to use in Express, NestJS, workers, queues, and existing backend services.

## API

### `new BloomFilter(options)`

```ts
const filter = new BloomFilter({
  client,
  key: "users:bloom",
  expectedItems: 500_000,
  errorRate: 0.01,
  expansion: 2
});
```

Options:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `client` | `{ sendCommand(command: string[]): Promise<unknown> }` | Yes | Redis client. `node-redis` works out of the box. |
| `key` | `string` | Yes | Redis key for the Bloom filter. |
| `expectedItems` | `number` | Yes | Initial expected capacity. |
| `errorRate` | `number` | Yes | Target false-positive rate, such as `0.01`. |
| `expansion` | `number` | No | RedisBloom expansion rate. Defaults to `2`. |
| `autoCreate` | `boolean` | No | Create the filter during `init()` if it does not exist. Defaults to `true`. |

### Methods

```ts
await filter.init();
await filter.add("user:123");
await filter.addMany(["user:123", "user:456"]);
await filter.mightContain("user:123");
await filter.mightContainMany(["user:123", "user:ghost"]);
await filter.info();
await filter.clear();
```

Use `mightContain()` carefully:

- `false` means the item is definitely not in the set.
- `true` means the item may be in the set, so check your database or source of truth.

## Example: Skip Database Lookups

```ts
app.get("/videos/:id", async (req, res) => {
  const key = `video:${req.params.id}`;

  if (!(await videos.mightContain(key))) {
    return res.status(404).json({ message: "Video not found" });
  }

  const video = await db.videos.findById(req.params.id);

  if (!video) {
    return res.status(404).json({ message: "Video not found" });
  }

  return res.json(video);
});
```

## Deletion

Bloom filters do not safely support deletion. For use cases where deletion is required, a Cuckoo filter is usually a better fit. Cuckoo filter support is planned for a later version.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Integration tests require Redis Stack or Redis with RedisBloom enabled. Unit tests use a fake Redis client and do not require Docker.

## Real RedisBloom Check

Start a RedisBloom-compatible Redis server first. For local macOS testing with Redis Stack Server:

```bash
redis-stack-server
```

In another terminal:

```bash
npm run check:redis
```

This checks:

- Redis is reachable.
- RedisBloom module `bf` is loaded.
- `BloomFilter.add()` and `BloomFilter.mightContain()` work with real Redis.
- Missing records can skip simulated database lookups.

You can tune the check:

```bash
REDIS_URL=redis://127.0.0.1:6379 CHECK_REQUESTS=5000 DB_LATENCY_MS=5 npm run check:redis
```
