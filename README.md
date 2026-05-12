# scalable-bloom-kit

A TypeScript toolkit for production-friendly, Redis-backed scalable Bloom filters in Node.js.

Bloom filters help you avoid expensive database, cache, or disk lookups for values that definitely do not exist.

## Quick Start

Install the package:

```bash
npm install scalable-bloom-kit redis
```

You also need a RedisBloom-compatible Redis server. The easiest production-style setup is Redis Cloud or any hosted Redis Stack database.

```bash
REDIS_URL=redis://username:password@host:port
```

Some providers use TLS. In that case use:

```bash
REDIS_URL=rediss://username:password@host:port
```

For local macOS testing, you can run Redis Stack Server:

```bash
redis-stack-server
```

Then use `process.env.REDIS_URL` in your app:

```ts
import { createClient } from "redis";
import { BloomFilter } from "scalable-bloom-kit";

const client = createClient({
  url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
});

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

await client.disconnect();
```

If `mightContain()` returns `false`, the item is definitely not present and you can skip the database. If it returns `true`, check your database because Bloom filters can have false positives.

## Requirements

- Node.js `18+`
- A Redis client such as `redis`
- Redis Stack, RedisBloom, Redis Cloud, or another Redis server that supports RedisBloom commands like `BF.RESERVE`, `BF.ADD`, and `BF.EXISTS`

This package does not install or start Redis for you. It connects to the RedisBloom-compatible Redis server you provide.

## Why RedisBloom?

In-memory Bloom filters are fast, but every Node.js process gets its own copy and the filter disappears when the process restarts. RedisBloom keeps the filter in Redis, so multiple app instances can share one filter and Redis persistence can survive restarts.

This package does not require Docker. Docker is only one possible way to run Redis Stack locally.

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

## Full Method Demo

Create `index.mjs`:

```js
import { createClient } from "redis";
import { BloomFilter } from "scalable-bloom-kit";

const client = createClient({
  url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379"
});

await client.connect();

const users = new BloomFilter({
  client,
  key: "demo:users:bloom",
  expectedItems: 100_000,
  errorRate: 0.01,
  expansion: 2
});

await users.init();

console.log("add user:123", await users.add("user:123"));
console.log("add duplicate user:123", await users.add("user:123"));
console.log("addMany", await users.addMany(["user:456", "user:789"]));

console.log("mightContain user:123", await users.mightContain("user:123"));
console.log("mightContain user:ghost", await users.mightContain("user:ghost"));
console.log(
  "mightContainMany",
  await users.mightContainMany(["user:123", "user:456", "user:ghost"])
);

console.log("info", await users.info());
console.log("clear", await users.clear());

await client.disconnect();
```

Run:

```bash
node index.mjs
```

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

## Real RedisBloom Check

Start a RedisBloom-compatible Redis server first.

For local macOS testing:

```bash
redis-stack-server
```

For Redis Cloud or another hosted RedisBloom server:

```bash
REDIS_URL=redis://username:password@host:port
```

Then run:

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

## Deletion

Standard Bloom filters do not safely support deletion. If you need deletion, use a Cuckoo filter or Counting Bloom filter design. Cuckoo filter support is planned for a later version.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run check:redis
```

Unit tests use a fake Redis client and do not require Redis. `npm run check:redis` requires Redis Stack, RedisBloom, or Redis Cloud.

## Contributing

Contributions are welcome. Please keep changes focused, add tests for behavior changes, and run the checks before opening a pull request.

```bash
npm run typecheck
npm test
npm run build
```

For RedisBloom integration changes, also run:

```bash
npm run check:redis
```

## License

MIT © Contributors
