import express from "express";
import { groupAssetDefinitions, type RoomConfigPayload, type RoomConfigSection } from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { readCalendar } from "./calendar.js";
import { one } from "./db.js";
import { configurableRoom, configurableRooms, requireRoomConfig } from "./room-config-permissions.js";
import { systemOrThrow } from "./systems.js";
import type { ConfigurableRoom } from "./room-config-permissions.js";

/**
 * Room Config: the GM control panel served at `/config` in the game client's own
 * bundle. This router carries what the panel needs before it can draw anything —
 * which rooms are reachable, and which sections one of them has — and nothing
 * else. Each section's own routes stay with the domain that owns them, behind
 * `requireRoomConfig` where the panel needs an admin non-member to reach them.
 */
export const roomConfigRouter = express.Router();

/**
 * Which sections a room has, and which of them it has switched off.
 *
 * A section the room's **system** does not have — hirelings in a system with no
 * hireling sheet — is left out entirely, because there is nothing a GM could do
 * to gain it. A section the **room** has switched off is listed and marked, so
 * the panel can offer the switch: that is where someone would go looking for it.
 */
export function sectionsFor(room: ConfigurableRoom): RoomConfigSection[] {
  const groupPage = systemOrThrow(room.system).groupPage;
  const sections: RoomConfigSection[] = [
    { id: "library", label: "Library", hint: "Maps, scenes, and references", enabled: true },
    { id: "npcs", label: "NPCs", hint: "The room's cast and the bestiary", enabled: true },
    { id: "items", label: "Items & weapons", hint: "This room's additions to the catalogue", enabled: true },
    {
      id: "calendar",
      label: "Calendar",
      hint: "Months, days, and recurring events",
      enabled: room.calendarEnabled,
      enabledBy: "calendarEnabled"
    },
    {
      id: "playlists",
      label: "Playlists",
      hint: "The room's music, and the orders it plays in",
      enabled: room.musicEnabled,
      enabledBy: "musicEnabled"
    }
  ];
  if (groupPage?.hirelings)
    sections.push({
      id: "hirelings",
      label: groupPage.hirelings.label,
      hint: `The party's ${groupPage.hirelings.label.toLocaleLowerCase()}`,
      enabled: true
    });
  // Driven by what the system declares rather than by a list of asset kinds
  // written in here, so a system that gains a stronghold needs no change to this.
  const assets = groupAssetDefinitions(groupPage);
  if (assets.length)
    sections.push({
      id: "assets",
      label: assets.length === 1 ? assets[0].label : "Group assets",
      hint: `The party's shared ${assets.map((asset) => asset.singularLabel.toLocaleLowerCase()).join(" and ")}`,
      enabled: true
    });
  return sections;
}

roomConfigRouter.get("/room-config/rooms", requireAuth, (req: AuthedRequest, res) => {
  if (req.account!.role === "player")
    return res.status(403).json({ error: "Room configuration is reserved for GMs and admins." });
  res.json({ rooms: configurableRooms(req.account!), viewerIsAdmin: req.account!.isAdmin });
});

roomConfigRouter.get("/room-config/:roomId", requireAuth, (req: AuthedRequest, res) => {
  const roomId = requireRoomConfig(req, res);
  if (!roomId) return;
  const room = configurableRoom(req.account!, roomId)!;
  const definition = systemOrThrow(room.system);
  const payload: RoomConfigPayload = {
    room,
    system: {
      id: definition.id,
      name: definition.name,
      shortName: definition.shortName,
      glyph: definition.glyph,
      partyLabel: definition.partyLabel,
      npcStatblock: definition.npcStatblock
    },
    sections: sectionsFor(room),
    calendar: readCalendar(
      one<{ calendar_json: string | null }>("SELECT calendar_json FROM rooms WHERE id = ?", roomId)!.calendar_json
    )
  };
  res.json(payload);
});
