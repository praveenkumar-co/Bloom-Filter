import { performance } from "node:perf_hooks";
import { Socket } from "node:net";
import { BloomFilter } from "../dist/index.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const key = process.env.BLOOM_KEY ?? "scalable-bloom-kit:check";
const requests = Number(process.env.CHECK_REQUESTS ?? 1000);
const simulatedDbLatencyMs = Number(process.env.DB_LATENCY_MS ?? 3);

async function main() {
  const client = new TinyRedisClient(redisUrl);

  try {
  console.log(`Connecting to ${redisUrl}`);
  await client.connect();

  const pong = await client.ping();
  console.log(`Redis ping: ${pong}`);

  const modules = await client.sendCommand(["MODULE", "LIST"]);
  const moduleNames = extractModuleNames(modules);

  if (!moduleNames.includes("bf")) {
    throw new Error(
      `RedisBloom module was not found. Loaded modules: ${moduleNames.join(", ") || "none"}`
    );
  }

  console.log("RedisBloom module: found");

  await client.del(key);

  const bloom = new BloomFilter({
    client,
    key,
    expectedItems: 100_000,
    errorRate: 0.01,
    expansion: 2
  });

  await bloom.init();
  await bloom.add("video:abc123");

  const presentResult = await bloom.mightContain("video:abc123");
  const missingResult = await bloom.mightContain("video:ghost");
  const info = await bloom.info();

  assertEqual(presentResult, true, "existing item should return true");
  assertEqual(missingResult, false, "missing item should return false");

  console.log("Bloom behavior: passed");
  console.log("Filter info:", {
    capacity: info.capacity,
    numberOfFilters: info.numberOfFilters,
    numberOfItemsInserted: info.numberOfItemsInserted,
    expansionRate: info.expansionRate
  });

  const redisLatency = await measureRedisMissingChecks(bloom);
  const directDb = await measureDirectDatabaseLookups();
  const bloomProtected = await measureBloomProtectedLookups(bloom);

  console.table([
    {
      check: "Redis missing checks",
      requests,
      "db queries": 0,
      "skipped db queries": requests,
      "duration ms": round(redisLatency.durationMs),
      "avg ms/op": round(redisLatency.durationMs / requests)
    },
    {
      check: "Direct simulated DB",
      requests,
      "db queries": requests,
      "skipped db queries": 0,
      "duration ms": round(directDb.durationMs),
      "avg ms/op": round(directDb.durationMs / requests)
    },
    {
      check: "Bloom-protected simulated DB",
      requests,
      "db queries": bloomProtected.dbQueries,
      "skipped db queries": bloomProtected.skippedDbQueries,
      "duration ms": round(bloomProtected.durationMs),
      "avg ms/op": round(bloomProtected.durationMs / requests)
    }
  ]);

  await bloom.clear();
  console.log("Real RedisBloom check: passed");
  } catch (error) {
  console.error("Real RedisBloom check: failed");
  printError(error);

  process.exitCode = 1;
  } finally {
  if (client.isOpen) {
    await client.disconnect();
  }
  }
}

class TinyRedisClient {
  isOpen = false;
  #socket = new Socket();
  #buffer = Buffer.alloc(0);
  #url;

  constructor(redisUrl) {
    this.#url = new URL(redisUrl);
  }

  async connect() {
    if (this.isOpen) {
      return;
    }

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.#socket.off("error", onError);
        this.#socket.off("connect", onConnect);
      };

