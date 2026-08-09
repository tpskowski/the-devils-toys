import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import { parse } from "cookie";
import { WebSocketServer, WebSocket } from "ws";
import type { AuthAccount } from "./auth.js";
import { accountForSession, roomRole } from "./auth.js";
import { all } from "./db.js";
import { inGameDisplayName, roomDisplayName } from "./display-name.js";
import { logger } from "./logger.js";
import { roomConfigAccess } from "./room-config-permissions.js";

interface Client {
  socket: WebSocket;
  account: AuthAccount;
  accountId: number;
  username: string;
  roomId?: number;
  /**
   * A room this connection watches without being in: Room Config, open in its
   * own tab. Set instead of `roomId`, never alongside it, so a panel never puts
   * anyone in a room's presence — including the GM, who may have the panel open
   * long after leaving the table.
   */
  watchingRoomId?: number;
}

const clients = new Set<Client>();
let presenceNoticeId = -1;
let scenePingId = 1;

function send(client: Client, event: unknown) {
  if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(event));
}

/**
 * What a watching connection is sent: the coarse "something changed, refetch"
 * events, and nothing else. Chat, rolls, pings, and presence belong to the
 * people at the table, and an admin configuring a room is not one of them.
 */
function watcherMayReceive(event: unknown) {
  const type = (event as { type?: unknown } | null | undefined)?.type;
  return typeof type === "string" && type.endsWith("-updated");
}

function roomMembers(roomId: number) {
  const rows = all<{
    account_id: number;
    username: string;
    character_name: string | null;
    active_character_id: number | null;
    role: "gm" | "player";
  }>(
    `SELECT m.account_id, a.username, c.name AS character_name, m.active_character_id, m.role FROM memberships m
     JOIN accounts a ON a.id = m.account_id
     LEFT JOIN characters c ON c.id = m.active_character_id
     WHERE m.room_id = ? ORDER BY m.role, a.username`,
    roomId
  );
  return rows.map((row) => ({
    accountId: row.account_id,
    username: row.username,
    displayName: inGameDisplayName(row.username, row.character_name),
    activeCharacterId: row.active_character_id,
    role: row.role,
    online: [...clients].some((client) => client.roomId === roomId && client.accountId === row.account_id)
  }));
}

function publishPresence(roomId: number) {
  const members = roomMembers(roomId);
  for (const client of clients) {
    if (client.roomId !== roomId) continue;
    const viewerRole = roomRole(client.accountId, roomId);
    const visible = viewerRole === "gm" ? members : members.filter((member) => member.role === "player");
    send(client, { type: "presence", members: visible });
  }
}

function publishPresenceNotice(roomId: number, accountId: number, username: string, online: boolean) {
  const displayName = roomDisplayName(roomId, accountId, username);
  const createdAt = new Date().toISOString().replace("T", " ").slice(0, 19);
  const message = {
    id: presenceNoticeId--,
    roomId,
    accountId,
    username,
    displayName,
    kind: "system",
    body: `${displayName} ${online ? "joined" : "left"} the room.`,
    createdAt
  };
  for (const viewer of clients) {
    if (viewer.roomId === roomId && viewer.accountId !== accountId && roomRole(viewer.accountId, roomId) === "gm")
      send(viewer, { type: "presence-notice", message });
  }
}

function hasOtherRoomConnection(roomId: number, accountId: number, excluded: Client) {
  return [...clients].some(
    (client) => client !== excluded && client.roomId === roomId && client.accountId === accountId
  );
}

export function broadcastRoom(roomId: number, event: unknown) {
  for (const client of clients) {
    if (client.roomId === roomId) send(client, event);
    else if (client.watchingRoomId === roomId && watcherMayReceive(event)) send(client, event);
  }
}

/**
 * Sends an event to the room's GMs alone. A player's private roll is between
 * them and the GM, so it reaches nobody else at the table.
 */
