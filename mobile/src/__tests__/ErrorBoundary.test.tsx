import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ErrorBoundary,
  ErrorFallback,
  withErrorBoundary,
} from "@mobile/components/shared/ErrorBoundary";

// Component that throws an error
function ThrowError({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error message");
  }
  return <div>No error</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress console.error for cleaner test output
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should render children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("should render fallback UI when error occurs", () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error message")).toBeInTheDocument();
  });

  it("should render custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom fallback")).toBeInTheDocument();
  });

  it("should call onError callback when error occurs", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it("should reset error state when Try Again is clicked", () => {
    const onReset = vi.fn();
    let shouldThrow = true;

    const { rerender } = render(
      <ErrorBoundary onReset={onReset}>
        <ThrowError shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Change condition and click Try Again
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try Again"));

    expect(onReset).toHaveBeenCalled();
  });
});

describe("ErrorFallback", () => {
  it("should render default error message", () => {
    render(<ErrorFallback />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText("An unexpected error occurred"),
    ).toBeInTheDocument();
  });

  it("should render custom title and description", () => {
    render(
      <ErrorFallback title="Custom Title" description="Custom description" />,
    );

    expect(screen.getByText("Custom Title")).toBeInTheDocument();
    expect(screen.getByText("Custom description")).toBeInTheDocument();
  });

  it("should render error message when provided", () => {
    const error = new Error("Specific error");

    render(<ErrorFallback error={error} />);

    expect(screen.getByText("Specific error")).toBeInTheDocument();
  });

  it("should show Try Again button when resetError is provided", () => {
    const resetError = vi.fn();

    render(<ErrorFallback resetError={resetError} />);

    const button = screen.getByText("Try Again");
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(resetError).toHaveBeenCalled();
  });

  it("should not show Try Again button when resetError is not provided", () => {
    render(<ErrorFallback />);

    expect(screen.queryByText("Try Again")).not.toBeInTheDocument();
  });
});

describe("withErrorBoundary HOC", () => {
  it("should wrap component with ErrorBoundary", () => {
    function TestComponent() {
      return <div>Test component</div>;
    }

    const WrappedComponent = withErrorBoundary(TestComponent);

    render(<WrappedComponent />);

    expect(screen.getByText("Test component")).toBeInTheDocument();
  });

  it("should catch errors from wrapped component", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const WrappedComponent = withErrorBoundary(ThrowError);

    render(<WrappedComponent />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should use custom fallback when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const WrappedComponent = withErrorBoundary(
      ThrowError,
      <div>Custom HOC fallback</div>,
    );

    render(<WrappedComponent />);

    expect(screen.getByText("Custom HOC fallback")).toBeInTheDocument();
  });
});
