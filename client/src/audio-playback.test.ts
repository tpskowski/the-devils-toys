import { describe, expect, it } from "vitest";
import type { MediaAsset } from "@devils-toys/shared";
import {
  adjacentTrackId,
  audioTrackLabel,
  formatTrackTime,
  nextRepeatMode,
  playlistPlayCommand,
  playlistSelectCommand
} from "./audio-playback";

const tracks = [1, 2, 3].map(
  (id) =>
    ({
      id,
      roomId: 1,
      kind: "audio",
      filename: `track-${id}.mp3`,
      mimeType: "audio/mpeg",
      size: 10,
      visible: true,
      createdAt: "",
      url: ""
    }) satisfies MediaAsset
);

describe("audio playback helpers", () => {
  it("uses Artist - Title and falls back to the filename", () => {
    expect(audioTrackLabel({ ...tracks[0], artist: "Low Orbit", title: "Airlock" })).toBe("Low Orbit - Airlock");
    expect(audioTrackLabel(tracks[0])).toBe("track-1.mp3");
  });

  it("formats track times without fractional seconds", () => {
    expect(formatTrackTime(0)).toBe("0:00");
    expect(formatTrackTime(65.9)).toBe("1:05");
    expect(formatTrackTime(3661)).toBe("1:01:01");
    expect(formatTrackTime(Number.NaN)).toBe("0:00");
  });

  it("cycles repeat modes and moves through the queue", () => {
    expect(nextRepeatMode("off")).toBe("all");
    expect(nextRepeatMode("all")).toBe("one");
    expect(nextRepeatMode("one")).toBe("off");
    expect(adjacentTrackId(tracks, 3, { wrap: false })).toBeNull();
    expect(adjacentTrackId(tracks, 3, { wrap: true })).toBe(1);
    expect(adjacentTrackId(tracks, 1, { direction: -1, wrap: true })).toBe(3);
  });

  it("selects another track in shuffle mode", () => {
    expect(adjacentTrackId(tracks, 1, { shuffle: true, random: () => 0 })).toBe(2);
    expect(adjacentTrackId(tracks, 1, { shuffle: true, random: () => 0.99 })).toBe(3);
  });
});

describe("choosing a track in the playlist", () => {
  it("keeps playing when the room was playing", () => {
    expect(playlistSelectCommand({ trackId: 1, playing: true, position: 42 }, 2)).toEqual({
      trackId: 2,
      playing: true,
      position: 0
    });
  });

  it("stays silent when the room was not playing", () => {
    expect(playlistSelectCommand({ trackId: 1, playing: false, position: 42 }, 2)).toEqual({
      trackId: 2,
      playing: false,
      position: 0
    });
  });
});

describe("the playlist play control", () => {
  it("starts another track from the top even while the room is silent", () => {
    expect(playlistPlayCommand({ trackId: 1, playing: false, position: 42 }, 2, 42)).toEqual({
      trackId: 2,
      playing: true,
      position: 0
    });
  });

  it("starts another track from the top while a different one is playing", () => {
    expect(playlistPlayCommand({ trackId: 1, playing: true, position: 42 }, 2, 42)).toEqual({
      trackId: 2,
      playing: true,
      position: 0
    });
  });

  it("resumes the paused active track where it stopped", () => {
    expect(playlistPlayCommand({ trackId: 1, playing: false, position: 30 }, 1, 30.4)).toEqual({
      trackId: 1,
      playing: true,
      position: 30.4
    });
  });

  it("pauses the active track at its live position rather than the last command", () => {
    expect(playlistPlayCommand({ trackId: 1, playing: true, position: 0 }, 1, 71.5)).toEqual({
      trackId: 1,
      playing: false,
      position: 71.5
    });
  });

  it("never sends a negative position", () => {
    expect(playlistPlayCommand({ trackId: 1, playing: true, position: 0 }, 1, -3).position).toBe(0);
  });
});
