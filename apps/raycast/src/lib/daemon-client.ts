export interface SendPayload {
  text?: string;
  filePath?: string;
  caption?: string;
  phoneNumber: string;
}

export async function sendToDaemon(port: number, payload: SendPayload): Promise<void> {
  const res = await fetch(`http://localhost:${port}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Daemon returned ${res.status}`);
  }
}
