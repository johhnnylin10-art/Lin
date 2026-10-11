// Test stub for the Firebase database CDN module.
export const set = (...args) => globalThis.__firebaseMock.set(...args);
export const ref = (...args) => globalThis.__firebaseMock.ref(...args);
