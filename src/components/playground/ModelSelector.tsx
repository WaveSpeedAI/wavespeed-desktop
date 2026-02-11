import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fuzzySearch } from '@/lib/fuzzySearch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Model } from '@/types/model'

interface ModelSelectorProps {
  models: Model[]
  value: string | undefined
  onChange: (modelId: string) => void
  disabled?: boolean
}

export function ModelSelector({ models, value, onChange, disabled }: ModelSelectorProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedModel = models.find(m => m.model_id === value)

  // Debounce search updates for smooth typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(localSearch)
    }, 150) // Faster debounce for responsive feel
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [localSearch])

  // Filter models using debounced search with fuzzy matching
  const filteredModels = useMemo(() => {
    if (!debouncedSearch.trim()) return models
    const results = fuzzySearch(models, debouncedSearch, (model) => [
      model.name,
      model.model_id,
      model.description || ''
    ])
    return results.map(r => r.item)
  }, [models, debouncedSearch])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setLocalSearch('')
        setDebouncedSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
      setLocalSearch('')
      setDebouncedSearch('')
    } else if (e.key === 'Enter' && filteredModels.length > 0) {
      onChange(filteredModels[0].model_id)
      setIsOpen(false)
      setLocalSearch('')
      setDebouncedSearch('')
    }
  }, [filteredModels, onChange])

  const handleSelect = useCallback((modelId: string) => {
    onChange(modelId)
    setIsOpen(false)
    setLocalSearch('')
    setDebouncedSearch('')
  }, [onChange])

  const handleClear = useCallback(() => {
    setLocalSearch('')
    setDebouncedSearch('')
    inputRef.current?.focus()
  }, [])

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            disabled={disabled}
            className={cn(
              "flex h-11 w-full items-center justify-between rounded-lg border border-input/80 bg-background px-3 py-2 text-sm transition-all",
              "focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isOpen && "border-primary/50 shadow-sm ring-2 ring-primary/10"
            )}
          >
            <span className={cn("truncate", !selectedModel && "text-muted-foreground")}>
              {selectedModel?.name || t('playground.selectModel')}
            </span>
            <ChevronDown className={cn("h-4 w-4 opacity-50 transition-transform shrink-0", isOpen && "rotate-180")} />
          </button>
        </TooltipTrigger>
        {selectedModel && (
          <TooltipContent side="bottom" className="max-w-xs">
            {selectedModel.name}
          </TooltipContent>
        )}
      </Tooltip>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-border/80 bg-popover shadow-xl animate-in fade-in-0 zoom-in-95">
          {/* Search input */}
          <div className="flex items-center border-b px-3">
            <Search className="h-4 w-4 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              type="text"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('playground.searchModels')}
              className="flex h-10 w-full bg-transparent px-2 py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            {localSearch && (
              <button
                onClick={handleClear}
                className="text-muted-foreground hover:text-foreground"
                title="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Model list */}
          <div ref={listRef} className="max-h-72 overflow-auto p-1.5">
            {filteredModels.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {t('models.noResults')}
              </div>
            ) : (
              filteredModels.map((model) => (
                <button
                  key={model.model_id}
                  type="button"
                  onClick={() => handleSelect(model.model_id)}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 py-2 text-sm outline-none",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus:bg-accent focus:text-accent-foreground",
                    model.model_id === value && "bg-primary/10 text-foreground"
                  )}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      model.model_id === value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{model.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
