import React, { Component } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

/**
 * React Error Boundary for Dheeksha Insurance.
 *
 * Catches rendering errors in descendant component trees and displays a safe,
 * user-friendly fallback UI without exposing stack traces or sensitive details.
 *
 * NOTE ON ERROR BOUNDARY SCOPE:
 * Error boundaries catch errors during rendering, in lifecycle methods, and in
 * constructors of the components below them.
 * Per React architecture, error boundaries do NOT catch:
 * 1. Errors in event handlers (use standard try/catch inside the handler).
 * 2. Asynchronous code (e.g. setTimeout, requestAnimationFrame, or unhandled fetch rejections).
 * 3. Server-side rendering.
 * 4. Errors thrown inside the error boundary component itself.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    // Update state so the next render shows the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log safe diagnostic information without leaking user data
    if (typeof console !== 'undefined' && console.error) {
      console.error(
        '[ErrorBoundary] Caught an unexpected rendering exception:',
        error?.name || 'Error',
        error?.message ? `: ${error.message}` : ''
      );
    }

    if (typeof this.props.onError === 'function') {
      try {
        this.props.onError(error, errorInfo);
      } catch {
        // Prevent secondary errors in error reporting callback
      }
    }
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0B1528] px-4 py-12 transition-colors duration-300 font-sans">
          <div className="max-w-md w-full bg-white dark:bg-[#13233D] rounded-3xl p-8 text-center shadow-lg border border-sky-100 dark:border-sky-900/30">
            <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-6 border border-amber-200 dark:border-amber-800/40">
              <AlertTriangle size={32} />
            </div>

            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Something Went Wrong
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              An unexpected error occurred while rendering this page. You can try refreshing the page or returning to the home screen.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
              >
                <RotateCcw size={16} />
                Refresh Page
              </button>
              <button
                type="button"
                onClick={this.handleGoHome}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm text-gray-700 dark:text-gray-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400/50 cursor-pointer"
              >
                <Home size={16} />
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
