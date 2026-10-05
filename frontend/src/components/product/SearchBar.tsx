import React, { useState, useEffect, useRef } from "react";
import { Search, X, Loader2, ArrowUpRight } from "lucide-react";
import { CatalogSku } from "@/types/api.types";
import { useDebounce } from "@/hooks/useDebounce";

interface SearchBarProps {
  catalog: CatalogSku[];
  isLoading?: boolean;
  onSelectSku: (sku: CatalogSku) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  catalog,
  isLoading,
  onSelectSku,
}) => {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debouncedQuery = useDebounce(query, 250);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = debouncedQuery.trim()
    ? catalog.filter(
        (i) =>
          i.name.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
          i.sku_code.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
          i.category.toLowerCase().includes(debouncedQuery.toLowerCase())
      )
    : [];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || filtered.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      onSelectSku(filtered[selectedIndex]);
      setIsOpen(false);
      setQuery("");
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-lg">
      <div className="relative flex items-center">
        <Search className="absolute left-3.5 h-4 w-4 text-neutral-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search catalog SKUs, categories, products..."
          className="w-full rounded-xl border border-white/10 bg-neutral-800/90 pl-10 pr-9 py-2 text-sm text-neutral-100 placeholder-neutral-500 backdrop-blur-md outline-none transition-all focus:border-primary-500/50 focus:ring-2 focus:ring-primary-500/20"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              setIsOpen(false);
            }}
            className="absolute right-3 text-neutral-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isOpen && debouncedQuery && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 overflow-hidden rounded-xl border border-white/10 bg-neutral-850/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fadeIn">
          {isLoading ? (
            <div className="flex items-center justify-center p-4 text-xs text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Searching catalog...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-400">
              No matching SKUs found for "{debouncedQuery}"
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.sku_code}
                onClick={() => {
                  onSelectSku(item);
                  setIsOpen(false);
                  setQuery("");
                }}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                  idx === selectedIndex
                    ? "bg-primary-500/15 text-primary-400"
                    : "text-neutral-200 hover:bg-neutral-750/70"
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-neutral-100">{item.name}</span>
                  <span className="text-xs text-neutral-400">{item.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-primary-400">
                    ₹{item.base_price.toLocaleString("en-IN")}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-neutral-400" />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
