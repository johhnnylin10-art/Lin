globalThis.AGUtils = {
    resolveActiveUID({ fallback = "global_terminal_user", persist = true } = {}) {
        let uid = null;
        const isMissing = (value) => value == null || ["", "null", "undefined"].includes(String(value).trim());

        try {
            const params = new URLSearchParams(window.location.search);
            for (const key of ["uid", "user", "currentUID", "userId"]) {
                const value = params.get(key);
                if (!isMissing(value)) {
                    uid = value.trim();
                    break;
                }
            }
        } catch (_) {}

        if (isMissing(uid)) {
            try {
                if (window.AppInventor && typeof window.AppInventor.getWebViewString === "function") {
                    const raw = window.AppInventor.getWebViewString();
                    if (!isMissing(raw)) {
                        const trimmed = String(raw).trim();
                        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                            try {
                                const parsed = JSON.parse(trimmed);
                                uid = parsed && (parsed.uid || parsed.userId || parsed.username) || raw;
                            } catch (_) {
                                uid = raw;
                            }
                        } else {
                            uid = raw;
                        }
                    }
                }
            } catch (_) {}
        }

        if (isMissing(uid)) {
            try {
                uid = localStorage.getItem("ag_active_uid");
            } catch (_) {}
        }
        if (isMissing(uid)) uid = fallback;
        uid = String(uid).trim();
        if (persist) {
            try {
                localStorage.setItem("ag_active_uid", uid);
            } catch (_) {}
        }
        return uid;
    },

    getActiveUID({ fallback = null, persist = false } = {}) {
        let uid = null;
        try {
            uid = localStorage.getItem("ag_active_uid");
        } catch (_) {}
        if (uid == null || ["", "null", "undefined"].includes(String(uid).trim())) uid = fallback;
        if (uid != null) uid = String(uid).trim();
        if (persist && uid != null) {
            try {
                localStorage.setItem("ag_active_uid", uid);
            } catch (_) {}
        }
        return uid;
    },

    userPath(uid, ...segments) {
        return ["users", uid, ...segments].join("/");
    },

    readJSON(key, fallback) {
        try {
            const value = localStorage.getItem(key);
            return value == null ? fallback : JSON.parse(value);
        } catch (_) {
            return fallback;
        }
    },

    writeJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    },

    uidKey(base, uid) {
        return `${base}_${uid}`;
    },

    formatAmount(value, { minDecimals } = {}) {
        const amount = parseFloat(value);
        if (!Number.isFinite(amount)) return "0";
        return amount.toLocaleString(undefined, minDecimals == null ? undefined : { minimumFractionDigits: minDecimals });
    },

    formatCurrency(value, { prefix = "KES", minDecimals } = {}) {
        return `${prefix} ${this.formatAmount(value, { minDecimals })}`;
    },

    parseStockQuantity(value) {
        const text = String(value ?? "").trim();
        if (!text) return null;

        const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
        if (decimalPattern.test(text)) {
            const amount = Number(text);
            return Number.isFinite(amount) ? amount : null;
        }

        const fraction = text.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\/\s*(\d+(?:\.\d*)?|\.\d+)$/);
        if (!fraction) return null;

        const denominator = Number(fraction[2]);
        if (denominator === 0) return null;
        const amount = Number(fraction[1]) / denominator;
        return Number.isFinite(amount) ? amount : null;
    },

    formatDateTime(value, { fallback = "Unknown Time", locale, options } = {}) {
        if (value == null || value === "") return fallback;
        const date = new Date(value);
        if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return fallback;
        return date.toLocaleString(locale, options);
    },

    escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (match) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        }[match]));
    },

    showToast(message, { type = "", duration = 2500, containerId = "toastContainer", elementId = "toast" } = {}) {
        const container = document.getElementById(containerId);
        if (container) {
            const toast = document.createElement("div");
            toast.className = `toast${type ? ` ${type}` : ""}`;
            toast.textContent = message;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), duration);
            return;
        }

        const toast = document.getElementById(elementId);
        if (!toast) return;
        toast.textContent = message;
        toast.className = `toast${type ? ` ${type}` : ""}`;
        toast.style.display = "block";
        clearTimeout(window.AGUtilsToastTimer);
        window.AGUtilsToastTimer = setTimeout(() => {
            toast.style.display = "none";
        }, duration);
    },

    mergePendingWithCloud(cloudRecords, pendingRecords, { sortKey = "timestamp" } = {}) {
        const cloudIds = new Set(cloudRecords.map((record) => record.id));
        const uniquePending = pendingRecords.filter((record) => !cloudIds.has(record.id));
        return [...uniquePending, ...cloudRecords].sort((a, b) => new Date(b[sortKey]) - new Date(a[sortKey]));
    },

    showAccessDenied({ message = "Access denied.", targetId } = {}) {
        const target = targetId ? document.getElementById(targetId) : document.body;
        if (target) target.innerHTML = `<div style="text-align:center;padding:40px;">${this.escapeHtml(message)}</div>`;
    }
};
