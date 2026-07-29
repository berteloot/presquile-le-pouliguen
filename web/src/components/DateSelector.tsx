interface DateSelectorProps {
  value: string;
  min?: string;
  max?: string;
  isToday: boolean;
  onChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}

export default function DateSelector({
  value,
  min,
  max,
  isToday,
  onChange,
  onPrevious,
  onNext,
  onToday,
}: DateSelectorProps) {
  return (
    <div className="date-selector" aria-label="Date consultee">
      <button
        type="button"
        className="date-step"
        onClick={onPrevious}
        disabled={min != null && value <= min}
        aria-label="Jour precedent"
        title="Jour precedent"
      >
        ‹
      </button>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Date"
      />
      <button
        type="button"
        className="date-step"
        onClick={onNext}
        disabled={max != null && value >= max}
        aria-label="Jour suivant"
        title="Jour suivant"
      >
        ›
      </button>
      <button
        type="button"
        className="date-today"
        onClick={onToday}
        disabled={isToday}
      >
        Aujourd'hui
      </button>
    </div>
  );
}
