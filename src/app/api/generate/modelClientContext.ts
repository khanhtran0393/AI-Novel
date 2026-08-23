import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProviderClientConfig } from './providerClients';

const storage = new AsyncLocalStorage<ProviderClientConfig>();

export function runWithModelClientConfig<T>(
  config: ProviderClientConfig,
  callback: () => Promise<T>,
): Promise<T> {
  return storage.run(config, callback);
}

export function currentModelClientConfig(
  model?: string,
): ProviderClientConfig {
  const scoped = storage.getStore();
  return {
    ...scoped,
    model: model || scoped?.model,
  };
}
