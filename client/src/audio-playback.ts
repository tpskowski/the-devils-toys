import type { AudioRepeatMode, MediaAsset } from "@devils-toys/shared";

export function formatTrackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function audioTrackLabel(track: MediaAsset) {
  const artist = track.artist?.trim();
  const title = track.title?.trim();
  if (artist && title) return `${artist} - ${title}`;
  if (title) return title;
  return track.filename;
}

export function nextRepeatMode(mode: AudioRepeatMode): AudioRepeatMode {
  if (mode === "off") return "all";
  if (mode === "all") return "one";
  return "off";
}

export interface PlaybackSnapshot {
  trackId: number | null;
  playing: boolean;
  position: number;
}

/**
 * Choosing a track in the playlist moves the room to it without starting or
 * stopping anything: a silent room stays silent, a playing room keeps playing.
 */
export function playlistSelectCommand(playback: PlaybackSnapshot, trackId: number): PlaybackSnapshot {
  return { trackId, playing: playback.playing, position: 0 };
}

/**
 * The playlist's own play control always starts the track it belongs to, and
 * pauses only when that track is the one already playing. Both cases keep the
 * live position so returning to a track resumes where it was left; a different
 * track starts at the top.
 */
export function playlistPlayCommand(
  playback: PlaybackSnapshot,
  trackId: number,
  livePosition: number
): PlaybackSnapshot {
  const active = playback.trackId === trackId;
  if (active && playback.playing) return { trackId, playing: false, position: Math.max(0, livePosition) };
  return { trackId, playing: true, position: active ? Math.max(0, livePosition) : 0 };
}

export function adjacentTrackId(
  tracks: MediaAsset[],
  currentId: number | null,
  options: {
    direction?: -1 | 1;
    shuffle?: boolean;
    wrap?: boolean;
    random?: () => number;
  } = {}
) {
  if (!tracks.length) return null;
  const currentIndex = tracks.findIndex((track) => track.id === currentId);
  if (options.shuffle && tracks.length > 1) {
    const random = options.random ?? Math.random;
    const offset = 1 + Math.floor(random() * (tracks.length - 1));
    return tracks[(((Math.max(currentIndex, 0) + offset) % tracks.length) + tracks.length) % tracks.length].id;
  }
  if (currentIndex < 0) return options.direction === -1 ? tracks[tracks.length - 1].id : tracks[0].id;
  const nextIndex = currentIndex + (options.direction ?? 1);
  if (nextIndex >= 0 && nextIndex < tracks.length) return tracks[nextIndex].id;
  if (!options.wrap) return null;
  return nextIndex < 0 ? tracks[tracks.length - 1].id : tracks[0].id;
}
