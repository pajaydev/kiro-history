import { Search } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  return (
    <div className="flex-1 relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgb(var(--foreground-muted))]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 bg-[rgb(var(--background-card))] rounded-lg text-sm placeholder:text-[rgb(var(--foreground-muted))] focus:outline-none focus:ring-1 focus:ring-[rgb(var(--foreground-muted))]"
      />
    </div>
  );
}
