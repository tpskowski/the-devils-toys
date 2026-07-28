import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ChevronDown,
  ChevronUp,
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import type { AudioPlaybackState, MediaAsset, RoomAudioState } from "@devils-toys/shared";
import { api } from "./api";
import {
  adjacentTrackId,
  audioTrackLabel,
  formatTrackTime,
  nextRepeatMode,
  playlistPlayCommand,
  playlistSelectCommand,
  type PlaybackSnapshot
} from "./audio-playback";

type PlaybackCommand = Omit<AudioPlaybackState, "updatedAt">;

function playbackCommand(playback: AudioPlaybackState, changes: Partial<PlaybackCommand>): PlaybackCommand {
  return {
    trackId: playback.trackId,
    playing: playback.playing,
    position: playback.position,
    repeat: playback.repeat,
    shuffle: playback.shuffle,
    ...changes
  };
}

function OverflowMarquee({ text, className = "" }: { text: string; className?: string }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const measure = () => {
      const viewportElement = viewport.current;
      const copyElement = copy.current;
      setOverflowing(Boolean(viewportElement && copyElement && copyElement.scrollWidth > viewportElement.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (copy.current) observer.observe(copy.current);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      ref={viewport}
      className={`audio-marquee ${overflowing ? "audio-marquee-overflow" : ""} ${className}`.trim()}
      title={overflowing ? text : undefined}
    >
      <span className="audio-marquee-track">
        <span ref={copy} className="audio-marquee-copy">
          {text}
        </span>
        {overflowing && (
          <span className="audio-marquee-copy" aria-hidden="true">
            {text}
          </span>
        )}
      </span>
    </span>
  );
}

export function AudioDock({
  audio,
  isGm,
  onPlayback,
  onOpen,
  onPosition
}: {
  audio: RoomAudioState;
  isGm: boolean;
  onPlayback: (state: PlaybackCommand) => Promise<void>;
  onOpen: () => void;
  onPosition?: (seconds: number) => void;
}) {
  const player = useRef<HTMLAudioElement>(null);
  const [volume, setVolume] = useState(0.65);
  const [muted, setMuted] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(audio.playback.position);
  const [duration, setDuration] = useState(0);
  const track = audio.tracks.find((item) => item.id === audio.playback.trackId);
  const label = track ? audioTrackLabel(track) : isGm ? "Choose shared audio" : "No shared audio";
  const artist = track?.artist?.trim() || (track ? "Unknown artist" : "Shared audio");
  const title = track?.title?.trim() || track?.filename || label;

  // The playlist issues commands for the track this element is playing, so it
  // needs the live position rather than the position of the last command.
  function reportPosition(seconds: number) {
    setPosition(seconds);
    onPosition?.(seconds);
  }

  useEffect(() => {
    reportPosition(audio.playback.position);
    setDuration(0);
  }, [track?.id]);

  useEffect(() => {
    const element = player.current;
    if (!element || !track) return;
    if (Math.abs(element.currentTime - audio.playback.position) > 1.5) element.currentTime = audio.playback.position;
    reportPosition(element.currentTime);
    if (audio.playback.playing) element.play().catch(() => {});
    else element.pause();
  }, [track?.id, audio.playback.playing, audio.playback.position, audio.playback.updatedAt]);

  useEffect(() => {
    if (player.current) {
      player.current.volume = volume;
      player.current.muted = muted;
    }
  }, [volume, muted]);

  // Every command carries the position the audio is actually at, so changing a
  // setting such as repeat or shuffle cannot seek the room back to where the
  // last command left it.
  function liveCommand(changes: Partial<PlaybackCommand>): PlaybackCommand {
    return playbackCommand(audio.playback, {
      position: player.current?.currentTime ?? audio.playback.position,
      ...changes
    });
  }

  async function toggle() {
    if (!track) return onOpen();
    if (!isGm) {
      if (audio.playback.playing) await player.current?.play().catch(() => {});
      return;
    }
    await onPlayback(liveCommand({ trackId: track.id, playing: !audio.playback.playing }));
  }

  async function changeTrack(direction: -1 | 1, automatic = false) {
    if (!isGm || !track) return;
    if (!automatic && direction === -1 && (player.current?.currentTime ?? 0) > 3) {
      await onPlayback(liveCommand({ position: 0 }));
      return;
    }
    if (automatic && audio.playback.repeat === "one") {
      await onPlayback(liveCommand({ playing: true, position: 0 }));
      return;
    }
    const nextId = adjacentTrackId(audio.tracks, track.id, {
      direction,
      shuffle: audio.playback.shuffle,
      wrap: automatic ? audio.playback.repeat === "all" : true
    });
    if (nextId === null) {
      await onPlayback(liveCommand({ playing: false, position: 0 }));
      return;
    }
    await onPlayback(liveCommand({ trackId: nextId, playing: automatic || audio.playback.playing, position: 0 }));
  }

  return (
    <div className={`audio-dock ${isGm ? "audio-dock-gm" : ""} ${minimized ? "audio-dock-minimized" : ""}`}>
      <audio
        ref={player}
        src={track?.url}
        onLoadedMetadata={(event) => {
          if (Math.abs(event.currentTarget.currentTime - audio.playback.position) > 1.5)
            event.currentTarget.currentTime = audio.playback.position;
          reportPosition(event.currentTarget.currentTime);
          setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
        }}
        onTimeUpdate={(event) => reportPosition(event.currentTarget.currentTime)}
        onDurationChange={(event) =>
          setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)
        }
        onEnded={() => isGm && changeTrack(1, true)}
      />
      <button className="audio-restore" onClick={() => setMinimized(false)} aria-label="Expand now playing">
        <Music />
        <span>
          <strong>
            <OverflowMarquee text={label} />
          </strong>
          <small>Now playing</small>
        </span>
        <ChevronUp />
      </button>
      <button
        className="audio-metadata"
        onClick={onOpen}
        aria-label={`Open playlist. ${artist}, ${title}, ${formatTrackTime(position)} of ${formatTrackTime(duration)}`}
      >
        <span className="audio-meta-artist">
          <OverflowMarquee text={artist} />
        </span>
        <span className="audio-meta-divider" aria-hidden="true">
          |
        </span>
        <span className="audio-meta-title">
          <OverflowMarquee text={title} />
        </span>
        <span className="audio-time" aria-hidden="true">
          {formatTrackTime(position)} / {formatTrackTime(duration)}
        </span>
      </button>
      {isGm && (
        <button className="audio-previous" onClick={() => changeTrack(-1)} aria-label="Previous track">
          <SkipBack />
        </button>
      )}
      <button
        className="audio-main"
        onClick={toggle}
        disabled={!isGm && !audio.playback.playing}
        aria-label={audio.playback.playing ? "Pause shared audio" : "Play shared audio"}
      >
        {audio.playback.playing ? <Pause /> : <Play />}
      </button>
      {isGm && (
        <button className="audio-next" onClick={() => changeTrack(1)} aria-label="Next track">
          <SkipForward />
        </button>
      )}
      <button className="audio-track" onClick={onOpen}>
        <span>{label}</span>
        <small>{isGm ? "GM-controlled playback" : "Shared by the GM"}</small>
      </button>
      {isGm && (
        <>
          <button
            className={`audio-repeat ${audio.playback.repeat !== "off" ? "active" : ""}`}
            onClick={() => onPlayback(liveCommand({ repeat: nextRepeatMode(audio.playback.repeat) }))}
            aria-label={`Repeat ${audio.playback.repeat}; click to change`}
            title={`Repeat: ${audio.playback.repeat}`}
          >
            {audio.playback.repeat === "one" ? <Repeat1 /> : <Repeat />}
          </button>
          <button
            className={`audio-shuffle ${audio.playback.shuffle ? "active" : ""}`}
            onClick={() => onPlayback(liveCommand({ shuffle: !audio.playback.shuffle }))}
            aria-label={`${audio.playback.shuffle ? "Disable" : "Enable"} shuffle`}
            title={`Shuffle: ${audio.playback.shuffle ? "on" : "off"}`}
          >
            <Shuffle />
          </button>
        </>
      )}
      <button
        className="audio-mute"
        onClick={() => setMuted((current) => !current)}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </button>
      <input
        className="audio-volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={volume}
        onChange={(event) => setVolume(Number(event.target.value))}
        aria-label="Local volume"
      />
      <button className="audio-list" onClick={onOpen} aria-label="Open playlist">
        <ListMusic />
      </button>
      <button className="audio-collapse" onClick={() => setMinimized(true)} aria-label="Minimize now playing">
        <ChevronDown />
      </button>
    </div>
  );
}

export function AudioModal({
  roomId,
  audio,
  isGm,
  onChanged,
  onPlayback,
  onClose,
  livePosition
}: {
  roomId: number;
  audio: RoomAudioState;
  isGm: boolean;
  onChanged: () => Promise<void>;
  onPlayback: (state: PlaybackCommand) => Promise<void>;
  onClose: () => void;
  livePosition?: () => number;
}) {
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>();
  const busy = Boolean(uploadProgress);
  const [error, setError] = useState("");

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    setError("");
    const failures: string[] = [];
    let uploaded = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadProgress({ current: index + 1, total: files.length });
        const body = new FormData();
        body.append("file", file);
        try {
          await api(`/api/rooms/${roomId}/audio`, { method: "POST", body });
          uploaded += 1;
        } catch (cause) {
          failures.push(`${file.name}: ${(cause as Error).message}`);
        }
      }
      if (uploaded) await onChanged();
      if (failures.length) setError(failures.join(" "));
    } finally {
      setUploadProgress(undefined);
      input.value = "";
    }
  }

  async function command(changes: PlaybackSnapshot) {
    if (!isGm) return;
    await onPlayback(playbackCommand(audio.playback, changes));
    await onChanged();
  }

  async function remove(track: MediaAsset) {
    if (!confirm(`Permanently delete “${audioTrackLabel(track)}”?`)) return;
    await api(`/api/rooms/${roomId}/audio/${track.id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal audio-modal" role="dialog" aria-modal="true" aria-label="Shared audio">
        <header>
          <p className="eyebrow">Room soundtrack</p>
          <h2>Shared audio</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        {isGm && (
          <label className="audio-upload">
            <Upload />
            <span>
              <strong>
                {uploadProgress ? `Uploading ${uploadProgress.current} of ${uploadProgress.total}…` : "Add MP3s"}
              </strong>
              <small>Select one or more files, up to 50 MB each</small>
            </span>
            <input type="file" accept="audio/mpeg,.mp3" multiple onChange={upload} disabled={busy} hidden />
          </label>
        )}
        {error && <p className="form-error audio-error">{error}</p>}
        <div className="audio-playlist">
          {!audio.tracks.length && (
            <div className="audio-empty">
              <Music />
              <p>No tracks have been added.</p>
            </div>
          )}
          {audio.tracks.map((track) => {
            const active = audio.playback.trackId === track.id;
            const sounding = active && audio.playback.playing;
            return (
              <article key={track.id} className={active ? "active" : ""}>
                <button
                  className="audio-track-play"
                  onClick={() =>
                    command(
                      playlistPlayCommand(
                        audio.playback,
                        track.id,
                        livePosition?.() ?? (active ? audio.playback.position : 0)
                      )
                    )
                  }
                  disabled={!isGm}
                  aria-label={`${sounding ? "Pause" : "Play"} ${audioTrackLabel(track)}`}
                  title={sounding ? "Pause" : "Play this track"}
                >
                  {sounding ? <Pause /> : <Play />}
                </button>
                <button
                  className="audio-track-select"
                  onClick={() => command(playlistSelectCommand(audio.playback, track.id))}
                  disabled={!isGm}
                  aria-label={`Switch the room to ${audioTrackLabel(track)}`}
                >
                  <span>
                    <strong>{audioTrackLabel(track)}</strong>
                    <small>{Math.max(1, Math.round(track.size / 1024 / 1024))} MB</small>
                  </span>
                </button>
                {isGm && (
                  <button
                    className="audio-delete"
                    onClick={() => remove(track)}
                    aria-label={`Delete ${audioTrackLabel(track)}`}
                  >
                    <Trash2 />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