export function sendToRoomGms(roomId: number, event: unknown) {
  for (const client of clients)
    if (client.roomId === roomId && roomRole(client.accountId, roomId) === "gm") send(client, event);
}

/** Sends an event to players without exposing it to the room's GMs. */
export function sendToRoomPlayers(roomId: number, event: unknown) {
  for (const client of clients)
    if (client.roomId === roomId && roomRole(client.accountId, roomId) === "player") send(client, event);
}

export function refreshRoomPresence(roomId: number) {
  publishPresence(roomId);
}

export function disconnectAccount(accountId: number) {
  for (const client of clients) if (client.accountId === accountId) client.socket.close(4001, "Session revoked");
}

export function refreshRoomAccess(roomId: number) {
  for (const client of clients) {
    if (client.watchingRoomId === roomId && !roomConfigAccess(client.account, roomId)) {
      send(client, { type: "room-access-removed", roomId });
      client.watchingRoomId = undefined;
      continue;
    }
    if (client.roomId !== roomId) continue;
    if (!roomRole(client.accountId, roomId)) {
      send(client, { type: "room-access-removed", roomId });
      client.roomId = undefined;
    } else {
      send(client, { type: "room-updated" });
    }
  }
  publishPresence(roomId);
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://local").pathname !== "/ws") return socket.destroy();
    const cookies = parse(request.headers.cookie ?? "");
    const account = accountForSession(cookies.devils_session);
    if (!account) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request, account));
  });

  wss.on("connection", (socket: WebSocket, _request: IncomingMessage, account: AuthAccount) => {
    const client: Client = { socket, account, accountId: account.id, username: account.username };
    clients.add(client);
    send(client, { type: "ready" });

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; roomId?: number };
        if (message.type === "scene-ping") {
          const { x, y } = message as typeof message & { x?: number; y?: number };
          if (!client.roomId || !Number.isFinite(x) || !Number.isFinite(y) || x! < 0 || x! > 1 || y! < 0 || y! > 1)
            return;
          broadcastRoom(client.roomId, {
            type: "scene-ping",
            ping: {
              id: scenePingId++,
              x,
              y,
              username: account.username,
              displayName: roomDisplayName(client.roomId, account.id, account.username)
            }
          });
          return;
        }

        // Room Config watches a room rather than joining it, so the panel can
        // follow edits made at the table without anyone appearing to be there.
        if (message.type === "watch") {
          // A connection is either at the table or watching from the panel. They
          // are separate tabs and so separate sockets; refusing the mixture is
          // what keeps "watching never touches presence" true.
          if (client.roomId !== undefined) return;
          if (!Number.isInteger(message.roomId) || !roomConfigAccess(account, message.roomId!)) return;
          client.watchingRoomId = Number(message.roomId);
          return;
        }

        if (
          message.type !== "join" ||
          client.watchingRoomId !== undefined ||
          !Number.isInteger(message.roomId) ||
          !roomRole(account.id, message.roomId!)
        )
          return;
        const roomId = Number(message.roomId);
        const previous = client.roomId;
        if (previous === roomId) return;
        client.roomId = roomId;
        if (previous) {
          if (!hasOtherRoomConnection(previous, account.id, client))
            publishPresenceNotice(previous, account.id, account.username, false);
          publishPresence(previous);
        }
        if (!hasOtherRoomConnection(roomId, account.id, client))
          publishPresenceNotice(roomId, account.id, account.username, true);
        publishPresence(roomId);
      } catch (error) {
        logger.warn("Ignored invalid WebSocket message", { error: String(error) });
      }
    });

    socket.on("close", () => {
      const roomId = client.roomId;
      clients.delete(client);
      if (roomId) {
        if (!hasOtherRoomConnection(roomId, account.id, client))
          publishPresenceNotice(roomId, account.id, account.username, false);
        publishPresence(roomId);
      }
    });
  });
}
