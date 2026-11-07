export function createSerialQueue() {
  let tail = Promise.resolve();
  return function enqueue(operation) {
    const run = tail.then(operation, operation);
    tail = run.catch(() => undefined);
    return run;
  };
}
