// With USB debugging: run `adb reverse tcp:8000 tcp:8000` then use localhost
// For WiFi: use your computer's IP address
const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';

let cachedUserId: string | null = null;

async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  console.log(`[API] Authenticating at ${API_URL}/auth/anon`);

  const res = await fetch(`${API_URL}/auth/anon`, {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedUserId = data.user_id;
  console.log(`[API] Got user ID: ${cachedUserId}`);
  return cachedUserId;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const userId = await getUserId();

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
      ...(options.headers || {}),
    },
  });
}

export async function createChat(title: string) {
  console.log(`[API] Creating chat: ${title}`);
  const res = await apiFetch('/chats', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create chat failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`[API] Chat created:`, data);
  return data;
}

export async function getChats(): Promise<{ id: string; title: string; created_at: string }[]> {
  const res = await apiFetch('/chats');
  if (!res.ok) {
    throw new Error('Failed to load chats');
  }
  return res.json();
}

export async function getMessages(chatId: string) {
  const res = await apiFetch(`/chats/${chatId}/messages`);
  return res.json();
}

export async function sendMessage(chatId: string, content: string, attachmentIds: string[] = []) {
  const res = await apiFetch(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      attachment_ids: attachmentIds,
    }),
  });
  return res.json();
}

export async function uploadFile(
  uri: string,
  filename: string,
  mimeType: string,
  chatId?: string
): Promise<{ id: string; filename: string }> {
  const userId = await getUserId();

  const form = new FormData();
  if (chatId) {
    form.append('chat_id', chatId);
  }

  // React Native FormData format
  form.append('file', {
    uri,
    name: filename,
    type: mimeType,
  } as any);

  console.log(`[API] Uploading file: ${filename}`);

  const res = await fetch(`${API_URL}/files/upload`, {
    method: 'POST',
    headers: {
      'X-User-Id': userId,
      // Don't set Content-Type - fetch sets boundary for multipart
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log(`[API] File uploaded:`, data);
  return data;
}
