/**
 * Centralized error handling and logging for the frontend application.
 */

type ErrorSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

interface ErrorLogEntry {
  timestamp: string;
  severity: ErrorSeverity;
  message: string;
  context?: Record<string, unknown>;
  stack?: string;
}

class ErrorLogger {
  private logs: ErrorLogEntry[] = [];
  private maxLogs = 100;

  /**
   * Log a debug message
   */
  logDebug(message: string, context?: Record<string, unknown>) {
    this.addLog('debug', message, context);
    // eslint-disable-next-line no-console
    console.debug(`[DEBUG] ${message}`, context || '');
  }

  /**
   * Log an informational message
   */
  logInfo(message: string, context?: Record<string, unknown>) {
    this.addLog('info', message, context);
    console.log(`[INFO] ${message}`, context || '');
  }

  /**
   * Log a warning
   */
  logWarning(message: string, context?: Record<string, unknown>) {
    this.addLog('warning', message, context);
    console.warn(`[WARN] ${message}`, context || '');
  }

  /**
   * Log an error
   */
  logError(error: unknown, contextMessage?: string, context?: Record<string, unknown>) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const fullMessage = contextMessage ? `${contextMessage}: ${message}` : message;

    this.addLog('error', fullMessage, { ...context, originalError: error }, stack);
    console.error(`[ERROR] ${fullMessage}`, context || '', stack || '');
  }

  /**
   * Get a user-friendly error message from an error object
   */
  getUserFriendlyMessage(error: unknown): string {
    if (error instanceof Error) {
      // Handle specific error types if needed
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        return "Unable to connect to the server. Please check if the backend is running.";
      }
      return error.message;
    }
    return "An unexpected error occurred.";
  }

  /**
   * Get all logs
   */
  getLogs(): ErrorLogEntry[] {
    return this.logs;
  }

  /**
   * Clear logs
   */
  clearLogs() {
    this.logs = [];
  }

  private addLog(severity: ErrorSeverity, message: string, context?: Record<string, unknown>, stack?: string) {
    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      severity,
      message,
      context,
      stack
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }
}

export const errorLogger = new ErrorLogger();
