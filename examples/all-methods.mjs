import { createClient } from "redis";
import { BloomFilter } from "../dist/index.js";

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
