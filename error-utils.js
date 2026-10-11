(function (global) {
    function messageFor(error) {
        if (error && error.message) return error.message;
        if (typeof error === "string") return error;
        return "An unexpected error occurred.";
    }

    function report(context, error, notifyFn) {
        const message = messageFor(error);
        console.error(`[AssetGuard Error] ${context}: ${message}`, error);
        if (typeof notifyFn === "function") {
            try {
                notifyFn(message);
            } catch (notifyError) {
                console.error("[AssetGuard Error] Error notification failed:", notifyError);
            }
        }
        return message;
    }

    function isOffline(error) {
        if (global.navigator && global.navigator.onLine === false) return true;
        const code = error && (error.code || error.name || "");
        const message = messageFor(error);
        return /network|offline|disconnected|unavailable|failed to fetch|fetch failed|timeout|timed out/i.test(`${code} ${message}`);
    }

    global.AGErrors = { report, isOffline, messageFor };

    global.addEventListener("error", (event) => {
        report("Global error", event.error || event.message || event);
    });
    global.addEventListener("unhandledrejection", (event) => {
        report("Unhandled promise rejection", event.reason);
    });
})(window);
