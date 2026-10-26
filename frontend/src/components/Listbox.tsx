import { Check, ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface ListboxOption<T extends string | number> {
  value: T
  label: string
  detail?: string
  icon?: ReactNode
}

interface ListboxProps<T extends string | number> {
  label: string
  value: T
  options: ListboxOption<T>[]
  onChange: (value: T) => void
  /** A last entry that runs a command instead of choosing a value. */
  action?: { label: string; onSelect: () => void }
  /** Show a filter field at the top of the list, for long lists. */
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}

/** A dropdown in the site's own style: ink outline, lifted panel, yellow selection. */
export function Listbox<T extends string | number>({
  label,
  value,
  options,
  onChange,
  action,
  searchPlaceholder,
  disabled = false,
  className = '',
}: ListboxProps<T>) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const ids = { label: useId(), list: useId() }
  const selected = options.find((o) => o.value === value) ?? options[0]

  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q)) : options
  const last = shown.length - (action ? 0 : 1)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  useEffect(() => {
    if (open && searchPlaceholder) search.current?.focus()
  }, [open, searchPlaceholder])

  // Keep the highlighted option in view while moving with the keyboard.
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, cursor])

  const openAt = () => {
    if (disabled) return
    setQuery('')
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  const choose = (i: number) => {
    close()
    if (i === shown.length && action) action.onSelect()
    else if (shown[i]) onChange(shown[i].value)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openAt()
      }
      return
    }
    const typing = e.target === search.current
    const moves: Record<string, () => void> = {
      ArrowDown: () => setCursor((c) => Math.min(c + 1, last)),
      ArrowUp: () => setCursor((c) => Math.max(c - 1, 0)),
      Enter: () => choose(cursor),
      Escape: close,
      Tab: () => setOpen(false),
      ...(typing ? {} : { Home: () => setCursor(0), End: () => setCursor(last), ' ': () => choose(cursor) }),
    }
    const move = moves[e.key]
    if (!move) return
    if (e.key !== 'Tab') e.preventDefault()
    move()
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <span id={ids.label} className="block text-sm font-semibold">
        {label}
      </span>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={ids.list}
        aria-labelledby={`${ids.label} ${ids.label}-value`}
        aria-activedescendant={open && !searchPlaceholder ? `${ids.list}-${cursor}` : undefined}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={onKeyDown}
        className={`lift mt-1 flex min-h-12 w-full items-center gap-2.5 rounded-[12px] border-2 border-ink bg-paper px-3 text-left disabled:cursor-not-allowed disabled:border-ink/30 disabled:text-ink-soft ${
          open ? 'translate-x-[-3px] translate-y-[-3px] shadow-[4px_4px_0_0_var(--color-ink)]' : ''
        }`}
      >
        {selected?.icon}
        <span id={`${ids.label}-value`} className="min-w-0 flex-1">
          <span className="block truncate font-[800] leading-tight">{selected?.label}</span>
          {selected?.detail && <span className="block truncate text-sm text-ink-soft">{selected.detail}</span>}
        </span>
        <ChevronDown size={20} strokeWidth={2.5} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-[12px] border-2 border-ink bg-paper shadow-[4px_4px_0_0_var(--color-ink)]">
          {searchPlaceholder && (
            <div className="relative border-b-2 border-ink">
              <Search size={18} strokeWidth={2.5} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setCursor(0)
                }}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls={ids.list}
                aria-activedescendant={`${ids.list}-${cursor}`}
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="min-h-12 w-full bg-cream pl-9 pr-3 font-semibold focus:bg-paper focus:outline-none"
              />
            </div>
          )}
          <ul ref={list} id={ids.list} role="listbox" aria-labelledby={ids.label} className="max-h-80 overflow-y-auto">
            {shown.length === 0 && <li className="px-3 py-3 text-ink-soft">Nothing matches “{query}”.</li>}
            {shown.map((o, i) => {
              const isSelected = o.value === value
              return (
                <li
                  key={String(o.value)}
                  id={`${ids.list}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setCursor(i)}
                  onClick={() => choose(i)}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2.5 ${i ? 'border-t border-ink/15' : ''} ${
                    isSelected ? 'bg-yellow' : i === cursor ? 'bg-cream-deep' : ''
                  }`}
                >
                  {o.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-[750] leading-tight">{o.label}</span>
                    {o.detail && <span className="block truncate text-sm text-ink-soft">{o.detail}</span>}
                  </span>
                  {isSelected && <Check size={18} strokeWidth={3} aria-hidden="true" className="shrink-0" />}
                </li>
              )
            })}
            {action && (
              <li
                id={`${ids.list}-${shown.length}`}
                data-index={shown.length}
                role="option"
                aria-selected={false}
                onPointerEnter={() => setCursor(shown.length)}
                onClick={() => choose(shown.length)}
                className={`flex cursor-pointer items-center gap-2.5 border-t-2 border-ink px-3 py-3 font-[800] ${cursor === shown.length ? 'bg-yellow' : 'bg-cream'}`}
              >
                <Search size={18} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
                {action.label}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
