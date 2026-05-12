import { BloomFilterValidationError } from "./errors.js";
import type { BloomFilterOptions } from "./types.js";

export function validateBloomFilterOptions(options: BloomFilterOptions): void {
  if (!options.client || typeof options.client.sendCommand !== "function") {
    throw new BloomFilterValidationError(
      "A Redis client with sendCommand(command: string[]) is required."
    );
  }

  if (typeof options.key !== "string" || options.key.trim().length === 0) {
    throw new BloomFilterValidationError("Bloom filter key must be a non-empty string.");
  }

  if (!Number.isSafeInteger(options.expectedItems) || options.expectedItems <= 0) {
    throw new BloomFilterValidationError("expectedItems must be a positive safe integer.");
  }

  if (typeof options.errorRate !== "number" || options.errorRate <= 0 || options.errorRate >= 1) {
    throw new BloomFilterValidationError("errorRate must be a number greater than 0 and less than 1.");
  }

  if (
    options.expansion !== undefined &&
    (!Number.isSafeInteger(options.expansion) || options.expansion < 1)
  ) {
    throw new BloomFilterValidationError("expansion must be a positive safe integer.");
  }
}
