import 'reflect-metadata';
import { Module, type DynamicModule, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Env } from './types';
import { Store } from './store';
import { Scheduler } from './scheduler';
import { Telegram } from './telegram';
import { McpEndpoint } from './mcp';
import { OAuth } from './oauth';
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return { module: AppModule, providers: [
      { provide: Store, useFactory: () => new Store(env) },
      { provide: Scheduler, inject: [Store], useFactory: (s: Store) => new Scheduler(env, s) },
      { provide: Telegram, inject: [Store], useFactory: (s: Store) => new Telegram(env, s) },
      { provide: McpEndpoint, inject: [Store], useFactory: (s: Store) => new McpEndpoint(env, s) },
      { provide: OAuth, useFactory: () => new OAuth(env) }
    ] };
  }
}
const contexts = new WeakMap<Env, Promise<INestApplicationContext>>();
export async function application(env: Env) {
  let context = contexts.get(env);
  if (!context) {
    context = NestFactory.createApplicationContext(AppModule.forRoot(env), { logger: false, abortOnError: false });
    contexts.set(env, context);
    context.catch(() => contexts.delete(env));
  }
  return context;
}
