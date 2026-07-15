import { API } from '@/contracts';
/**
 * Module quản lý Cookie Google AI Studio (Google Labs Whisk Cookie Manager)
 */

export async function autoImportCookieAction(): Promise<string> {
  try {
    const res = await fetch(API.getCookie, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Trích xuất Cookie thất bại hoặc hết hạn chờ.');
    }
    const data = await res.json();
    if (data.cookie) {
      return data.cookie;
    } else {
      throw new Error('Dữ liệu Cookie trả về trống.');
    }
  } catch (err: unknown) {
    throw new Error(`Lỗi lấy Cookie tự động: ${err instanceof Error ? err.message : String(err)}\n💡 Hãy chắc chắn rằng bạn có cài đặt Google Chrome trên máy tính.`);
  }
}

export function addCookieAction(
  cookies: string[],
  newCookie: string
): string[] {
  const trimmed = newCookie.trim();
  if (!trimmed) return cookies;
  
  const updated = [...cookies];
  if (!updated.includes(trimmed)) {
    updated.push(trimmed);
  }
  return updated;
}

export function removeCookieAction(
  cookies: string[],
  index: number
): string[] {
  const updated = [...cookies];
  updated.splice(index, 1);
  return updated;
}
