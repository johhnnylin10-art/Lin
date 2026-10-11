// Test stub for the Firebase app CDN module. Delegates to the mock installed
// on globalThis.__firebaseMock by the test that is running.
export const initializeApp = (...args) =>
  globalThis.__firebaseMock.initializeApp(...args);
export const getApps = (...args) => globalThis.__firebaseMock.getApps(...args);
export const getApp = (...args) => globalThis.__firebaseMock.getApp(...args);
