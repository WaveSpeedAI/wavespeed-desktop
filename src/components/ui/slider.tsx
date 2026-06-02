import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    rangeClassName?: string;
    thumbClassName?: string;
    trackClassName?: string;
  }
>(
  (
    {
      className,
      rangeClassName,
      thumbClassName,
      trackClassName,
      orientation = "horizontal",
      value,
      defaultValue,
      ...props
    },
    ref,
  ) => {
    const isVertical = orientation === "vertical";
    // Determine how many thumbs to render based on value/defaultValue
    const thumbCount = Array.isArray(value)
      ? value.length
      : Array.isArray(defaultValue)
        ? defaultValue.length
        : 1;

    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn(
          "relative flex select-none items-center",
          isVertical ? "h-full flex-col" : "w-full",
          className,
        )}
        orientation={orientation}
        value={value}
        defaultValue={defaultValue}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            "relative grow overflow-hidden rounded-full bg-primary/20",
            isVertical ? "h-full w-1.5" : "h-1.5 w-full",
            trackClassName,
          )}
        >
          <SliderPrimitive.Range
            className={cn(
              "absolute bg-primary transition-all",
              isVertical ? "w-full" : "h-full",
              rangeClassName,
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }).map((_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            className={cn(
              "block h-4 w-4 rounded-full border-2 border-primary bg-background shadow-md transition-all hover:scale-125 hover:shadow-lg hover:shadow-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:scale-125 active:scale-110 disabled:pointer-events-none disabled:opacity-50",
              thumbClassName,
            )}
          />
        ))}
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
