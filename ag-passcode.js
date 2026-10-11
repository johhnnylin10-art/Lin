// ============================================================
// AssetGuard Shared Internal Passcode Security Module
// ============================================================
//
// One internal passcode per Firebase account.
//
// The internal passcode is separate from the Firebase login
// password.
//
// PASSCODE CHANGE:
//   - Existing passcode required.
//
// PASSCODE RECOVERY:
//   - User must already be signed into AssetGuard.
//   - User enters their Firebase account email.
//   - User enters their normal Firebase login password.
//   - Firebase re-authenticates the user.
//   - User can immediately create a new internal passcode.
//
// NO EMAIL IS SENT.
// NO FIREBASE EMAIL-LINK QUOTA IS USED.
// ============================================================

import { getFirebaseApp, getDb } from "./ag-firebase.js";

import {
    getAuth,
    onAuthStateChanged,
    EmailAuthProvider,
    reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import {
    ref,
    get,
    set
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";


// ============================================================
// SECURITY SETTINGS
// ============================================================

const ITERATIONS = 120000;

const MIN_LENGTH = 4;
const MAX_LENGTH = 32;

const CACHE_TTL_MS = 15000;


// ============================================================
// CONSTANTS
// ============================================================

const NOT_CONFIGURED_MESSAGE =
    "No internal passcode has been set yet. Open Settings to create one.";

const RECOVERY_REQUIRED_MESSAGE =
    "Verify your AssetGuard login password to reset the internal passcode.";


// ============================================================
// INTERNAL STATE
// ============================================================

let cachedRecord = null;
let cachedAt = 0;

let userPromise = null;


// ============================================================
// TEXT / CRYPTO HELPERS
// ============================================================

function textBytes(value) {
    return new TextEncoder().encode(String(value));
}


function toHex(bytes) {

    return Array
        .from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

}


function fromHex(hex) {

    const length = hex.length / 2;

    const output = new Uint8Array(length);

    for (let index = 0; index < length; index++) {

        output[index] = parseInt(
            hex.substr(index * 2, 2),
            16
        );

    }

    return output;

}


function randomHex(byteLength) {

    const bytes = new Uint8Array(byteLength);

    crypto.getRandomValues(bytes);

    return toHex(bytes);

}


function subtle() {

    if (
        !globalThis.crypto ||
        !globalThis.crypto.subtle
    ) {

        throw new Error(
            "Secure cryptography is unavailable in this browser context."
        );

    }

    return crypto.subtle;

}


// ============================================================
// PBKDF2 PASSCODE HASHING
// ============================================================

async function derive(
    passcode,
    saltHex,
    iterations
) {

    const keyMaterial =
        await subtle().importKey(

            "raw",

            textBytes(passcode),

            "PBKDF2",

            false,

            ["deriveBits"]

        );


    const bits =
        await subtle().deriveBits(

            {

                name: "PBKDF2",

                salt: fromHex(saltHex),

                iterations: iterations,

                hash: "SHA-256"

            },

            keyMaterial,

            256

        );


    return toHex(
        new Uint8Array(bits)
    );

}


// ============================================================
// CONSTANT TIME COMPARISON
// ============================================================

function constantTimeEquals(a, b) {

    if (
        typeof a !== "string" ||
        typeof b !== "string" ||
        a.length !== b.length
    ) {

        return false;

    }


    let difference = 0;


    for (
        let index = 0;
        index < a.length;
        index++
    ) {

        difference |=
            a.charCodeAt(index) ^
            b.charCodeAt(index);

    }


    return difference === 0;

}


// ============================================================
// CURRENT FIREBASE USER
// ============================================================

function currentUser() {

    if (!userPromise) {

        userPromise =
            new Promise((resolve) => {

                const auth =
                    getAuth(
                        getFirebaseApp()
                    );


                if (auth.currentUser) {

                    resolve(
                        auth.currentUser
                    );

                    return;

                }


                const unsubscribe =
                    onAuthStateChanged(

                        auth,

                        (user) => {

                            unsubscribe();

                            resolve(user);

                        },

                        () => {

                            unsubscribe();

                            resolve(null);

                        }

                    );

            });

    }


    return userPromise;

}


// ============================================================
// REQUIRE AUTHENTICATED USER
// ============================================================

async function requireUser() {

    const user =
        await currentUser();


    if (!user) {

        throw new Error(
            "You must be signed in to manage the internal passcode."
        );

    }


    return user;

}


async function requireUid() {

    const user =
        await requireUser();

    return user.uid;

}


// ============================================================
// FIREBASE DATABASE LOCATION
// ============================================================

function securityRef(uid) {

    return ref(

        getDb(),

        `user_settings/${uid}/internal_passcode`

    );

}


// ============================================================
// LOAD PASSCODE RECORD
// ============================================================

async function loadRecord(
    {
        force = false
    } = {}
) {

    const cacheStillValid =

        cachedRecord !== null &&

        (
            Date.now() - cachedAt
            <
            CACHE_TTL_MS
        );


    if (
        !force &&
        cacheStillValid
    ) {

        return cachedRecord;

    }


    const uid =
        await requireUid();


    const snapshot =
        await get(
            securityRef(uid)
        );


    cachedRecord =
        snapshot.exists()
            ? snapshot.val()
            : {};


    cachedAt =
        Date.now();


    return cachedRecord;

}


// ============================================================
// CLEAR CACHE
// ============================================================

function invalidateCache() {

    cachedRecord = null;

    cachedAt = 0;

}


// ============================================================
// VALIDATE NEW PASSCODE
// ============================================================

function validateNewPasscode(passcode) {

    const value =
        String(
            passcode ?? ""
        ).trim();


    if (
        value.length
        <
        MIN_LENGTH
    ) {

        throw new Error(
            `Passcode must be at least ${MIN_LENGTH} characters.`
        );

    }


    if (
        value.length
        >
        MAX_LENGTH
    ) {

        throw new Error(
            `Passcode must be at most ${MAX_LENGTH} characters.`
        );

    }


    return value;

}


// ============================================================
// VERIFY PASSCODE AGAINST HASH
// ============================================================

async function matches(
    record,
    passcode
) {

    if (
        !record ||
        !record.hash ||
        !record.salt
    ) {

        return false;

    }


    const candidate =
        await derive(

            String(passcode),

            record.salt,

            record.iterations ||
            ITERATIONS

        );


    return constantTimeEquals(

        candidate,

        record.hash

    );

}


// ============================================================
// SAVE NEW PASSCODE HASH
// ============================================================

async function saveNewPasscode(
    uid,
    passcode
) {

    const value =
        validateNewPasscode(
            passcode
        );


    const salt =
        randomHex(16);


    const hash =
        await derive(

            value,

            salt,

            ITERATIONS

        );


    await set(

        securityRef(uid),

        {

            hash,

            salt,

            iterations:
                ITERATIONS,

            algorithm:
                "PBKDF2-SHA256",

            updatedAt:
                Date.now()

        }

    );


    invalidateCache();

}


// ============================================================
// FIREBASE LOGIN PASSWORD VERIFICATION
// ============================================================

async function verifyLoginPassword(
    email,
    password
) {

    const user =
        await requireUser();


    const address =
        String(
            email ?? ""
        )
            .trim()
            .toLowerCase();


    const loginPassword =
        String(
            password ?? ""
        );


    if (!address) {

        throw new Error(
            "Enter your AssetGuard account e-mail."
        );

    }


    if (!loginPassword) {

        throw new Error(
            "Enter your AssetGuard login password."
        );

    }


    const currentEmail =
        String(
            user.email || ""
        )
            .trim()
            .toLowerCase();


    if (!currentEmail) {

        throw new Error(
            "Your signed-in account does not have an e-mail address."
        );

    }


    if (
        address !==
        currentEmail
    ) {

        throw new Error(
            "The e-mail does not match the currently signed-in AssetGuard account."
        );

    }


    const credential =
        EmailAuthProvider.credential(

            currentEmail,

            loginPassword

        );


    try {

        await reauthenticateWithCredential(

            user,

            credential

        );

    }

    catch (error) {

        const code =
            String(
                error?.code || ""
            );


        if (
            code ===
                "auth/wrong-password" ||
            code ===
                "auth/invalid-credential"
        ) {

            throw new Error(
                "The AssetGuard login password is incorrect."
            );

        }


        if (
            code ===
            "auth/user-mismatch"
        ) {

            throw new Error(
                "These credentials do not belong to the current account."
            );

        }


        if (
            code ===
            "auth/too-many-requests"
        ) {

            throw new Error(
                "Too many incorrect password attempts. Please wait and try again."
            );

        }


        if (
            code ===
            "auth/invalid-email"
        ) {

            throw new Error(
                "The e-mail address is invalid."
            );

        }


        throw new Error(

            error?.message ||

            "Account verification failed. Please try again."

        );

    }


    return true;

}


// ============================================================
// PUBLIC API
// ============================================================

const AGPasscode = {


    // --------------------------------------------------------
    // PUBLIC SETTINGS
    // --------------------------------------------------------

    NOT_CONFIGURED_MESSAGE,

    RECOVERY_REQUIRED_MESSAGE,

    MIN_LENGTH,

    MAX_LENGTH,


    // --------------------------------------------------------
    // CHECK WHETHER PASSCODE EXISTS
    // --------------------------------------------------------

    async isConfigured() {

        const record =
            await loadRecord();


        return Boolean(

            record &&
            record.hash

        );

    },


    // --------------------------------------------------------
    // VERIFY INTERNAL PASSCODE
    // --------------------------------------------------------

    async verify(passcode) {

        const value =
            String(
                passcode ?? ""
            );


        let record;


        try {

            record =
                await loadRecord();

        }

        catch (error) {

            if (
                globalThis.AGErrors
            ) {

                AGErrors.report(

                    "internal passcode verification",

                    error

                );

            }


            const message =
                String(

                    error &&
                    (
                        error.code ||
                        error.message
                    )

                    ||
                    ""

                )
                    .toLowerCase();


            const permissionDenied =
                message.includes(
                    "permission"
                );


            return {

                ok: false,

                reason:
                    "unavailable",

                message:

                    permissionDenied

                        ?

                        "Security settings are unreachable. Check Firebase rules for user_settings."

                        :

                        (

                            error.message ||

                            "Security check unavailable. Check your connection and retry."

                        )

            };

        }


        if (
            !record ||
            !record.hash
        ) {

            return {

                ok: false,

                reason:
                    "not_set",

                message:
                    NOT_CONFIGURED_MESSAGE

            };

        }


        if (!value) {

            return {

                ok: false,

                reason:
                    "empty",

                message:
                    "Enter your internal passcode."

            };

        }


        if (
            await matches(

                record,

                value

            )
        ) {

            return {

                ok: true,

                reason:
                    "ok",

                message:
                    ""

            };

        }


        return {

            ok: false,

            reason:
                "mismatch",

            message:
                "Incorrect passcode."

        };

    },


    // --------------------------------------------------------
    // SIMPLE BOOLEAN CHECK
    // --------------------------------------------------------

    async check(passcode) {

        try {

            const result =
                await this.verify(
                    passcode
                );


            return result.ok;

        }

        catch (error) {

            if (
                globalThis.AGErrors
            ) {

                AGErrors.report(

                    "internal passcode verification",

                    error

                );

            }


            return false;

        }

    },


    // --------------------------------------------------------
    // NORMAL PASSCODE CHANGE
    // --------------------------------------------------------

    async setPasscode(
        newPasscode,
        {
            currentPasscode = null
        } = {}
    ) {

        const value =
            validateNewPasscode(
                newPasscode
            );


        const user =
            await requireUser();


        const record =
            await loadRecord({

                force: true

            });


        // If an internal passcode already exists,
        // require the existing passcode.

        if (
            record &&
            record.hash
        ) {

            const valid =
                await matches(

                    record,

                    currentPasscode ?? ""

                );


            if (!valid) {

                throw new Error(
                    "Current passcode is incorrect."
                );

            }

        }


        await saveNewPasscode(

            user.uid,

            value

        );

    },


    // --------------------------------------------------------
    // QUOTA-FREE PASSCODE RECOVERY
    // --------------------------------------------------------
    //
    // The user's Firebase login password verifies identity.
    //
    // No e-mail.
    // No reset link.
    // No Firebase e-mail quota.
    //
    // --------------------------------------------------------

    async recoverWithLoginPassword(
        {

            email,

            loginPassword,

            newPasscode

        } = {}
    ) {

        const value =
            validateNewPasscode(
                newPasscode
            );


        const user =
            await requireUser();


        // Verify normal Firebase login credentials.

        await verifyLoginPassword(

            email,

            loginPassword

        );


        // After successful Firebase re-authentication,
        // replace the internal passcode.

        await saveNewPasscode(

            user.uid,

            value

        );


        return {

            ok: true,

            message:
                "Internal passcode successfully reset."

        };

    },


    // --------------------------------------------------------
    // VERIFY LOGIN PASSWORD ONLY
    // --------------------------------------------------------

    async verifyLoginPassword(
        email,
        password
    ) {

        return await verifyLoginPassword(

            email,

            password

        );

    },


    // --------------------------------------------------------
    // CURRENT ACCOUNT INFORMATION
    // --------------------------------------------------------

    async getCurrentAccount() {

        const user =
            await requireUser();


        return {

            uid:
                user.uid,

            email:
                user.email || ""

        };

    },


    // --------------------------------------------------------
    // FORCE REFRESH
    // --------------------------------------------------------

    refresh() {

        invalidateCache();

    }

};


// ============================================================
// GLOBAL ACCESS
// ============================================================

globalThis.AGPasscode =
    AGPasscode;


globalThis.AGPasscodeReady =
    Promise.resolve(
        AGPasscode
    );


export default AGPasscode;