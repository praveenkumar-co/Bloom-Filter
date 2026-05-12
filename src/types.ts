export interface RedisCommandClient {
  sendCommand(command: string[]): Promise<unknown>;
}

export interface BloomFilterOptions {
  client: RedisCommandClient;
  key: string;
  expectedItems: number;
  errorRate: number;
  expansion?: number;
  autoCreate?: boolean;
}

export interface BloomFilterInfo {
  capacity?: number;
  size?: number;
  numberOfFilters?: number;
  numberOfItemsInserted?: number;
  expansionRate?: number;
  raw: Record<string, unknown>;
}
