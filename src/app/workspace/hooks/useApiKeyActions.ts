'use client';

import { useNovelStore } from '@/store/useNovelStore';
import { addApiKeyAction, removeApiKeyAction } from '../modules/apiKeyModule';

export function useApiKeyActions() {
  const store = useNovelStore();

  const handleAddApiKey = (newKey: string) => {
    const currentKeys = store.apiKeys || [];
    if (newKey.trim() && !currentKeys.includes(newKey.trim())) {
      const updatedKeys = addApiKeyAction(currentKeys, newKey);
      store.setApiKeys(updatedKeys);
      if (!store.apiKey) store.setApiKey(newKey.trim());
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
