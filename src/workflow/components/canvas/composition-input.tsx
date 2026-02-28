/**
 * IME composition-safe input wrappers.
 *
 * During CJK (Chinese/Japanese/Korean) IME composition, `onChange` fires
 * with intermediate values (e.g. pinyin).  If those values are immediately
 * pushed into a store and round-tripped back as `value`, the browser's IME
 * candidate window flickers or resets.
 *
 * These wrappers keep a *local* value during composition and only forward
 * the final result to the parent `onChange` when composition ends.
 */
import { useRef, useState, useEffect } from "react";

export function CompInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const {
    value: externalValue,
    onChange,
    onCompositionStart,
    onCompositionEnd,
    ...rest
  } = props;
  const composingRef = useRef(false);
  const [localValue, setLocalValue] = useState(String(externalValue ?? ""));

  useEffect(() => {
    if (!composingRef.current) setLocalValue(String(externalValue ?? ""));
  }, [externalValue]);

  return (
    <input
      {...rest}
      value={localValue}
      onChange={(e) => {
        setLocalValue(e.target.value);
        if (!composingRef.current) onChange?.(e);
      }}
      onCompositionStart={(e) => {
        composingRef.current = true;
        onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const val = (e.target as HTMLInputElement).value;
        setLocalValue(val);
        onChange?.({
          target: e.target,
          currentTarget: e.currentTarget,
        } as React.ChangeEvent<HTMLInputElement>);
        onCompositionEnd?.(e);
      }}
    />
  );
}

export function CompTextarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const {
    value: externalValue,
    onChange,
    onCompositionStart,
    onCompositionEnd,
    ...rest
  } = props;
  const composingRef = useRef(false);
  const [localValue, setLocalValue] = useState(String(externalValue ?? ""));

  useEffect(() => {
    if (!composingRef.current) setLocalValue(String(externalValue ?? ""));
  }, [externalValue]);

  return (
    <textarea
      {...rest}
      value={localValue}
      onChange={(e) => {
        setLocalValue(e.target.value);
        if (!composingRef.current) onChange?.(e);
      }}
      onCompositionStart={(e) => {
        composingRef.current = true;
        onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        const val = (e.target as HTMLTextAreaElement).value;
        setLocalValue(val);
        onChange?.({
          target: e.target,
          currentTarget: e.currentTarget,
        } as React.ChangeEvent<HTMLTextAreaElement>);
        onCompositionEnd?.(e);
      }}
    />
  );
}
