let token = "";
export async function api<T>(
  url: string,
  body?: unknown,
  method = "GET",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${url}`, {
      method,
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-TraceLens-Token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("无法连接本地服务，请检查服务是否正在运行。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      `本地服务响应不可用（HTTP ${response.status}），请检查服务并重试。`,
    );
  }
  if (!response.ok)
    throw new Error(data?.error || `请求失败 (${response.status})`);
  return data;
}
export async function session(): Promise<{ dataDir: string }> {
  const result = await api<{ token: string; dataDir: string }>("/session");
  token = result.token;
  return result;
}
