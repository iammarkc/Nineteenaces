(function () {
    const menuButton = document.getElementById("changePasswordMenuBtn");
    const modal = document.getElementById("changePasswordModal");
    const saveButton = document.getElementById("savePasswordBtn");
    const cancelButton = document.getElementById("cancelPasswordBtn");
    const newInput = document.getElementById("newPasswordInput");
    const confirmInput = document.getElementById("confirmPasswordInput");

    if (!menuButton || !modal || !saveButton || !cancelButton) return;

    function getStoredAccounts() {
        try {
            return JSON.parse(localStorage.getItem("userAccounts") || "{}");
        } catch (error) {
            return {};
        }
    }

    function isGitHubPages() {
        const hostname = window.location.hostname || "";
        return hostname === "github.io" || hostname.endsWith(".github.io");
    }

    function closeModal() {
        modal.classList.remove("active");
        modal.style.display = "none";
        newInput.value = "";
        confirmInput.value = "";
    }

    menuButton.addEventListener("click", () => {
        modal.classList.add("active");
        modal.style.display = "flex";
        newInput.focus();
    });
    cancelButton.addEventListener("click", closeModal);
    modal.addEventListener("click", event => {
        if (event.target === modal) closeModal();
    });

    saveButton.addEventListener("click", async () => {
        const username = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser");
        const accounts = getStoredAccounts();
        const account = accounts[username];
        const newPassword = newInput.value;

        if (!account || !username) {
            alert("Your account could not be found.");
            return;
        }
        if (!newPassword || newPassword !== confirmInput.value) {
            alert("Enter matching new passwords.");
            return;
        }
        if (newPassword.length < 6) {
            alert("The new password must be at least 6 characters.");
            return;
        }

        try {
            let storedPassword;
            if (window.passwordSecurity) {
                try {
                    storedPassword = await window.passwordSecurity.hash(newPassword);
                } catch (hashError) {
                    console.warn("Browser password hashing unavailable; using the local secure hash endpoint.", hashError);
                }
            }

            if (!storedPassword && !isGitHubPages() && window.location.hostname) {
                const hashResponse = await fetch(`${window.location.protocol}//${window.location.hostname}:3100/api/hash-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password: newPassword })
                });
                if (!hashResponse.ok) throw new Error(`Password hash failed: ${hashResponse.status}`);
                storedPassword = (await hashResponse.json()).passwordHash;
            }

            if (!storedPassword) {
                throw new Error("Secure password hashing is unavailable.");
            }

            accounts[username] = { ...account, password: storedPassword };
            localStorage.setItem("userAccounts", JSON.stringify(accounts));

            if (window.sharedAccounts) {
                await window.sharedAccounts.save({ [username]: accounts[username] });
            } else {
                throw new Error("Firestore account service is unavailable.");
            }

            if (window.updateSqlitePassword) {
                try {
                    await window.updateSqlitePassword(username, storedPassword);
                } catch (sqliteError) {
                    console.warn("Optional SQLite password sync failed after Firestore saved the password.", sqliteError);
                }
            }

            if (!isGitHubPages() && window.location.hostname) {
                const response = await fetch(`${window.location.protocol}//${window.location.hostname}:3100/api/change-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, newPassword, passwordHash: storedPassword })
                });
                if (!response.ok) {
                    throw new Error(`Password save failed: ${response.status}`);
                }
            }
        } catch (error) {
            console.error("Password change failed.", error);
            alert(`The password could not be saved. ${error.message || "Please try again."}`);
            return;
        }

        closeModal();
        alert("Password changed successfully.");
    });
})();
