// 客户端口令存储：用户在设置页输入一次操作口令，保存在本机浏览器，
// 之后所有写请求（收藏、信息源管理、已读同步、更新触发）自动带上。
const STORAGE_KEY = "trendlens.app-secret.v1";

export function getAppSecret(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAppSecret(secret: string) {
  if (typeof window === "undefined") return;
  try {
    if (secret) {
      window.localStorage.setItem(STORAGE_KEY, secret);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
}

export function hasAppSecret() {
  return Boolean(getAppSecret());
}

export function appSecretHeaders(): Record<string, string> {
  const secret = getAppSecret();
  return secret ? { "x-trendlens-secret": secret } : {};
}
