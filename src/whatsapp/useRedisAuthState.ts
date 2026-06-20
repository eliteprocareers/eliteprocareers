// ============================================================
// src/whatsapp/useRedisAuthState.ts
// A drop-in replacement for Baileys' useMultiFileAuthState,
// but backed by Redis instead of the local filesystem.
// This means the WhatsApp login session survives app restarts
// and redeploys on platforms with ephemeral disks (Render,
// Railway free tiers, etc) instead of needing a fresh QR scan
// every time the process restarts.
// ============================================================
import { createClient, RedisClientType } from "redis";
import {
  proto,
  initAuthCreds,
  BufferJSON,
  SignalDataSet,
  SignalDataTypeMap,
  SignalKeyStore,
} from "@whiskeysockets/baileys";
import { logger } from "../utils/logger";

type AuthenticationCreds = ReturnType<typeof initAuthCreds>;

let sharedClient: RedisClientType | null = null;

async function getClient(): Promise<RedisClientType> {
  if (sharedClient) return sharedClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL must be set to use Redis-backed auth state");
  }

  sharedClient = createClient({ url }) as RedisClientType;
  sharedClient.on("error", (err) => {
    logger.error({ err }, "Redis auth-state client error");
  });
  await sharedClient.connect();
  return sharedClient;
}

function authKey(tenantId: string, name: string): string {
  return `wa:auth:${tenantId}:${name}`;
}

export async function useRedisAuthState(tenantId: string) {
  const client = await getClient();

  const writeData = async (data: unknown, name: string): Promise<void> => {
    const serialized = JSON.stringify(data, BufferJSON.replacer);
    await client.set(authKey(tenantId, name), serialized);
  };

  const readData = async <T>(name: string): Promise<T | null> => {
    try {
      const raw = await client.get(authKey(tenantId, name));
      if (!raw) return null;
      return JSON.parse(raw, BufferJSON.reviver) as T;
    } catch (err) {
      logger.warn({ err, tenantId, name }, "Failed to read auth data from Redis");
      return null;
    }
  };

  const removeData = async (name: string): Promise<void> => {
    await client.del(authKey(tenantId, name));
  };

  const creds: AuthenticationCreds =
    (await readData<AuthenticationCreds>("creds")) || initAuthCreds();

  const keyStore: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(
      type: T,
      ids: string[]
    ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};
      await Promise.all(
        ids.map(async (id) => {
          let value = await readData<SignalDataTypeMap[T]>(`${type}-${id}`);
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(
              value as object
            ) as unknown as SignalDataTypeMap[T];
          }
          if (value) {
            data[id] = value;
          }
        })
      );
      return data;
    },
    set: async (data: SignalDataSet): Promise<void> => {
      const tasks: Promise<void>[] = [];
      for (const category in data) {
        const categoryData = data[category as keyof SignalDataSet];
        if (!categoryData) continue;
        for (const id in categoryData) {
          const value = categoryData[id];
          const name = `${category}-${id}`;
          tasks.push(value ? writeData(value, name) : removeData(name));
        }
      }
      await Promise.all(tasks);
    },
  };

  return {
    state: {
      creds,
      keys: keyStore,
    },
    saveCreds: async () => {
      await writeData(creds, "creds");
    },
    clearAuthState: async () => {
      const keys = await client.keys(authKey(tenantId, "*"));
      if (keys.length) {
        await client.del(keys);
      }
    },
  };
}
