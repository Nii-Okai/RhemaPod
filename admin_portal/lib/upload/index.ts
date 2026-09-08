/**
 * Upload pipeline (plan §A.5, W9). Highest-risk surface: browser-direct
 * presigned PUT with XHR progress, retry-as-new-ticket, optimistic/server row
 * merge.
 */

export {
  UploadProvider,
  useUploadContext,
  type UploadRejection,
} from "./upload-context";
export { mergeUploadRows, type MergeContext } from "./merge";
export type {
  LocalUpload,
  LocalPhase,
  UploadRow,
  UploadRowState,
} from "./types";
export {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_GB,
  MEDIA_ACCEPT_ATTR,
  IMAGE_ACCEPT_ATTR,
} from "./constants";
export { validateMediaFile, validateImageFile } from "./validate";
export { UploadRateEstimator, formatEta } from "./eta";
export {
  describeUploadFailure,
  UploadValidationError,
  UploadPutError,
  TicketError,
  ConfirmError,
  type UploadFailureSurface,
} from "./errors";
export { uploadSermonThumbnail } from "./thumbnail";
