import React, { useEffect, useMemo, useState } from "react";
import { SafeAreaView, View, Text, TextInput, Pressable, FlatList, ActivityIndicator, Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { WebView } from "react-native-webview";

const BACKEND_URL = "http://192.168.1.50:8000";

type Chat = { id: string; title?: string };
type Msg = { id: string; role: "user" | "assistant"; content: string; attachments: string[]; created_at: string };
type AppItem = { id: string; name: string; icon_emoji?: string };

async function api(path: string, method: string, userId: string, body?: any) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": userId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function upload(userId: string, chatId: string | null, uri: string, name: string, mime: string) {
  const form = new FormData();
  if (chatId) form.append("chat_id", chatId);

  // React Native FormData file:
  form.append("file", {
    uri,
    name,
    type: mime,
  } as any);

  const res = await fetch(`${BACKEND_URL}/files/upload`, {
    method: "POST",
    headers: {
      "X-User-Id": userId,
      // DO NOT set Content-Type for multipart; fetch will set boundary.
    },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // {id,...}
}

export default function App() {
  const [userId, setUserId] = useState<string>("");
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<"chat" | "apps" | "run">("chat");
  const [apps, setApps] = useState<AppItem[]>([]);
  const [runUrl, setRunUrl] = useState<string>("");

  const [pendingAttachments, setPendingAttachments] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`${BACKEND_URL}/auth/anon`, { method: "POST" });
      const j = await r.json();
      setUserId(j.user_id);

      const c = await api("/chats", "POST", j.user_id, { title: "Milio Chat" });
      setChat(c);
    })().catch(console.error);
  }, []);

  async function refreshMessages() {
    if (!userId || !chat) return;
    const list = await api(`/chats/${chat.id}/messages`, "GET", userId);
    setMessages(list);
  }

  async function pickImage() {
    if (!userId || !chat) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
    if (r.canceled) return;

    const asset = r.assets[0];
    setBusy(true);
    try {
      const up = await upload(userId, chat.id, asset.uri, "image.jpg", asset.mimeType || "image/jpeg");
      setPendingAttachments((a) => [...a, { id: up.id, name: up.filename }]);
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    if (!userId || !chat) return;
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (r.canceled) return;

    const file = r.assets[0];
    setBusy(true);
    try {
      const up = await upload(userId, chat.id, file.uri, file.name, file.mimeType || "application/octet-stream");
      setPendingAttachments((a) => [...a, { id: up.id, name: up.filename }]);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!userId || !chat || !text.trim()) return;
    setBusy(true);
    try {
      const resp = await api(`/chats/${chat.id}/messages`, "POST", userId, {
        content: text,
        attachment_ids: pendingAttachments.map((a) => a.id),
      });
      setText("");
      setPendingAttachments([]);
      setMessages((m) => [...m, ...resp]);
    } catch (e: any) {
      console.error(e);
      alert(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function refreshApps() {
    const list = await api("/apps", "GET", userId);
    setApps(list);
  }

  async function createNewApp() {
    const name = "My App " + Math.floor(Math.random() * 1000);
    const app = await api("/apps", "POST", userId, { name, icon_emoji: "🧩" });
    await refreshApps();
    alert(`Created ${app.name}`);
  }

  async function generateForApp(appId: string) {
    setBusy(true);
    try {
      const prompt =
        "Build a habit tracker app with: add habit, mark done today, streak count, and a simple calendar-like view. Make it feel polished.";
      const j = await api("/apps/generate", "POST", userId, { app_id: appId, prompt });
      setRunUrl(`${BACKEND_URL}${j.run_url}`);
      setTab("run");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <View style={{ flexDirection: "row", padding: 12, gap: 10 }}>
      <Pressable onPress={() => setTab("chat")}><Text style={{ fontWeight: tab === "chat" ? "700" : "400" }}>Chat</Text></Pressable>
      <Pressable onPress={() => { setTab("apps"); refreshApps().catch(console.error); }}><Text style={{ fontWeight: tab === "apps" ? "700" : "400" }}>Apps</Text></Pressable>
      {runUrl ? <Pressable onPress={() => setTab("run")}><Text style={{ fontWeight: tab === "run" ? "700" : "400" }}>Run</Text></Pressable> : null}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {header}

      {tab === "chat" && (
        <View style={{ flex: 1, padding: 12, gap: 10 }}>
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            onRefresh={refreshMessages}
            refreshing={false}
            renderItem={({ item }) => (
              <View style={{ padding: 10, borderRadius: 12, backgroundColor: item.role === "user" ? "#222" : "#333", marginBottom: 8 }}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{item.role}</Text>
                <Text style={{ color: "#fff", marginTop: 6 }}>{item.content}</Text>
                {item.attachments?.length ? <Text style={{ color: "#bbb", marginTop: 6 }}>Attachments: {item.attachments.join(", ")}</Text> : null}
              </View>
            )}
          />

          {pendingAttachments.length ? (
            <View style={{ padding: 10, borderRadius: 12, backgroundColor: "#111" }}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Pending attachments</Text>
              {pendingAttachments.map((a) => <Text key={a.id} style={{ color: "#bbb" }}>• {a.name}</Text>)}
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={pickImage} style={{ padding: 10, backgroundColor: "#222", borderRadius: 10 }}>
              <Text style={{ color: "#fff" }}>Image</Text>
            </Pressable>
            <Pressable onPress={pickFile} style={{ padding: 10, backgroundColor: "#222", borderRadius: 10 }}>
              <Text style={{ color: "#fff" }}>File</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Message Milio..."
              placeholderTextColor="#777"
              style={{ flex: 1, borderWidth: 1, borderColor: "#333", borderRadius: 12, padding: 12, color: "#fff" }}
            />
            <Pressable onPress={send} style={{ padding: 12, backgroundColor: "#444", borderRadius: 12, justifyContent: "center" }}>
              {busy ? <ActivityIndicator /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Send</Text>}
            </Pressable>
          </View>
        </View>
      )}

      {tab === "apps" && (
        <View style={{ flex: 1, padding: 12, gap: 10 }}>
          <Pressable onPress={createNewApp} style={{ padding: 12, backgroundColor: "#222", borderRadius: 12 }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>+ New App</Text>
          </Pressable>

          <FlatList
            data={apps}
            keyExtractor={(a) => a.id}
            renderItem={({ item }) => (
              <View style={{ padding: 12, borderRadius: 12, backgroundColor: "#111", marginBottom: 10 }}>
                <Text style={{ color: "#fff", fontSize: 18 }}>{item.icon_emoji || "🧩"} {item.name}</Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                  <Pressable onPress={() => generateForApp(item.id)} style={{ padding: 10, backgroundColor: "#333", borderRadius: 10 }}>
                    <Text style={{ color: "#fff" }}>Generate</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        </View>
      )}

      {tab === "run" && (
        <View style={{ flex: 1 }}>
          <WebView
            source={{ uri: runUrl }}
            style={{ flex: 1 }}
            onMessage={(ev) => {
              try {
                const msg = JSON.parse(ev.nativeEvent.data);
                if (msg.type === "notify") alert(msg.msg);
              } catch {}
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}
