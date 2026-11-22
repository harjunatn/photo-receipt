import type { ComponentChildren } from 'preact';

/** Small line icons for table actions. */

export function QrIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h2v2h-2v-2zm4 0h4v2h-4v-2zm-4 4h2v4h-2v-4zm4 0h2v2h2v4h-4v-2h-2v-2h2v-2z" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

/** Line icons for the dashboard's menu and buttons: one stroke weight, drawn on a 24px grid. */
function Line({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function HomeIcon() {
  return (
    <Line>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v11h14V9" />
      <path d="M10 20v-5h4v5" />
    </Line>
  );
}

/** A booth: a screen on a stand, with the camera's lens. */
export function BoothIcon() {
  return (
    <Line>
      <rect x="4" y="3" width="16" height="13" rx="2" />
      <circle cx="12" cy="9.5" r="2.5" />
      <path d="M12 16v5M8.5 21h7" />
    </Line>
  );
}

export function HistoryIcon() {
  return (
    <Line>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </Line>
  );
}

export function ScanIcon() {
  return (
    <Line>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
      <rect x="7.5" y="7.5" width="3.5" height="3.5" />
      <rect x="13" y="7.5" width="3.5" height="3.5" />
      <rect x="7.5" y="13" width="3.5" height="3.5" />
      <path d="M13.5 13.5h3v3" />
    </Line>
  );
}

export function TicketIcon() {
  return (
    <Line>
      <path d="M3 9V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5V9a3 3 0 0 0 0 6v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V15a3 3 0 0 0 0-6z" />
      <path d="m9.5 14.5 5-5" />
      <path d="M9.5 9.6h.01M14.5 14.4h.01" />
    </Line>
  );
}

export function GalleryIcon() {
  return (
    <Line>
      <rect x="3" y="6" width="15" height="15" rx="2" />
      <path d="M7 3h12a2 2 0 0 1 2 2v12" />
      <circle cx="8" cy="11" r="1.5" />
      <path d="m3.5 18 4-4 3 3 2.5-2.5 5 5" />
    </Line>
  );
}

export function SlidersIcon() {
  return (
    <Line>
      <path d="M4 8h9M19 8h1M4 16h1M11 16h9" />
      <circle cx="16" cy="8" r="2.5" />
      <circle cx="8" cy="16" r="2.5" />
    </Line>
  );
}

export function StoreIcon() {
  return (
    <Line>
      <path d="M3 10 4.5 4h15L21 10a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z" />
      <path d="M4.5 12.5V20h15v-7.5" />
      <path d="M10 20v-4.5h4V20" />
    </Line>
  );
}

export function LayersIcon() {
  return (
    <Line>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 12.5 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </Line>
  );
}

export function ChevronDownIcon() {
  return (
    <Line size={16}>
      <path d="m6 9 6 6 6-6" />
    </Line>
  );
}

export function DownloadIcon() {
  return (
    <Line size={16}>
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </Line>
  );
}
