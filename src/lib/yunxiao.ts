import type { AppConfig } from "@/types";
import { getYunxiaoToken } from "@/config/config";

export async function callYunxiao<T>(
  config: AppConfig,
  path: string,
  init: RequestInit
): Promise<T> {
  const token = getYunxiaoToken(config);
  if (!token) {
    throw new Error(`Missing Yunxiao token env: ${config.yunxiao.tokenEnv}`);
  }

  const response = await fetch(`${config.yunxiao.domain}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-yunxiao-token": token,
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Yunxiao API failed ${response.status}: ${text}`);
  }

  return (await response.json()) as T;
}
