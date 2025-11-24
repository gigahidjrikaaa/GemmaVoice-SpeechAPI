/**
 * Enhanced error logging and handling utilities
 */

export interface ErrorDetails {
  message: string;
  code?: string;
  status?: number;
  timestamp: string;
  endpoint?: string;
  requestId?: string;
  stack?: string;
  cause?: unknown;
}

/**
 * Log levels for different severity
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Enhanced error logger with detailed context
 */
class ErrorLogger {
  private logs: Array<{ level: LogLevel; details: ErrorDetails }> = [];
  private maxLogs = 100; // Keep last 100 logs

  /**
   * Format error object into detailed ErrorDetails
   */
  private formatError(error: unknown, endpoint?: string): ErrorDetails {
    const timestamp = new Date().toISOString();

    // Handle Error objects
    if (error instanceof Error) {
      return {
        message: error.message,
        timestamp,
        endpoint,
        stack: error.stack,
        cause: (error as { cause?: unknown }).cause,
      };
    }

    // Handle API errors with status codes
    if (typeof error === 'object' && error !== null) {
      const err = error as Record<string, unknown>;
      return {
        message: String(err.message || err.detail || 'Unknown error'),
        code: String(err.code || ''),
        status: typeof err.status === 'number' ? err.status : undefined,
        timestamp,
        endpoint,
        requestId: String(err.requestId || ''),
      };
    }

    // Handle string errors
    if (typeof error === 'string') {
      return {
        message: error,
        timestamp,
        endpoint,
      };
    }

    // Fallback for unknown error types
    return {
      message: 'Unknown error occurred',
      timestamp,
      endpoint,
      cause: error,
    };
  }

  /**
   * Log an error with detailed context
   */
  logError(error: unknown, endpoint?: string, additionalContext?: Record<string, unknown>) {
    const details = this.formatError(error, endpoint);
    
    // Add to internal log buffer
    this.logs.push({ level: LogLevel.ERROR, details });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console error with full details
    console.error('❌ API Error:', {
      ...details,
      ...additionalContext,
    });

    // Log to console with styled output
    if (details.stack) {
      console.error('Stack trace:', details.stack);
    }

    return details;
  }

  /**
   * Log a warning
   */
  logWarning(message: string, context?: Record<string, unknown>) {
    const details: ErrorDetails = {
      message,
      timestamp: new Date().toISOString(),
    };

    this.logs.push({ level: LogLevel.WARN, details });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    console.warn('⚠️ Warning:', message, context);
  }

  /**
   * Log info message
   */
  logInfo(message: string, context?: Record<string, unknown>) {
    const details: ErrorDetails = {
      message,
      timestamp: new Date().toISOString(),
    };

    this.logs.push({ level: LogLevel.INFO, details });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    console.info('ℹ️ Info:', message, context);
  }

  /**
   * Log debug message (only in development)
   */
  logDebug(message: string, context?: Record<string, unknown>) {
    if (import.meta.env.DEV) {
      console.debug('🔍 Debug:', message, context);
    }
  }

  /**
   * Get all logged errors
   */
  getLogs(level?: LogLevel) {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs];
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * Get human-readable error message for users
   */
  getUserFriendlyMessage(error: unknown): string {
    const details = this.formatError(error);

    // Map status codes to user-friendly messages
    if (details.status) {
      switch (details.status) {
        case 400:
          return 'Invalid request. Please check your input and try again.';
        case 401:
          return 'Authentication failed. Please check your API key.';
        case 403:
          return 'Access denied. You don\'t have permission to perform this action.';
        case 404:
          return 'Endpoint not found. The service may be unavailable.';
        case 429:
          return 'Rate limit exceeded. Please wait a moment and try again.';
        case 500:
          return 'Server error. Please try again later or contact support.';
        case 502:
        case 503:
          return 'Service temporarily unavailable. Please try again in a few moments.';
        case 504:
          return 'Request timeout. The operation took too long. Please try again.';
        default:
          return details.message;
      }
    }

    // Handle network errors
    if (details.message.toLowerCase().includes('network')) {
      return 'Network error. Please check your connection and that the backend is running.';
    }

    if (details.message.toLowerCase().includes('fetch')) {
      return 'Cannot connect to server. Please ensure the backend is running at the correct URL.';
    }

    if (details.message.toLowerCase().includes('cors')) {
      return 'CORS error. The backend needs to allow requests from this domain.';
    }

    return details.message || 'An unexpected error occurred.';
  }

  /**
   * Export logs as JSON for debugging
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Download logs as a file
   */
  downloadLogs() {
    const logsJson = this.exportLogs();
    const blob = new Blob([logsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `error-logs-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Export singleton instance
export const errorLogger = new ErrorLogger();

/**
 * Helper to wrap async functions with error logging
 */
export function withErrorLogging<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  endpoint?: string
): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      errorLogger.logError(error, endpoint, { args });
      throw error;
    }
  }) as T;
}

/**
 * React error boundary compatible error logger
 */
export function logErrorBoundary(error: Error, errorInfo: { componentStack: string }) {
  errorLogger.logError(error, undefined, {
    componentStack: errorInfo.componentStack,
    type: 'React Error Boundary',
  });
}
