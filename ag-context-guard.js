// Blocks the browser's long-press / right-click menu (Save, Share, Print, Download)
// on empty areas of the app. Text fields, editable areas and anything explicitly
// marked with data-allow-context keep their native menu.
(function () {
    const ALLOWED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "OPTION"]);

    function isInteractiveTarget(target) {
        if (!target || target.nodeType !== 1) return false;
        if (ALLOWED_TAGS.has(target.tagName)) return true;
        if (target.isContentEditable) return true;
        return Boolean(target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [data-allow-context]"));
    }

    function hasTextSelection() {
        const selection = window.getSelection();
        return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
    }

    document.addEventListener("contextmenu", (event) => {
        if (isInteractiveTarget(event.target)) return;
        if (hasTextSelection()) return;
        event.preventDefault();
    });

    document.addEventListener("dragstart", (event) => {
        if (isInteractiveTarget(event.target)) return;
        event.preventDefault();
    });

    const style = document.createElement("style");
    style.textContent = `
        body { -webkit-touch-callout: none; }
        input, textarea, select, [contenteditable='true'], [data-allow-context] { -webkit-touch-callout: default; }
    `;
    (document.head || document.documentElement).appendChild(style);
})();


// Keep the current page visible while the next protected page loads.
(function installFastShellNavigation() {
    if (window.top !== window) return;

    function install() {
        const first = document.getElementById("content-frame");
        if (!first || document.getElementById("content-frame-next")) return;

        const host = first.parentElement;
        const stack = document.createElement("div");
        stack.style.cssText = "position:relative;flex:1;min-height:0;background:#f0f2f5";
        host.replaceChild(stack, first);
        first.style.cssText += ";position:absolute;inset:0;width:100%;height:100%;border:0;background:#f0f2f5;opacity:1;transition:opacity .12s ease";
        stack.appendChild(first);

        const second = document.createElement("iframe");
        second.id = "content-frame-next";
        second.title = "AssetGuard page preview";
        second.setAttribute("aria-hidden", "true");
        second.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#f0f2f5;opacity:0;pointer-events:none;transition:opacity .12s ease";
        stack.appendChild(second);

        let active = first;
        let standby = second;
        let activePage = first.getAttribute("src") || "dashboard.html";
        let navigationId = 0;
        active.dataset.page = activePage;

        function swapToReadyFrame(frame, page) {
            if (frame !== standby || frame.dataset.page !== page) return;
            const oldFrame = active;
            frame.style.opacity = "1";
            frame.style.pointerEvents = "auto";
            frame.removeAttribute("aria-hidden");
            oldFrame.style.opacity = "0";
            oldFrame.style.pointerEvents = "none";
            oldFrame.setAttribute("aria-hidden", "true");
            active = frame;
            standby = oldFrame;
            activePage = page;
        }

        window.addEventListener("message", function (event) {
            if (event.origin !== window.location.origin) return;
            const frame = event.source === active.contentWindow ? active : event.source === standby.contentWindow ? standby : null;
            if (!frame || !event.data || event.data.type !== "assetguard:page-ready") return;
            if (frame === standby) swapToReadyFrame(frame, frame.dataset.page);
        });

        window.loadPage = function (page, title) {
            document.getElementById("view-title").innerText = title;
            window.toggleMenu();
            if (page === activePage) return;

            const frame = standby;
            const requestId = ++navigationId;
            frame.dataset.page = page;
            frame.dataset.ready = "false";
            frame.style.opacity = "0";
            frame.style.pointerEvents = "none";
            frame.setAttribute("aria-hidden", "true");
            frame.onload = function () {
                window.setTimeout(function () {
                    if (requestId !== navigationId || frame.dataset.page !== page || frame.dataset.ready === "true") return;
                    const child = frame.contentDocument;
                    if (child && child.readyState === "complete" && child.documentElement.style.visibility !== "hidden") {
                        frame.dataset.ready = "true";
                        swapToReadyFrame(frame, page);
                    }
                }, 1200);
            };
            frame.src = page;
        };
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
})();


// Settings writes must merge into user_settings so internal_passcode is never deleted.
(function protectInternalPasscodeDuringSettingsSave() {
    if (!/\/settings\.html$/.test(window.location.pathname)) return;

    function install() {
        if (!globalThis.firebase || !firebase.database) return;
        const reference = firebase.database().ref();
        const prototype = Object.getPrototypeOf(reference);
        if (!prototype || prototype.__agSettingsSetProtected) return;
        if (typeof prototype.set !== "function" || typeof prototype.update !== "function") return;

        const originalSet = prototype.set;
        prototype.set = function (value) {
            const url = typeof this.toString === "function" ? this.toString() : "";
            if (/\/user_settings\/[^/]+$/.test(url)) return this.update(value);
            return originalSet.call(this, value);
        };
        prototype.__agSettingsSetProtected = true;
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { setTimeout(install, 0); }, { once: true });
    } else {
        setTimeout(install, 0);
    }
})();
