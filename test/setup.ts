import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

/**
 * RTL only auto-registers cleanup when Vitest globals are on; they are off
 * here, so without this the DOM leaks between tests and a query can match a
 * previous test's markup. Guarded because the same setup file runs for the
 * node-environment suites.
 */
if (typeof document !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => {
    cleanup();
  });

  // jsdom implements no layout, so scrollIntoView does not exist. This is an
  // environment gap rather than an app bug -- stub it rather than making the
  // component defend against a browser API that is universally available.
  Element.prototype.scrollIntoView ??= function scrollIntoView() {
    /* no layout in jsdom */
  };
}
