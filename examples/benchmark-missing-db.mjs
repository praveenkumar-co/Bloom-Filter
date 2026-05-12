import { performance } from "node:perf_hooks";
import { BloomFilter } from "../dist/index.js";

const REQUESTS = 10_000;
const DATABASE_LATENCY_MS = 5;

class FakeRedisBloomClient {
  commands = [];
  filters = new Map();

  async sendCommand(command) {
    this.commands.push(command);
    const [name, key, ...args] = command;

    switch (name) {
      case "BF.INFO":
        return this.info(key);
      case "BF.RESERVE":
        return this.reserve(key);
      case "BF.ADD":
        return this.add(key, args[0]);
      case "BF.EXISTS":
        return this.exists(key, args[0]);
      case "DEL":
        return this.filters.delete(key) ? 1 : 0;
      default:
        throw new Error(`Unsupported command: ${name}`);
    }
  }

  reserve(key) {
    if (this.filters.has(key)) {
      throw new Error("item exists");
    }

    this.filters.set(key, new Set());
    return "OK";
  }

  add(key, item) {
    const filter = this.getFilter(key);
    const existed = filter.has(item);
    filter.add(item);
    return existed ? 0 : 1;
  }

  exists(key, item) {
    return this.getFilter(key).has(item) ? 1 : 0;
  }

  info(key) {
    const filter = this.filters.get(key);

    if (!filter) {
      throw new Error("not found");
    }

    return [
      "Capacity",
      100_000,
      "Size",
      1024,
      "Number of filters",
      1,
      "Number of items inserted",
      filter.size,
      "Expansion rate",
      2
    ];
  }

  getFilter(key) {
    const filter = this.filters.get(key);

    if (!filter) {
      throw new Error("not found");
    }

    return filter;
  }
}

async function fakeDatabaseFindById() {
  await delay(DATABASE_LATENCY_MS);
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function time(label, operation) {
  const start = performance.now();
  const result = await operation();
  const durationMs = performance.now() - start;

  return {
    label,
    durationMs,
    ...result
  };
}

async function directDatabaseLookup() {
  let dbQueries = 0;

  for (let index = 0; index < REQUESTS; index += 1) {
    dbQueries += 1;
    await fakeDatabaseFindById(`missing:${index}`);
  }

  return { dbQueries };
}

async function bloomProtectedLookup() {
  const bloom = new BloomFilter({
    client: new FakeRedisBloomClient(),
    key: "benchmark:bloom",
    expectedItems: 100_000,
    errorRate: 0.01
  });

  await bloom.init();

  let dbQueries = 0;
  let skippedDbQueries = 0;

  for (let index = 0; index < REQUESTS; index += 1) {
    const maybeExists = await bloom.mightContain(`missing:${index}`);

    if (!maybeExists) {
      skippedDbQueries += 1;
      continue;
    }

    dbQueries += 1;
    await fakeDatabaseFindById(`missing:${index}`);
  }

  return { dbQueries, skippedDbQueries };
}

const direct = await time("Direct DB lookup", directDatabaseLookup);
const protectedLookup = await time("Bloom-protected lookup", bloomProtectedLookup);
const speedup = direct.durationMs / protectedLookup.durationMs;

console.table([
  {
    flow: direct.label,
    requests: REQUESTS,
    "db queries": direct.dbQueries,
    "skipped db queries": 0,
    "duration ms": Math.round(direct.durationMs)
  },
  {
    flow: protectedLookup.label,
    requests: REQUESTS,
    "db queries": protectedLookup.dbQueries,
    "skipped db queries": protectedLookup.skippedDbQueries,
    "duration ms": Math.round(protectedLookup.durationMs)
  }
]);

console.log(`Approx speedup for missing records: ${speedup.toFixed(1)}x`);
console.log(
  "Note: this benchmark simulates database latency. Real results depend on Redis, network, database latency, and false-positive rate."
);
