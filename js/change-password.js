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

        accounts[username] = { ...account, password: newPassword };
        localStorage.setItem("userAccounts", JSON.stringify(accounts));

        if (!isGitHubPages() && window.location.hostname) {
            try {
                await fetch(`${window.location.protocol}//${window.location.hostname}:3100/api/change-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, newPassword })
                });
            } catch (error) {
                // Local storage already contains the updated password.
            }
        }

        closeModal();
        alert("Password changed successfully.");
    });
})();
