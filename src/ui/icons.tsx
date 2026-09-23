import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SelectIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3.5 L5 18.5 L9.2 14.6 L12 20.5 L14.6 19.3 L11.8 13.5 L17.5 13.2 Z" fill="currentColor" fillOpacity={0.12} />
  </Icon>
);

export const HandIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 12.5V6.2a1.4 1.4 0 0 1 2.8 0V11M10.8 10.5V4.8a1.4 1.4 0 0 1 2.8 0V11M13.6 10.8V6.2a1.4 1.4 0 0 1 2.8 0V13M16.4 11a1.4 1.4 0 0 1 2.8 0v3.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L4.6 15a1.5 1.5 0 0 1 2.3-1.9L8 14.3" />
  </Icon>
);

export const RunwayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.2 17.6 L17.6 4.2 L19.8 6.4 L6.4 19.8 Z" fill="currentColor" fillOpacity={0.9} stroke="none" />
    <path d="M8 16 L16 8" stroke="var(--panel, #fff)" strokeWidth={1} strokeDasharray="2 1.6" />
  </Icon>
);

export const TaxiwayIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 19 C 4 10, 12 12, 12 7 S 17 4, 20 4" />
    <path d="M4 19 L 8 9" strokeWidth={1} strokeOpacity={0.55} />
    <rect x={2.6} y={17.6} width={2.8} height={2.8} fill="var(--panel, #fff)" />
    <rect x={10.6} y={5.6} width={2.8} height={2.8} fill="var(--panel, #fff)" />
    <circle cx={8} cy={9} r={1.3} fill="currentColor" stroke="none" />
  </Icon>
);

export const ApronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7 L14 4 L20 9 L18 19 L6 18 Z" fill="currentColor" fillOpacity={0.18} />
    <rect x={2.8} y={5.8} width={2.4} height={2.4} fill="var(--panel, #fff)" />
    <rect x={18.8} y={7.8} width={2.4} height={2.4} fill="var(--panel, #fff)" />
  </Icon>
);

export const BuildingIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x={4} y={8} width={16} height={11} fill="currentColor" fillOpacity={0.85} />
    <path d="M4 8 L12 4 L20 8" />
  </Icon>
);

export const LabelIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />
  </Icon>
);

export const SymbolIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx={12} cy={12} r={7.5} />
    <path d="M12 6.8 L13.4 10.6 L17.4 10.7 L14.2 13.1 L15.4 17 L12 14.7 L8.6 17 L9.8 13.1 L6.6 10.7 L10.6 10.6 Z" fill="currentColor" stroke="none" />
  </Icon>
);

export const HotspotIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx={10} cy={13} r={6} strokeDasharray="0" />
    <path d="M14.5 8.5 L18 5" />
    <rect x={15.5} y={2.5} width={6} height={4} rx={0.6} strokeWidth={1.3} />
  </Icon>
);

export const SmoothIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 18 C 10 18, 14 6, 20 6" />
    <path d="M4 18 L 9 12 L 12 14 L 16 8 L 20 6" strokeOpacity={0.35} strokeDasharray="1.5 2" />
    <circle cx={4} cy={18} r={1.6} fill="currentColor" stroke="none" />
    <circle cx={20} cy={6} r={1.6} fill="currentColor" stroke="none" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 L4 9 L9 4" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const RedoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 14 L20 9 L15 4" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const EyeIcon = ({ off, ...p }: IconProps & { off?: boolean }) => (
  <Icon {...p}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx={12} cy={12} r={2.8} />
    {off && <path d="M4 20 L20 4" />}
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.2 10v6.5M13.8 10v6.5" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x={8.5} y={8.5} width={11} height={11} rx={1.5} />
    <path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" />
  </Icon>
);

export const FitIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Icon>
);

export const PrintIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2" />
    <rect x={7} y={14} width={10} height={6} />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5 L10 17.5 L19 7" />
  </Icon>
);

export const PanelIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x={3.5} y={4.5} width={17} height={15} rx={2} />
    <path d="M14.5 4.5v15" />
  </Icon>
);

export const HelpIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx={12} cy={12} r={9} />
    <path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.7M12 17.2v.1" />
  </Icon>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const MagnetIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4Z" />
    <path d="M6 8h4M14 8h4" />
  </Icon>
);

export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9h16M4 15h16M9 4v16M15 4v16" />
  </Icon>
);

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width={32} height={32} rx={7} fill="var(--ink)" />
      <path d="M7 24 L22 9 L25 12 L10 27 Z" fill="var(--panel)" />
      <path d="M5 13 C 11 13, 13 17, 20 19" stroke="var(--select)" strokeWidth={2.4} fill="none" strokeLinecap="round" />
    </svg>
  );
}
