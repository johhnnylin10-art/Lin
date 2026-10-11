// Test stub for the Firebase auth CDN module.
export const getAuth = (...args) => globalThis.__firebaseMock.getAuth(...args);
export const onAuthStateChanged = (...args) =>
  globalThis.__firebaseMock.onAuthStateChanged(...args);
