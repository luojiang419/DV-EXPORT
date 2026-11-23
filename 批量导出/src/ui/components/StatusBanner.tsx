interface StatusBannerProps {
  tone: "success" | "warning" | "danger" | "neutral";
  title: string;
  description: string;
}

export function StatusBanner({ tone, title, description }: StatusBannerProps) {
  return (
    <div className={`status-banner status-banner--${tone}`}>
      <div className="status-banner__title">{title}</div>
      <div className="status-banner__description">{description}</div>
    </div>
  );
}
