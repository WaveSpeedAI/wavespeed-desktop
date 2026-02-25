import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, value, onChange, ...props }, ref) => {
    const needsCompositionGuard = !type || type === 'text' || type === 'search'
    const composingRef = React.useRef(false)
    const [localValue, setLocalValue] = React.useState(String(value ?? ''))

    React.useEffect(() => {
      if (!composingRef.current) setLocalValue(String(value ?? ''))
    }, [value])

    if (needsCompositionGuard) {
      return (
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50 transition-all",
            className
          )}
          ref={ref}
          value={localValue}
          onChange={e => {
            setLocalValue(e.target.value)
            if (!composingRef.current) onChange?.(e)
          }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={e => {
            composingRef.current = false
            setLocalValue((e.target as HTMLInputElement).value)
            onChange?.({ target: e.target, currentTarget: e.currentTarget } as React.ChangeEvent<HTMLInputElement>)
          }}
          {...props}
        />
      )
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-border/80 bg-background px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50 transition-all",
          className
        )}
        ref={ref}
        value={value}
        onChange={onChange}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
