import { createInterface } from 'node:readline';

const WAIT_MS = 30_000;

function withTimeout(promise, description, milliseconds = WAIT_MS) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out`)), milliseconds);
    promise.then(
      value => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function waitForExit(child, description, milliseconds = WAIT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return withTimeout(
    new Promise((resolvePromise, reject) => {
      child.once('exit', (code, signal) => resolvePromise({ code, signal }));
      child.once('error', reject);
    }),
    `${description} exit`,
    milliseconds,
  );
}

export class RpcError extends Error {
  constructor(method, error) {
    super(`${method} failed: ${JSON.stringify(error)}`);
    this.rpc = error;
  }
}

export class JsonLinePeer {
  constructor(child, name) {
    this.child = child;
    this.name = name;
    this.nextId = 0;
    this.pending = new Map();
    this.notifications = [];
    this.notificationWaiters = [];
    this.lines = createInterface({ input: child.stdout });
    this.lines.on('line', line => this.#receive(line));
    child.once('error', error => this.#fail(error));
    child.once('exit', (code, signal) => {
      this.#fail(new Error(`${name} exited (code ${code}, signal ${signal})`));
    });
  }

  #receive(line) {
    try {
      const message = JSON.parse(line);
      if (Object.hasOwn(message, 'id')) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new RpcError(pending.method, message.error));
        else pending.resolve(message.result);
        return;
      }
      if (typeof message.method === 'string') {
        const waiterIndex = this.notificationWaiters.findIndex(
          waiter => waiter.method === message.method,
        );
        if (waiterIndex >= 0) {
          const [waiter] = this.notificationWaiters.splice(waiterIndex, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message.params);
        } else {
          this.notifications.push(message);
        }
      }
    } catch (error) {
      this.#fail(new Error(`${this.name} emitted invalid JSON: ${error.message}`));
    }
  }

  #fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.notificationWaiters.length = 0;
  }

  request(method, params) {
    return new Promise((resolvePromise, reject) => {
      const requestId = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${this.name} ${method} timed out`));
      }, WAIT_MS);
      this.pending.set(requestId, { method, resolve: resolvePromise, reject, timer });
      this.child.stdin.write(
        `${JSON.stringify({ id: requestId, method, params })}\n`,
        error => {
          if (!error) return;
          const pending = this.pending.get(requestId);
          if (!pending) return;
          this.pending.delete(requestId);
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  notification(method) {
    const notificationIndex = this.notifications.findIndex(item => item.method === method);
    if (notificationIndex >= 0) {
      return Promise.resolve(this.notifications.splice(notificationIndex, 1)[0].params);
    }
    return new Promise((resolvePromise, reject) => {
      const waiter = { method, resolve: resolvePromise, reject };
      waiter.timer = setTimeout(() => {
        const index = this.notificationWaiters.indexOf(waiter);
        if (index >= 0) this.notificationWaiters.splice(index, 1);
        reject(new Error(`${this.name} ${method} notification timed out`));
      }, WAIT_MS);
      this.notificationWaiters.push(waiter);
    });
  }

  close() {
    this.lines.close();
  }
}

export function captureStderr(child, maximumCharacters = 32_000) {
  let value = '';
  child.stderr.on('data', chunk => {
    value = (value + chunk).slice(-maximumCharacters);
  });
  return () => value;
}

export async function stopChild(
  child,
  description = 'cleanup process',
  milliseconds = 3_000,
) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  try {
    await waitForExit(child, description, milliseconds);
  } catch {
    child.kill();
    try {
      await waitForExit(child, `killed ${description}`, milliseconds);
    } catch {
      // The bounded cleanup made its final attempt; preserve the original failure.
    }
  }
}
