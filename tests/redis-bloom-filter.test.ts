import { describe, expect, it } from "vitest";
import { BloomFilter, BloomFilterInitializationError, BloomFilterValidationError } from "../src/index.js";
import type { RedisCommandClient } from "../src/index.js";

class FakeRedisBloomClient implements RedisCommandClient {
  readonly commands: string[][] = [];
  private readonly filters = new Map<string, Set<string>>();

  async sendCommand(command: string[]): Promise<unknown> {
    this.commands.push(command);
    const [name, key, ...args] = command;

    if (!name || !key) {
      throw new Error("Invalid command.");
    }

    switch (name) {
      case "BF.INFO":
        return this.info(key);
      case "BF.RESERVE":
        return this.reserve(key);
      case "BF.ADD":
        return this.add(key, args[0]);
      case "BF.MADD":
        return args.map((item) => this.add(key, item));
      case "BF.EXISTS":
        return this.exists(key, args[0]);
      case "BF.MEXISTS":
        return args.map((item) => this.exists(key, item));
      case "DEL":
        return this.filters.delete(key) ? 1 : 0;
      default:
        throw new Error(`Unknown command: ${name}`);
    }
  }

  private reserve(key: string): string {
    if (this.filters.has(key)) {
      throw new Error("item exists");
    }

    this.filters.set(key, new Set());
    return "OK";
  }

  private add(key: string, item: string | undefined): number {
    if (!item) {
      throw new Error("Missing item.");
    }

    const filter = this.getFilter(key);
    const existed = filter.has(item);
    filter.add(item);
    return existed ? 0 : 1;
  }

  private exists(key: string, item: string | undefined): number {
    if (!item) {
      throw new Error("Missing item.");
    }

    return this.getFilter(key).has(item) ? 1 : 0;
  }

  private info(key: string): unknown[] {
    const filter = this.filters.get(key);

    if (!filter) {
      throw new Error("not found");
    }

    return [
      "Capacity",
      100,
      "Size",
      64,
      "Number of filters",
      1,
      "Number of items inserted",
      filter.size,
      "Expansion rate",
      2
    ];
  }

  private getFilter(key: string): Set<string> {
    const filter = this.filters.get(key);

    if (!filter) {
      throw new Error("not found");
    }

    return filter;
  }
}

describe("BloomFilter", () => {
  it("creates a scalable RedisBloom filter during init", async () => {
    const client = new FakeRedisBloomClient();
    const filter = new BloomFilter({
      client,
      key: "videos:bloom",
      expectedItems: 1_000,
      errorRate: 0.01,
      expansion: 3
    });

    await filter.init();

    expect(client.commands).toContainEqual(["BF.INFO", "videos:bloom"]);
    expect(client.commands).toContainEqual([
      "BF.RESERVE",
      "videos:bloom",
      "0.01",
      "1000",
      "EXPANSION",
      "3"
    ]);
  });

  it("adds and checks items", async () => {
    const filter = new BloomFilter({
      client: new FakeRedisBloomClient(),
      key: "videos:bloom",
      expectedItems: 1_000,
      errorRate: 0.01
    });

    await expect(filter.add("video:abc123")).resolves.toBe(true);
    await expect(filter.add("video:abc123")).resolves.toBe(false);
    await expect(filter.mightContain("video:abc123")).resolves.toBe(true);
    await expect(filter.mightContain("video:ghost")).resolves.toBe(false);
  });

  it("adds and checks many items", async () => {
    const filter = new BloomFilter({
      client: new FakeRedisBloomClient(),
      key: "videos:bloom",
      expectedItems: 1_000,
      errorRate: 0.01
    });

    await expect(filter.addMany(["video:1", "video:2"])).resolves.toEqual([true, true]);
    await expect(filter.mightContainMany(["video:1", "video:ghost"])).resolves.toEqual([true, false]);
  });

  it("returns parsed filter info", async () => {
    const filter = new BloomFilter({
      client: new FakeRedisBloomClient(),
      key: "videos:bloom",
      expectedItems: 1_000,
      errorRate: 0.01
    });

    await filter.addMany(["video:1", "video:2"]);

    await expect(filter.info()).resolves.toMatchObject({
      capacity: 100,
      size: 64,
      numberOfFilters: 1,
      numberOfItemsInserted: 2,
      expansionRate: 2
    });
  });

  it("clears the filter", async () => {
    const filter = new BloomFilter({
      client: new FakeRedisBloomClient(),
      key: "videos:bloom",
      expectedItems: 1_000,
      errorRate: 0.01
    });

    await filter.add("video:abc123");
    await expect(filter.clear()).resolves.toBe(true);
    await expect(filter.mightContain("video:abc123")).resolves.toBe(false);
  });

  it("throws when autoCreate is disabled and the filter does not exist", async () => {
    const filter = new BloomFilter({
      client: new FakeRedisBloomClient(),
      key: "videos:bloom",
      expectedItems: 1_000,
      errorRate: 0.01,
      autoCreate: false
    });

    await expect(filter.init()).rejects.toBeInstanceOf(BloomFilterInitializationError);
  });

  it("validates configuration", () => {
    expect(
      () =>
        new BloomFilter({
          client: new FakeRedisBloomClient(),
          key: "",
          expectedItems: 1_000,
          errorRate: 0.01
        })
    ).toThrow(BloomFilterValidationError);
  });
});
