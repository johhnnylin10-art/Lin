import "./ag-config.js";
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

export const firebaseConfig = globalThis.AG_FIREBASE_CONFIG;

export function getFirebaseApp() {
    return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

let database;
export function getDb() {
    if (!database) database = getDatabase(getFirebaseApp());
    return database;
}
