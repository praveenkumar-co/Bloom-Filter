import { BloomFilterInitializationError } from "./errors.js";
import type { BloomFilterInfo, BloomFilterOptions, RedisCommandClient } from "./types.js";
import { validateBloomFilterOptions } from "./validation.js";

const DEFAULT_EXPANSION = 2;

export class BloomFilter {
  private readonly client: RedisCommandClient;
  private readonly key: string;
  private readonly expectedItems: number;
  private readonly errorRate: number;
  private readonly expansion: number;
  private readonly autoCreate: boolean;
  private initialized = false;

  constructor(options: BloomFilterOptions) {
    validateBloomFilterOptions(options);

    this.client = options.client;
    this.key = options.key;
    this.expectedItems = options.expectedItems;
    this.errorRate = options.errorRate;
    this.expansion = options.expansion ?? DEFAULT_EXPANSION;
    this.autoCreate = options.autoCreate ?? true;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (await this.filterExists()) {
      this.initialized = true;
      return;
    }

    if (!this.autoCreate) {
      throw new BloomFilterInitializationError(
        `Bloom filter "${this.key}" does not exist and autoCreate is disabled.`
      );
    }

    await this.reserve();
    this.initialized = true;
  }

  async add(item: string): Promise<boolean> {
    this.assertItem(item);
    await this.ensureInitialized();

    const result = await this.client.sendCommand(["BF.ADD", this.key, item]);
    return Number(result) === 1;
  }

  async addMany(items: readonly string[]): Promise<boolean[]> {
    this.assertItems(items);
    await this.ensureInitialized();

    const result = await this.client.sendCommand(["BF.MADD", this.key, ...items]);
    return this.toBooleanArray(result);
  }

  async mightContain(item: string): Promise<boolean> {
    this.assertItem(item);
    await this.ensureInitialized();

    const result = await this.client.sendCommand(["BF.EXISTS", this.key, item]);
    return Number(result) === 1;
  }

  async mightContainMany(items: readonly string[]): Promise<boolean[]> {
    this.assertItems(items);
    await this.ensureInitialized();

    const result = await this.client.sendCommand(["BF.MEXISTS", this.key, ...items]);
    return this.toBooleanArray(result);
  }

  async info(): Promise<BloomFilterInfo> {
    await this.ensureInitialized();

    const result = await this.client.sendCommand(["BF.INFO", this.key]);
    return parseBloomInfo(result);
  }

  async clear(): Promise<boolean> {
    const result = await this.client.sendCommand(["DEL", this.key]);
    this.initialized = false;
    return Number(result) > 0;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private async filterExists(): Promise<boolean> {
    try {
      await this.client.sendCommand(["BF.INFO", this.key]);
      return true;
    } catch (error) {
      if (isMissingFilterError(error)) {
        return false;
      }

      throw new BloomFilterInitializationError(
        "Failed to inspect RedisBloom filter. Make sure Redis Stack or the RedisBloom module is enabled.",
        { cause: error }
      );
    }
  }

  private async reserve(): Promise<void> {
    try {
      await this.client.sendCommand([
        "BF.RESERVE",
        this.key,
        String(this.errorRate),
        String(this.expectedItems),
        "EXPANSION",
        String(this.expansion)
      ]);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        this.initialized = true;
        return;
      }

      throw new BloomFilterInitializationError(
        "Failed to create RedisBloom filter. Make sure Redis Stack or the RedisBloom module is enabled.",
        { cause: error }
      );
    }
  }

  private assertItem(item: string): void {
    if (typeof item !== "string" || item.length === 0) {
      throw new TypeError("Bloom filter item must be a non-empty string.");
    }
  }

  private assertItems(items: readonly string[]): void {
    if (!Array.isArray(items)) {
      throw new TypeError("Bloom filter items must be an array of strings.");
    }

    if (items.length === 0) {
      throw new TypeError("Bloom filter items array must not be empty.");
    }

    for (const item of items) {
      this.assertItem(item);
    }
  }

  private toBooleanArray(value: unknown): boolean[] {
    if (!Array.isArray(value)) {
      throw new TypeError("Expected RedisBloom command to return an array.");
    }

    return value.map((entry) => Number(entry) === 1);
  }
}

function parseBloomInfo(value: unknown): BloomFilterInfo {
  const raw = parseRedisInfoArray(value);
  const info: BloomFilterInfo = { raw };

  setOptionalNumber(info, "capacity", raw.Capacity);
  setOptionalNumber(info, "size", raw.Size);
  setOptionalNumber(info, "numberOfFilters", raw["Number of filters"]);
  setOptionalNumber(info, "numberOfItemsInserted", raw["Number of items inserted"]);
  setOptionalNumber(info, "expansionRate", raw["Expansion rate"]);

  return info;
}

function parseRedisInfoArray(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return {};
  }

  const info: Record<string, unknown> = {};

  for (let index = 0; index < value.length; index += 2) {
    const key = value[index];
    const entry = value[index + 1];

    if (typeof key === "string") {
      info[key] = entry;
    }
  }

  return info;
}

function toOptionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function setOptionalNumber(
  info: BloomFilterInfo,
  key: Exclude<keyof BloomFilterInfo, "raw">,
  value: unknown
): void {
  const numberValue = toOptionalNumber(value);

  if (numberValue !== undefined) {
    info[key] = numberValue;
  }
}

function isMissingFilterError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("no such key") ||
    message.includes("nonexistent")
  );
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("already exists") ||
    message.includes("item exists") ||
    message.includes("key exists") ||
    message.includes("exists")
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }

  return String(error).toLowerCase();
}
