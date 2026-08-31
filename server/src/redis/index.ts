import 'dotenv/config';
import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient } from 'redis';

type ListSide = 'left' | 'right';

interface RedisPipeline {
  rpush(key: string, ...values: string[]): RedisPipeline;
  lmove(source: string, destination: string, from: ListSide, to: ListSide): RedisPipeline;
  lrem(key: string, count: number, value: string): RedisPipeline;
  exec(): Promise<unknown[]>;
}

interface RedisClient {
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string, count: number): Promise<string[] | null>;
  lmove(source: string, destination: string, from: ListSide, to: ListSide): Promise<string | null>;
  lrem(key: string, count: number, value: string): Promise<number>;
  set(key: string, value: string, options: { px: number; nx: true }): Promise<string | null>;
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
  pipeline(): RedisPipeline;
}

class UpstashPipeline implements RedisPipeline {
  private readonly pipeline;

  constructor(redis: UpstashRedis) {
    this.pipeline = redis.pipeline();
  }

  rpush(key: string, ...values: string[]): this {
    this.pipeline.rpush(key, ...values);
    return this;
  }

  lmove(source: string, destination: string, from: ListSide, to: ListSide): this {
    this.pipeline.lmove(source, destination, from, to);
    return this;
  }

  lrem(key: string, count: number, value: string): this {
    this.pipeline.lrem(key, count, value);
    return this;
  }

  async exec(): Promise<unknown[]> {
    return this.pipeline.exec();
  }
}

class LocalPipeline implements RedisPipeline {
  private readonly commands: Array<() => Promise<unknown>> = [];

  constructor(private readonly client: LocalRedisClient) {}

  rpush(key: string, ...values: string[]): this {
    this.commands.push(() => this.client.rpush(key, ...values));
    return this;
  }

  lmove(source: string, destination: string, from: ListSide, to: ListSide): this {
    this.commands.push(() => this.client.lmove(source, destination, from, to));
    return this;
  }

  lrem(key: string, count: number, value: string): this {
    this.commands.push(() => this.client.lrem(key, count, value));
    return this;
  }

  async exec(): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const command of this.commands) results.push(await command());
    return results;
  }
}

class UpstashRedisClient implements RedisClient {
  private readonly client = UpstashRedis.fromEnv({ automaticDeserialization: false });

  rpush(key: string, ...values: string[]): Promise<number> {
    return this.client.rpush(key, ...values);
  }

  lpop(key: string, count: number): Promise<string[] | null> {
    return this.client.lpop<string[]>(key, count);
  }

  lmove(source: string, destination: string, from: ListSide, to: ListSide): Promise<string | null> {
    return this.client.lmove<string>(source, destination, from, to) as Promise<string | null>;
  }

  lrem(key: string, count: number, value: string): Promise<number> {
    return this.client.lrem(key, count, value);
  }

  set(key: string, value: string, options: { px: number; nx: true }): Promise<string | null> {
    return this.client.set(key, value, options);
  }

  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    return this.client.eval(script, keys, args);
  }

  pipeline(): RedisPipeline {
    return new UpstashPipeline(this.client);
  }
}

class LocalRedisClient implements RedisClient {
  private readonly client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  private connecting: Promise<unknown> | undefined;

  constructor() {
    this.client.on('error', (error) => {
      console.error('Local Redis client error:', error);
    });
  }

  private async command(args: string[]): Promise<unknown> {
    if (!this.client.isOpen) {
      this.connecting ||= this.client.connect().finally(() => {
        this.connecting = undefined;
      });
      await this.connecting;
    }
    return this.client.sendCommand(args);
  }

  async rpush(key: string, ...values: string[]): Promise<number> {
    return this.command(['RPUSH', key, ...values]) as Promise<number>;
  }

  async lpop(key: string, count: number): Promise<string[] | null> {
    return this.command(['LPOP', key, String(count)]) as Promise<string[] | null>;
  }

  async lmove(source: string, destination: string, from: ListSide, to: ListSide): Promise<string | null> {
    return this.command(['LMOVE', source, destination, from.toUpperCase(), to.toUpperCase()]) as Promise<string | null>;
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    return this.command(['LREM', key, String(count), value]) as Promise<number>;
  }

  async set(key: string, value: string, options: { px: number; nx: true }): Promise<string | null> {
    return this.command(['SET', key, value, 'PX', String(options.px), 'NX']) as Promise<string | null>;
  }

  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    return this.command([
      'EVAL',
      script,
      String(keys.length),
      ...keys,
      ...args.map(String),
    ]);
  }

  pipeline(): RedisPipeline {
    return new LocalPipeline(this);
  }
}

const hasUpstashUrl = Boolean(process.env.UPSTASH_REDIS_REST_URL);
const hasUpstashToken = Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

if (hasUpstashUrl !== hasUpstashToken) {
  throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together');
}

// Production uses Upstash REST. Local development keeps using the existing
// Docker Redis endpoint when the Upstash credentials are absent.
export const redis: RedisClient = hasUpstashUrl ? new UpstashRedisClient() : new LocalRedisClient();
