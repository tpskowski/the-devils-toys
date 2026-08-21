import { describe, expect, it } from "vitest";
import {
  canAssignRoomGm,
  canCreateRoomForAnother,
  canDeleteRoom,
  canHoldRoomGm,
  canManageRooms
} from "./room-management-permissions.js";

describe("who manages a room", () => {
  it("keeps every part of it away from a player account", () => {
    expect(canManageRooms("player")).toBe(false);
    expect(canCreateRoomForAnother("player")).toBe(false);
    expect(canAssignRoomGm("player")).toBe(false);
    expect(canDeleteRoom("player")).toBe(false);
  });

  it("lets a GM make rooms but not make them for somebody else, hand them over, or delete them", () => {
    expect(canManageRooms("gm")).toBe(true);
    expect(canCreateRoomForAnother("gm")).toBe(false);
    expect(canAssignRoomGm("gm")).toBe(false);
    expect(canDeleteRoom("gm")).toBe(false);
  });

  it("gives an admin all four", () => {
    expect(canManageRooms("admin")).toBe(true);
    expect(canCreateRoomForAnother("admin")).toBe(true);
    expect(canAssignRoomGm("admin")).toBe(true);
    expect(canDeleteRoom("admin")).toBe(true);
  });

  it("seats a GM or an admin in the GM chair, and never a player account", () => {
    expect(canHoldRoomGm("gm")).toBe(true);
    expect(canHoldRoomGm("admin")).toBe(true);
    expect(canHoldRoomGm("player")).toBe(false);
  });
});
