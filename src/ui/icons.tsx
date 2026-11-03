import type { ComponentChildren } from "preact";

function Icon({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const InboxIcon = () => (
  <Icon>
    <path d="M3.5 13.5 6 5.5h12l2.5 8" />
    <path d="M3.5 13.5V18.5h17v-5h-5.5a3 3 0 0 1-6 0z" />
  </Icon>
);

export const RunningIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const CalendarIcon = () => (
  <Icon>
    <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Icon>
);

export const DoneIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.3 2.4 2.4 4.6-5" />
  </Icon>
);

export const GoalIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" />
  </Icon>
);

export const DeviceIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="17" height="11" rx="2" />
    <path d="M9 19.5h6M12 16v3.5" />
  </Icon>
);

export const BellIcon = () => (
  <Icon>
    <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const BackIcon = () => (
  <Icon size={22}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon size={14}>
    <path d="m9.5 6 6 6-6 6" />
  </Icon>
);

export const CodeIcon = () => (
  <Icon size={16}>
    <path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5M13.5 5.5l-3 13" />
  </Icon>
);

export const DocsIcon = () => (
  <Icon size={16}>
    <path d="M6.5 3.5h7l4 4v13h-11z" />
    <path d="M13.5 3.5v4h4M9 12h6M9 15.5h6" />
  </Icon>
);

export const ResearchIcon = () => (
  <Icon size={16}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Icon>
);

export const DeviceKindIcon = () => (
  <Icon size={16}>
    <rect x="3.5" y="5" width="17" height="11" rx="2" />
    <path d="M9 19.5h6M12 16v3.5" />
  </Icon>
);
