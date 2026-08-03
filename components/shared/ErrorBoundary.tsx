"use client";

import React, { ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary - catches errors in child components and displays
 * a fallback UI instead of crashing the entire dashboard with a white screen.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Dashboard error boundary caught:", error, errorInfo);
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col gap-[14px] p-[20px]">
          <div className="rounded-[12px] border border-[var(--rose)] bg-[rgba(244,63,94,0.08)] p-[16px] flex flex-col gap-[12px]">
            <div className="flex items-start gap-[12px]">
              <span className="text-[20px] leading-none flex-shrink-0">⚠️</span>
              <div className="flex-1">
                <h2 className="text-[14px] font-bold text-[var(--rose)] margin-0">
                  Dashboard Error
                </h2>
                <p className="text-[12px] text-[var(--fg2)] mt-[6px] margin-0">
                  An unexpected error occurred. Please try refreshing the page.
                </p>
                <p className="text-[11px] text-[var(--faint)] mt-[8px] margin-0 font-mono break-words">
                  {this.state.error?.message || "Unknown error"}
                </p>
              </div>
            </div>
            <button
              onClick={this.resetError}
              className="self-start h-[28px] px-[10px] rounded-[6px] border border-[var(--rose)] bg-[rgba(244,63,94,0.12)] text-[var(--rose)] text-[11px] font-semibold hover:bg-[rgba(244,63,94,0.18)] transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
