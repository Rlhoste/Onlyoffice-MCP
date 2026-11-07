import test from "node:test";
import assert from "node:assert/strict";
import { createSerialQueue } from "../serial-queue.mjs";

test("serial queue never overlaps operations", async () => {
  const enqueue = createSerialQueue();
  let active = 0;
  let maxActive = 0;
  const order = [];
  const operation = id => enqueue(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`start-${id}`);
    await new Promise(resolve => setImmediate(resolve));
    order.push(`end-${id}`);
    active -= 1;
  });
  await Promise.all([operation(1), operation(2), operation(3)]);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
});

test("serial queue continues after a rejected operation", async () => {
  const enqueue = createSerialQueue();
  await assert.rejects(enqueue(async () => { throw new Error("expected"); }));
  assert.equal(await enqueue(async () => 42), 42);
});
