/**
 * Module quản lý danh sách Gemini API Keys xoay vòng (API Key Rotation Manager)
 */

export function addApiKeyAction(
  apiKeys: string[],
  newKey: string
): string[] {
  const trimmed = newKey.trim();
  if (!trimmed) return apiKeys;
  
  const updated = [...apiKeys];
  if (!updated.includes(trimmed)) {
    updated.push(trimmed);
  }
  return updated;
}

export function removeApiKeyAction(
  apiKeys: string[],
  index: number
): string[] {
  const updated = [...apiKeys];
  updated.splice(index, 1);
  return updated;
}
