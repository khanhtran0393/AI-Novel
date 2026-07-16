'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { API } from '@/contracts';
import { addApiKeyAction, removeApiKeyAction } from '../modules/apiKeyModule';

/** Register key pool on server so RPM/RPD timers start when user adds keys. */
function registerKeyPoolOnServer(keys: string[]) {
  const clean = keys.map((k) => String(k || '').trim()).filter(Boolean);
  if (!clean.length) return;
  void fetch(API.keyQuota, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: clean, register: true }),
  }).catch(() => {
    /* offline / server cold — first generate will still register */
  });
}

export function useApiKeyActions() {
  const store = useNovelStore();

  const handleAddApiKey = (newKey: string) => {
    const currentKeys = store.apiKeys || [];
    if (newKey.trim() && !currentKeys.includes(newKey.trim())) {
      const updatedKeys = addApiKeyAction(currentKeys, newKey);
      store.setApiKeys(updatedKeys);
      if (!store.apiKey) store.setApiKey(newKey.trim());
      registerKeyPoolOnServer(updatedKeys);
    }
  };

  const handleRemoveApiKey = (index: number) => {
    const currentKeys = store.apiKeys || [];
    const keyToRemove = currentKeys[index];
    const updatedKeys = removeApiKeyAction(currentKeys, index);
    store.setApiKeys(updatedKeys);
    if (store.apiKey === keyToRemove) {
      store.setApiKey(updatedKeys.length > 0 ? updatedKeys[0] : '');
    }
  };

  const handleRemoveMainApiKey = () => {
    store.setApiKey('');
  };

  return {
    handleAddApiKey,
    handleRemoveApiKey,
    handleRemoveMainApiKey
  };
}
