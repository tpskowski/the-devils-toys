import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
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
import { playlistTracks } from "@devils-toys/shared";
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
    playlistId: playback.playlistId,
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

/** How many bars the visualizer draws, and how many bins each one averages. */
const VISUALIZER_BARS = 9;

/**
 * The element's sound, on its way out through an analyser. Held by the dock
 * rather than by the visualizer: an element may only be handed to a graph once,
 * and the visualizer comes and goes as the browser starts and stops.
 */
interface AudioGraph {
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  /** The bins each bar averages, low to high. */
  bands: [number, number][];
}

/**
 * Which part of the spectrum each bar answers for, spaced by ear rather than by
 * arithmetic: an even split of the analyser's bins gives eight bars of the range
 * above 10 kHz, where recorded music has nothing, and one bar carrying every
 * note anyone is playing. Doubling in width as they climb puts a bass drum and a
 * cymbal at opposite ends of the row instead of both in the first bar.
 */
function visualizerBands(analyser: AnalyserNode, sampleRate: number): [number, number][] {
  const perBin = sampleRate / analyser.fftSize;
  const [low, high] = [60, 10_000];
  return Array.from({ length: VISUALIZER_BARS }, (_, index) => {
    const edge = (step: number) => Math.round((low * (high / low) ** (step / VISUALIZER_BARS)) / perBin);
    const start = Math.min(edge(index), analyser.frequencyBinCount - 1);
    return [start, Math.max(start + 1, Math.min(edge(index + 1), analyser.frequencyBinCount))];
  });
}

/**
 * The bars a player watches instead of the transport they cannot work.
 *
 * They move with the sound where the browser will let them and keep their own
 * time where it will not, because the point of them is to say the room is
 * playing — a widget that shows nothing on a browser that withholds an analyser
 * would say the opposite.
 *
 * The graph is only ever built against a context that is already **running**.
 * Routing the element through a suspended one takes its sound and plays none of
 * it, and a silent room is a far worse trade than bars that guess.
 */
function AudioVisualizer({
  player,
  graph,
  active
}: {
  player: RefObject<HTMLAudioElement | null>;
  graph: RefObject<AudioGraph | null>;
  active: boolean;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!active) return;
    const element = player.current;
    // Movement is the whole of this, so someone who has asked for less of it
    // gets the resting bars and no audio graph at all.
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let stopped = false;
    let frame = 0;

    async function begin() {
      if (!graph.current) {
        const Context =
          window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context || !element) return;
        try {
          const context = new Context();
          await context.resume();
          if (context.state !== "running") return void context.close();
          // Once made, this is the element's only way out, which is why it is
          // made once and kept: a second call on the same element throws.
          const source = context.createMediaElementSource(element);
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.72;
          // The default ceiling of -30 dB is met by anything mastered in the
          // last thirty years, which pins every bar to the top and draws a
          // block. Rooms above it leave the loud parts somewhere to go.
          analyser.minDecibels = -82;
          analyser.maxDecibels = -14;
          source.connect(analyser);
          analyser.connect(context.destination);
          graph.current = {
            analyser,
            data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
            bands: visualizerBands(analyser, context.sampleRate)
          };
        } catch {
          return;
        }
      }
      if (stopped) return;
      const { analyser, data, bands } = graph.current;
      setReading(true);
      const draw = () => {
        analyser.getByteFrequencyData(data);
        bars.current.forEach((bar, index) => {
          const [start, end] = bands[index];
          let total = 0;
          for (let bin = start; bin < end; bin += 1) total += data[bin] ?? 0;
          // A recording carries less and less energy the higher the band, so
          // each one is lifted a little more than the one below it. Without that
          // the right-hand bars never leave the floor on anything but a cymbal.
          const level = ((total / (end - start)) * (1 + index * 0.1)) / 255;
          bar?.style.setProperty("--level", String(Math.min(1, Math.max(0.14, level))));
        });
        frame = requestAnimationFrame(draw);
      };
      draw();
    }

    begin();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      setReading(false);
      for (const bar of bars.current) bar?.style.removeProperty("--level");
    };
  }, [active, player, graph]);

  return (
    <div
      className={`audio-visualizer ${active ? (reading ? "is-reading" : "is-guessing") : ""}`.trim()}
      aria-hidden="true"
    >
      {Array.from({ length: VISUALIZER_BARS }, (_, index) => (
        <span
          key={index}
          ref={(node) => {
            bars.current[index] = node;
          }}
        />
      ))}
    </div>
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
  // What this browser is doing, which is not always what the room asked for: a
  // browser that has had no gesture yet refuses to start. The player's half of
  // the dock is drawn from this rather than from the room's state, so it can
  // offer the tap that fixes it.
  const [sounding, setSounding] = useState(false);
  const graph = useRef<AudioGraph | null>(null);
  const playing = playlistTracks(audio.tracks, audio.playlists, audio.playback.playlistId);
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
    // Advance through the chosen playlist rather than the whole library, so
    // "the combat music" is a running order and not just a filter.
    const nextId = adjacentTrackId(playing, track.id, {
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
        onPlay={() => setSounding(true)}
        onPause={() => setSounding(false)}
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
      {isGm ? (
        <>
          <button className="audio-previous" onClick={() => changeTrack(-1)} aria-label="Previous track">
            <SkipBack />
          </button>
          <button
            className="audio-main"
            onClick={toggle}
            aria-label={audio.playback.playing ? "Pause shared audio" : "Play shared audio"}
          >
            {audio.playback.playing ? <Pause /> : <Play />}
          </button>
          <button className="audio-next" onClick={() => changeTrack(1)} aria-label="Next track">
            <SkipForward />
          </button>
          <button className="audio-track" onClick={onOpen}>
            <span>{label}</span>
            <small>GM-controlled playback</small>
          </button>
        </>
      ) : audio.playback.playing && !sounding ? (
        // The one command a player has ever had here. A browser will not start
        // sound it was not asked for, so this is the asking — and it is only on
        // screen while the room is playing something this browser is not.
        <button className="audio-start" onClick={toggle}>
          <Play />
          <span>Tap to listen</span>
        </button>
      ) : (
        <AudioVisualizer player={player} graph={graph} active={audio.playback.playing && sounding} />
      )}
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
  const shown = playlistTracks(audio.tracks, audio.playlists, audio.playback.playlistId);
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

  async function command(changes: Partial<PlaybackCommand>) {
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
        {audio.playlists.length > 0 && (
          <label className="audio-playlist-picker">
            <span>Playing through</span>
            <select
              value={audio.playback.playlistId ?? ""}
              disabled={!isGm}
              onChange={(event) =>
                // Changing the running order stops what is playing rather than
                // carrying a track out of one list into another.
                command({
                  playlistId: event.target.value ? Number(event.target.value) : null,
                  trackId: null,
                  playing: false,
                  position: 0
                })
              }
            >
              <option value="">Everything in the room</option>
              {audio.playlists.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.trackIds.length})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="audio-playlist">
          {!shown.length && (
            <div className="audio-empty">
              <Music />
              <p>{audio.tracks.length ? "That playlist has no tracks yet." : "No tracks have been added."}</p>
            </div>
          )}
          {shown.map((track) => {
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
