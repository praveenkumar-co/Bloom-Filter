export class BloomFilterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BloomFilterError";
  }
}

export class BloomFilterValidationError extends BloomFilterError {
  constructor(message: string) {
    super(message);
    this.name = "BloomFilterValidationError";
  }
}

export class BloomFilterInitializationError extends BloomFilterError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BloomFilterInitializationError";
  }
}
