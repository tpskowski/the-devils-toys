import { projectFile } from "./paths.js";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  /** The Devil's Tables, which runs on its own port against the same database. */
  tablesPort: Number(process.env.DEVILS_TABLES_PORT ?? 4100),
  /**
   * Where a browser can reach The Devil's Tables, for the link in the game's
   * rail. Set this when a reverse proxy puts it somewhere other than this host
   * on `tablesPort`; otherwise the client works it out for itself.
   */
  tablesUrl: process.env.DEVILS_TABLES_URL ?? "",
  dataDir: projectFile(process.env.DEVILS_TOYS_DATA_DIR ?? ".data"),
  uploadLimitMb: Number(process.env.DEVILS_TOYS_UPLOAD_LIMIT_MB ?? 1024),
  sceneImageUploadLimitMb: Number(process.env.DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB ?? 60),
  referenceImageUploadLimitMb: Number(
    process.env.DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB ?? process.env.DEVILS_TOYS_IMAGE_LIMIT_MB ?? 20
  ),
  audioUploadLimitMb: Number(process.env.DEVILS_TOYS_AUDIO_LIMIT_MB ?? 50),
  logLevel: process.env.DEVILS_TOYS_LOG_LEVEL ?? "info",
  isProduction: process.env.NODE_ENV === "production"
};
