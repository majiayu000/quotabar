interface SmartTipProps {
  message: string | null;
}

export default function SmartTip({ message }: SmartTipProps) {
  if (!message) return null;
  return (
    <div className="smart-tip">
      <span className="smart-tip-label">Tip</span>
      <span>{message}</span>
    </div>
  );
}
