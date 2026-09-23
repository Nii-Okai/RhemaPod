"use client";

import * as React from "react";
import Hls from "hls.js";

import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogSrOnly,
} from "@/components/ui/dialog";
import {
  pickPlaybackVariant,
  resolvePlaybackSource,
  useSermonStream,
  type PlaybackSource,
} from "@/lib/query/hooks/use-sermon-stream";

/* =============================================================================
   SermonPlayerDialog — the Review queue's "Watch" player (bugfix batch #11;
   HLS support added W1.8).

   Opens a modal with a real <video>/<audio> control pointed at a signed
   playback URL from `GET /sermons/{id}/stream`. The media ref carries a
   `type` ("video" | "audio"); a video rendition is preferred when both exist.

   A bare `<video src>` can't play an HLS manifest (`.m3u8`) outside Safari,
   and Cloudflare Stream playback URLs are always HLS manifests
   (`app/core/stream.py::signed_playback_url`) once a sermon has gone through
   Stream ingest. `useHlsMediaSource` below drives the media element: native
   `src` for the legacy presigned-S3 path (progressive MP4/audio) and for
   Safari's native HLS support, `hls.js` (MSE-based) everywhere else.
   `resolvePlaybackSource` (`use-sermon-stream.ts`) tells it which case it's
   in — this component never sniffs the URL itself.

   Controlled: `sermonId` non-null means open. The stream query only runs while
   the dialog is open, and the signed URL is not cached long (it expires).
   ========================================================================== */

export interface SermonPlayerDialogProps {
  /** The sermon to play, or `null` when the dialog is closed. */
  sermonId: string | null;
  title: string;
  onClose: () => void;
}

type PlaybackStrategy = "native" | "hlsjs" | "unsupported";

const UNSUPPORTED_MESSAGE =
  "This browser can't play this media. Try Chrome, Firefox, Edge, or Safari.";

/** Feature-detects how a `PlaybackSource` needs to be played:
 *
 * - `"native"` — a progressive URL (legacy presigned-S3 MP4/audio), or an
 *   HLS manifest on a browser with native HLS support (Safari/iOS,
 *   `canPlayType`). Either way, a plain `src` is enough.
 * - `"hlsjs"` — an HLS manifest everywhere else. `hls.js` demuxes it into
 *   Media Source Extensions; this is what makes the reviewer preview work
 *   in Chrome, Firefox and Edge.
 * - `"unsupported"` — an HLS manifest and neither native support nor MSE
 *   (`Hls.isSupported()`) is available.
 *
 * A detached probe element, not the mounted ref, answers `canPlayType` —
 * this only depends on the browser, not on anything React is rendering, so
 * it's pure enough to call during render instead of inside an effect. Takes
 * just the two fields it reads (not the whole `PlaybackSource`) so callers
 * can depend on those primitives directly — see `useHlsMediaSource`. */
function resolvePlaybackStrategy(
  source: Pick<PlaybackSource, "kind" | "type">,
): PlaybackStrategy {
  if (source.kind !== "hls") return "native";
  if (typeof document !== "undefined") {
    const probe = document.createElement(
      source.type === "audio" ? "audio" : "video",
    );
    if (
      typeof probe.canPlayType === "function" &&
      probe.canPlayType("application/vnd.apple.mpegurl") !== ""
    ) {
      return "native";
    }
  }
  return Hls.isSupported() ? "hlsjs" : "unsupported";
}

/** Attaches `source` to a `<video>`/`<audio>` element per
 * `resolvePlaybackStrategy`. Returns the ref to attach to the media element
 * and a playback error — either the initial "this browser can't play this"
 * verdict, or one `hls.js` reports later (distinct from `stream.isError`,
 * which covers the `GET /stream` request itself, not the media playback
 * that follows). */
function useHlsMediaSource(source: PlaybackSource) {
  const ref = React.useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const { kind, type, url } = source;
  const strategy = React.useMemo(
    () => resolvePlaybackStrategy({ kind, type }),
    [kind, type],
  );
  // No effect-driven reset here on purpose: the caller remounts this hook's
  // component (`key={source.url}`) whenever the source changes, so a fresh
  // lazy initializer is the reset — see the note on `HlsMedia` below and the
  // React docs' "resetting state with a key" pattern this follows.
  const [playbackError, setPlaybackError] = React.useState<string | null>(
    () => (strategy === "unsupported" ? UNSUPPORTED_MESSAGE : null),
  );

  React.useEffect(() => {
    const el = ref.current;
    if (!el || strategy === "unsupported") return;

    if (strategy === "native") {
      el.src = url;
      return () => {
        el.removeAttribute("src");
        el.load();
      };
    }

    const hls = new Hls();
    // A fatal error swaps the `<video>` out for an `Alert` (see the render
    // below), which unmounts the element `hls` is attached to without
    // changing this effect's deps — destroy eagerly here rather than
    // waiting on the cleanup below, guarded so the two never double-fire.
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      hls.destroy();
    };
    // setState from here is fine — it's a callback fired later, by hls.js,
    // in response to a real playback event, not a synchronous effect-body
    // call.
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        setPlaybackError("Playback failed. Try again in a moment.");
        destroy();
      }
    });
    hls.loadSource(url);
    hls.attachMedia(el);
    return destroy;
  }, [strategy, url]);

  return { ref, playbackError };
}

/** Renders the actual `<video>`/`<audio>` element for a resolved
 * `PlaybackSource`. Split out from `SermonPlayerDialog` and keyed by the
 * source (see the call site) so switching sermons — a new `source.url` —
 * remounts this component from scratch: a fresh `useState(null)` for
 * `playbackError` instead of an effect that has to reset it, per React's
 * "resetting state with a key" pattern. */
function HlsMedia({ source }: { source: PlaybackSource }) {
  const { ref, playbackError } = useHlsMediaSource(source);

  if (playbackError) {
    return (
      <Alert variant="error" title="Couldn’t play the media">
        {playbackError}
      </Alert>
    );
  }

  return source.type === "audio" ? (
    <audio
      ref={ref as React.RefObject<HTMLAudioElement | null>}
      controls
      autoPlay
      className="w-full"
      data-testid="sermon-player"
    />
  ) : (
    <video
      ref={ref as React.RefObject<HTMLVideoElement | null>}
      controls
      autoPlay
      className="aspect-video w-full rounded-10 bg-ink"
      data-testid="sermon-player"
    />
  );
}

export function SermonPlayerDialog({
  sermonId,
  title,
  onClose,
}: SermonPlayerDialogProps) {
  const open = sermonId !== null;
  const stream = useSermonStream(sermonId ?? undefined, open);
  const variant = stream.data
    ? pickPlaybackVariant(stream.data.variants)
    : null;
  const source = resolvePlaybackSource(variant);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogSrOnly>
          <DialogDescription>
            Media preview for the sermon under review.
          </DialogDescription>
        </DialogSrOnly>

        {stream.isPending ? (
          <div
            className="aspect-video w-full animate-pulse rounded-10 bg-border-subtle"
            aria-label="Loading media"
          />
        ) : stream.isError ? (
          <Alert variant="error" title="Couldn’t load the media">
            {stream.error instanceof Error
              ? stream.error.message
              : "Try again in a moment."}
          </Alert>
        ) : !source ? (
          <Alert variant="warning" title="No media to play">
            This sermon has no processed renditions yet.
          </Alert>
        ) : (
          <HlsMedia key={`${source.kind}:${source.type}:${source.url}`} source={source} />
        )}
      </DialogContent>
    </Dialog>
  );
}