      this.#socket.once("error", onError);
      this.#socket.once("connect", onConnect);
      this.#socket.connect(Number(this.#url.port || 6379), this.#url.hostname || "127.0.0.1");
    });

    this.isOpen = true;

    if (this.#url.password) {
      const authCommand = this.#url.username
        ? ["AUTH", decodeURIComponent(this.#url.username), decodeURIComponent(this.#url.password)]
        : ["AUTH", decodeURIComponent(this.#url.password)];
      await this.sendCommand(authCommand);
    }

    const database = this.#url.pathname.replace("/", "");

    if (database) {
      await this.sendCommand(["SELECT", database]);
    }
  }

  async ping() {
    return this.sendCommand(["PING"]);
  }

  async del(key) {
    return this.sendCommand(["DEL", key]);
  }

  async disconnect() {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.#socket.end();
  }

  async sendCommand(command) {
    if (!this.isOpen) {
      throw new Error("Redis client is not connected.");
    }

    return new Promise((resolve, reject) => {
      const onData = (chunk) => {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);

        try {
          const parsed = parseRedisValue(this.#buffer);

          if (!parsed.complete) {
            return;
          }

          cleanup();
          this.#buffer = this.#buffer.subarray(parsed.offset);

          if (parsed.value instanceof RedisCommandError) {
            reject(parsed.value);
            return;
          }

          resolve(parsed.value);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        this.#socket.off("data", onData);
        this.#socket.off("error", onError);
      };

      this.#socket.on("data", onData);
      this.#socket.once("error", onError);
      this.#socket.write(encodeRedisCommand(command));
    });
  }
}

class RedisCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = "RedisCommandError";
  }
}

async function measureRedisMissingChecks(bloom) {
  return time(async () => {
    for (let index = 0; index < requests; index += 1) {
      await bloom.mightContain(`missing:redis:${index}`);
    }

    return {};
  });
}

async function measureDirectDatabaseLookups() {
  return time(async () => {
    for (let index = 0; index < requests; index += 1) {
      await fakeDatabaseFindById(`missing:db:${index}`);
    }

    return {};
  });
}

async function measureBloomProtectedLookups(bloom) {
  return time(async () => {
    let dbQueries = 0;
    let skippedDbQueries = 0;

    for (let index = 0; index < requests; index += 1) {
      const maybeExists = await bloom.mightContain(`missing:protected:${index}`);

      if (!maybeExists) {
        skippedDbQueries += 1;
        continue;
      }

      dbQueries += 1;
      await fakeDatabaseFindById(`missing:protected:${index}`);
    }

    return { dbQueries, skippedDbQueries };
  });
}

async function fakeDatabaseFindById() {
  await delay(simulatedDbLatencyMs);
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function time(operation) {
  const start = performance.now();
  const result = await operation();
  const durationMs = performance.now() - start;

  return {
    durationMs,
    ...result
  };
}

function extractModuleNames(modules) {
  if (!Array.isArray(modules)) {
    return [];
  }

  const names = [];

  for (const moduleInfo of modules) {
    if (!Array.isArray(moduleInfo)) {
      continue;
    }

    for (let index = 0; index < moduleInfo.length; index += 2) {
      if (moduleInfo[index] === "name" && typeof moduleInfo[index + 1] === "string") {
        names.push(moduleInfo[index + 1]);
      }
    }
  }

  return names;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${expected}, received ${actual}.`);
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function printError(error, depth = 0) {
  const prefix = depth === 0 ? "" : "Caused by: ";

  if (error instanceof Error) {
    console.error(`${prefix}${error.message}`);

    if (error.cause) {
      printError(error.cause, depth + 1);
    }

    return;
  }

  console.error(`${prefix}${String(error)}`);
}

function encodeRedisCommand(command) {
  let encoded = `*${command.length}\r\n`;

  for (const part of command) {
    encoded += `$${Buffer.byteLength(part)}\r\n${part}\r\n`;
  }

  return encoded;
}

function parseRedisValue(buffer, offset = 0) {
  if (offset >= buffer.length) {
    return { complete: false };
  }

  const type = String.fromCharCode(buffer[offset]);

  switch (type) {
    case "+":
      return parseSimpleLine(buffer, offset, (value) => value);
    case "-":
      return parseSimpleLine(buffer, offset, (message) => new RedisCommandError(message));
    case ":":
      return parseSimpleLine(buffer, offset, Number);
    case "$":
      return parseBulkString(buffer, offset);
    case "*":
      return parseArray(buffer, offset);
    default:
      throw new Error(`Unsupported Redis response type: ${type}`);
  }
}

function parseSimpleLine(buffer, offset, transform) {
  const lineEnd = buffer.indexOf("\r\n", offset);

  if (lineEnd === -1) {
    return { complete: false };
  }

  const value = buffer.subarray(offset + 1, lineEnd).toString();

  return {
    complete: true,
    value: transform(value),
    offset: lineEnd + 2
  };
}

function parseBulkString(buffer, offset) {
  const lineEnd = buffer.indexOf("\r\n", offset);

  if (lineEnd === -1) {
    return { complete: false };
  }

  const length = Number(buffer.subarray(offset + 1, lineEnd).toString());

  if (length === -1) {
    return {
      complete: true,
      value: null,
      offset: lineEnd + 2
    };
  }

  const valueStart = lineEnd + 2;
  const valueEnd = valueStart + length;
  const responseEnd = valueEnd + 2;

  if (buffer.length < responseEnd) {
    return { complete: false };
  }

  return {
    complete: true,
    value: buffer.subarray(valueStart, valueEnd).toString(),
    offset: responseEnd
  };
}

function parseArray(buffer, offset) {
  const lineEnd = buffer.indexOf("\r\n", offset);

  if (lineEnd === -1) {
    return { complete: false };
  }

  const length = Number(buffer.subarray(offset + 1, lineEnd).toString());

  if (length === -1) {
    return {
      complete: true,
      value: null,
      offset: lineEnd + 2
    };
  }

  const values = [];
  let cursor = lineEnd + 2;

  for (let index = 0; index < length; index += 1) {
    const parsed = parseRedisValue(buffer, cursor);

    if (!parsed.complete) {
      return { complete: false };
    }

    values.push(parsed.value);
    cursor = parsed.offset;
  }

  return {
    complete: true,
    value: values,
    offset: cursor
  };
}

await main();
