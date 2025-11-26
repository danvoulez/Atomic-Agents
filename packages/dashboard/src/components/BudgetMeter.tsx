"use client";

interface BudgetMeterProps {
  type: "steps" | "tokens" | "time" | "cost";
  used: number;
  cap: number;
  showLabel?: boolean;
}

const typeConfig = {
  steps: { label: "Steps", format: (n: number) => n.toString() },
  tokens: { label: "Tokens", format: (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString()) },
  time: { label: "Time", format: (n: number) => `${Math.round(n / 1000)}s` },
  cost: { label: "Cost", format: (n: number) => `$${(n / 100).toFixed(2)}` },
};

export function BudgetMeter({ type, used, cap, showLabel = true }: BudgetMeterProps) {
  const config = typeConfig[type];
  const percentage = Math.min((used / cap) * 100, 100);
  const isWarning = percentage > 75;
  const isCritical = percentage > 90;

  const getBarColor = () => {
    if (isCritical) return "bg-[var(--status-error)]";
    if (isWarning) return "bg-[var(--status-warning)]";
    return "bg-[var(--accent-blue)]";
  };

  const getTextColor = () => {
    if (isCritical) return "text-[var(--status-error)]";
    if (isWarning) return "text-[var(--status-warning)]";
    return "text-[var(--text-secondary)]";
  };

  return (
    <div className="space-y-1">
      {showLabel && (
        <div className="flex justify-between text-xs">
          <span className="text-[var(--text-secondary)]">{config.label}</span>
          <span className={getTextColor()}>
            {config.format(used)} / {config.format(cap)}
          </span>
        </div>
      )}
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${getBarColor()}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

interface BudgetGridProps {
  steps: { used: number; cap: number };
  tokens: { used: number; cap: number };
  time?: { used: number; cap: number };
  cost?: { used: number; cap: number };
}

export function BudgetGrid({ steps, tokens, time, cost }: BudgetGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <BudgetMeter type="steps" {...steps} />
      <BudgetMeter type="tokens" {...tokens} />
      {time && <BudgetMeter type="time" {...time} />}
      {cost && <BudgetMeter type="cost" {...cost} />}
    </div>
  );
}

export default BudgetMeter;

