(function () {
    if (window.self !== window.top || !window.sharedAnnouncements) return;

    const username = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser");
    const accounts = JSON.parse(localStorage.getItem("userAccounts") || "{}");
    const account = accounts[username];
    if (!username || !account || account.disabled) return;

    const canAnnounce = username === "admin" || account.role === "Developer" ||
        (Array.isArray(account.permissions) && account.permissions.includes("announcement"));
    const menu = document.querySelector("#adminMenu + .dropdown-menu");
    const originalTitle = document.title;
    let lastCheckedAt = Date.now();

    const styles = document.createElement("style");
    styles.textContent = `
        .announcement-overlay { position: fixed; inset: 0; z-index: 6500; display: none; align-items: center; justify-content: center; padding: 18px; background: rgba(7, 17, 24, .68); }
        .announcement-overlay.is-open { display: flex; }
        .announcement-dialog { width: min(520px, 100%); max-height: min(90vh, 680px); overflow: auto; background: var(--app-surface, #fff); color: var(--app-text, #18344a); border: 1px solid var(--app-border, #d6e0e5); border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.28); }
        .announcement-dialog header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--app-border, #d6e0e5); }
        .announcement-dialog h2 { margin: 0; font-size: 19px; }
        .announcement-dialog-body { padding: 18px 20px 20px; }
        .announcement-dialog textarea { width: 100%; min-height: 150px; resize: vertical; padding: 11px 12px; border: 1px solid var(--app-border, #c7d4da); border-radius: 5px; color: inherit; background: var(--app-surface, #fff); font: inherit; }
        .announcement-dialog p { margin: 0 0 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .announcement-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
        .announcement-status { min-height: 20px; margin: 9px 0 0; color: #b42318; font-size: 13px; }
    `;
    document.head.append(styles);

    const makeOverlay = (id, title, content) => {
        const overlay = document.createElement("div");
        overlay.className = "announcement-overlay";
        overlay.id = id;
        overlay.innerHTML = `<section class="announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}Title"><header><h2 id="${id}Title">${title}</h2><button type="button" class="btn btn-sm btn-outline-secondary" data-announcement-close aria-label="Close">&times;</button></header><div class="announcement-dialog-body">${content}</div></section>`;
        document.body.append(overlay);
        overlay.addEventListener("click", event => {
            if (event.target === overlay || event.target.closest("[data-announcement-close]")) closeOverlay(overlay);
        });
        return overlay;
    };

    const composer = makeOverlay("announcementComposer", "Make an Announcement", `
        <label class="form-label" for="announcementMessage">Message</label>
        <textarea id="announcementMessage" maxlength="2000" placeholder="Type the message to announce" required></textarea>
        <p class="announcement-status" id="announcementStatus" role="status"></p>
        <footer><button type="button" class="btn btn-secondary" data-announcement-close>Cancel</button><button type="button" class="btn btn-primary" id="sendAnnouncementBtn"><i class="bi bi-megaphone me-1"></i>Send announcement</button></footer>
    `);
    const receiver = makeOverlay("announcementReceiver", "Announcement", `
        <p id="announcementReceivedMessage"></p>
        <footer><button type="button" class="btn btn-primary" id="dismissAnnouncementBtn">Got it</button></footer>
    `);

    function closeOverlay(overlay) {
        overlay.classList.remove("is-open");
        if (!document.querySelector(".announcement-overlay.is-open")) document.title = originalTitle;
    }

    if (canAnnounce && menu) {
        const entry = document.createElement("li");
        entry.innerHTML = '<button class="dropdown-item" type="button" id="makeAnnouncementBtn"><i class="bi bi-megaphone me-2" aria-hidden="true"></i>Make an Announcement</button>';
        const divider = menu.querySelector(".dropdown-divider")?.closest("li");
        menu.insertBefore(entry, divider || menu.firstChild);
        entry.querySelector("button").addEventListener("click", event => {
            event.preventDefault();
            document.getElementById("announcementMessage").value = "";
            document.getElementById("announcementStatus").textContent = "";
            composer.classList.add("is-open");
            document.getElementById("announcementMessage").focus();
        });
    }

    document.getElementById("sendAnnouncementBtn").addEventListener("click", async () => {
        const message = document.getElementById("announcementMessage").value.trim();
        const status = document.getElementById("announcementStatus");
        const currentAccounts = JSON.parse(localStorage.getItem("userAccounts") || "{}");
        const currentAccount = currentAccounts[username];
        const allowed = username === "admin" || currentAccount?.role === "Developer" ||
            (Array.isArray(currentAccount?.permissions) && currentAccount.permissions.includes("announcement"));
        if (!allowed) {
            status.textContent = "You do not have permission to send announcements.";
            return;
        }
        if (!message) {
            status.textContent = "Enter a message before sending.";
            return;
        }

        const button = document.getElementById("sendAnnouncementBtn");
        button.disabled = true;
        status.textContent = "Sending...";
        try {
            const createdAt = Date.now();
            await window.sharedAnnouncements.send({
                id: `${createdAt}-${Math.random().toString(36).slice(2, 10)}`,
                message,
                sender: currentAccount?.name || username,
                senderUsername: username,
                createdAt
            });
            closeOverlay(composer);
        } catch (error) {
            console.error("Announcement could not be sent.", error);
            status.textContent = /403|permission|denied/i.test(String(error.message))
                ? "Firestore denied announcement access. Deploy the announcements rule from firestore.rules, then try again."
                : "Unable to send. Check your connection and try again.";
        } finally {
            button.disabled = false;
        }
    });

    function buzz() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        try {
            const context = new AudioContext();
            void context.resume();
            const startAt = context.currentTime;
            [0, 0.2, 0.4].forEach(offset => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                oscillator.type = "square";
                oscillator.frequency.setValueAtTime(740, startAt + offset);
                gain.gain.setValueAtTime(0.0001, startAt + offset);
                gain.gain.exponentialRampToValueAtTime(0.12, startAt + offset + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.12);
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(startAt + offset);
                oscillator.stop(startAt + offset + 0.13);
            });
            window.setTimeout(() => context.close(), 900);
        } catch (error) {
            console.warn("Announcement sound could not be played.", error);
        }
    }

    function claimAnnouncement(id) {
        const key = `announcementSeen:${username}`;
        let seen = [];
        try {
            seen = JSON.parse(localStorage.getItem(key) || "[]");
        } catch (error) {
            seen = [];
        }
        if (seen.includes(id)) return false;
        seen.push(id);
        localStorage.setItem(key, JSON.stringify(seen.slice(-50)));
        return true;
    }

    document.getElementById("dismissAnnouncementBtn").addEventListener("click", () => closeOverlay(receiver));
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") document.querySelectorAll(".announcement-overlay.is-open").forEach(closeOverlay);
    });

    async function checkAnnouncements() {
        try {
            const announcements = await window.sharedAnnouncements.loadSince(lastCheckedAt);
            if (announcements.length) {
                lastCheckedAt = Math.max(...announcements.map(announcement => Number(announcement.createdAt) || 0));
                const incoming = announcements.filter(announcement => announcement.senderUsername !== username && claimAnnouncement(announcement.id));
                if (incoming.length) {
                    document.getElementById("announcementReceivedMessage").textContent = incoming
                        .map(announcement => [announcement.sender, announcement.message].filter(Boolean).join(": "))
                        .join("\n\n");
                    receiver.classList.add("is-open");
                    document.title = `Announcement: ${originalTitle}`;
                    if (document.hidden) window.focus();
                    buzz();
                }
            }
        } catch (error) {
            console.warn("Announcements could not be checked.", error);
        }
    }

    window.setInterval(checkAnnouncements, 5000 + Math.random() * 1000);
})();