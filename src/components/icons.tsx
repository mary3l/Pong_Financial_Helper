// Stroke icons from the design canvas. Decorative: pair each with a text label.

type IconProps = { size?: number; className?: string };

function Icon({
  size = 24,
  className,
  strokeWidth = 2,
  children,
}: IconProps & { strokeWidth?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Icon>
  );
}

export function PlanIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </Icon>
  );
}

export function MoneyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="20" height="14" rx="3" />
      <path d="M16 13h2M2 10h20" />
    </Icon>
  );
}

export function GroceryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 3h3l2.5 12h11L21 7H6M9 20h.01M18 20h.01" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon strokeWidth={3} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.6} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7M19 7l-3 7a3 3 0 0 0 6 0l-3-7" />
    </Icon>
  );
}

export function CalculatorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </Icon>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M10 20V5M16 20v-7M22 20H2" />
    </Icon>
  );
}

export function ChevronIcon({
  direction = "right",
  ...props
}: IconProps & { direction?: "left" | "right" }) {
  return (
    <Icon strokeWidth={2.4} {...props}>
      <path d={direction === "right" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
    </Icon>
  );
}

/** A category or wallet icon drawn from one stroke path (see lib/categories.ts). */
export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </Icon>
  );
}

export function PathIcon({ d, ...props }: IconProps & { d: string }) {
  return (
    <Icon {...props}>
      <path d={d} />
    </Icon>
  );
}

export function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"
      />
    </svg>
  );
}
