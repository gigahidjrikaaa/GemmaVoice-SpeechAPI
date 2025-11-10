import { Component, ReactNode, ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, errorInfo: ErrorInfo, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component to catch and handle React errors gracefully.
 * 
 * Usage:
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 * 
 * With custom fallback:
 * ```tsx
 * <ErrorBoundary fallback={(error, errorInfo, reset) => (
 *   <div>Custom error UI</div>
 * )}>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error to the console for debugging
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    
    // Update state with error info
    this.setState({
      error,
      errorInfo,
    });

    // TODO: Log to error reporting service (e.g., Sentry)
    // Example: Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
  }

  resetErrorBoundary = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback && this.state.error && this.state.errorInfo) {
        return this.props.fallback(
          this.state.error,
          this.state.errorInfo,
          this.resetErrorBoundary
        );
      }

      // Default fallback UI
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-6 rounded-md border border-red-800 bg-red-900/20">
          <div className="flex flex-col items-center gap-4 max-w-2xl">
            {/* Error Icon */}
            <div className="rounded-full bg-red-500/20 p-4">
              <svg
                className="w-12 h-12 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            {/* Error Title */}
            <h2 className="text-xl font-semibold text-red-300">
              Something went wrong
            </h2>

            {/* Error Message */}
            {this.state.error && (
              <div className="w-full rounded-md bg-slate-950 p-4 border border-slate-800">
                <p className="text-sm font-mono text-slate-300 mb-2">
                  {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-300">
                      View stack trace
                    </summary>
                    <pre className="mt-2 text-xs text-slate-500 overflow-x-auto whitespace-pre-wrap break-words">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={this.resetErrorBoundary}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Reload page
              </button>
            </div>

            {/* Help Text */}
            <p className="text-xs text-slate-400 text-center">
              If this problem persists, please check the browser console for more details
              or contact support.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
