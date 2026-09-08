// Our own components (not shadcn-owned). Sidebar + DataTable land in W5 / W6.
// Plan §A.6.
export { StatusBadge, statusVisual } from "./status-badge";
export type {
  StatusVisual,
  SermonStatus,
  UploadStatus,
  AnyStatus,
  StatusBadgeProps,
} from "./status-badge";
export {
  SERMON_STATUS_PIPELINE,
  UPLOAD_STATUS_PIPELINE,
} from "./status-badge";

export { TierChip, RoleChip } from "./chips";
export type { TierChipProps, RoleChipProps } from "./chips";

export { Avatar, avatarHash, avatarTint, initials, AVATAR_TINTS } from "./avatar";
export type { AvatarProps, AvatarTint } from "./avatar";

export { MediaPlaceholder } from "./media-placeholder";
export type { MediaPlaceholderProps } from "./media-placeholder";

export { StatCard } from "./stat-card";
export type { StatCardProps } from "./stat-card";

export { MediaCard } from "./media-card";
export type { MediaCardProps } from "./media-card";

export { SegmentedControl, nextSegmentIndex } from "./segmented-control";
export type { SegmentOption, SegmentedControlProps } from "./segmented-control";

export { Pagination, paginationRange } from "./pagination";
export type { PaginationProps } from "./pagination";

export { Toast } from "./toast";
export type { ToastProps } from "./toast";

export { EmptyState } from "./empty-state";
export type { EmptyStateProps } from "./empty-state";

export { PageHeader } from "./page-header";
export type { PageHeaderProps } from "./page-header";
