(function () {
    function getInventoryRedirect(account) {
        const permissions = Array.isArray(account.permissions)
            ? account.permissions.map(permission => String(permission).trim().toLowerCase())
            : [];
        const inventoryAccess = Array.isArray(account.inventoryAccess)
            ? account.inventoryAccess.map(value => String(value).trim().toLowerCase())
            : [];

        if (permissions.includes("attendance") && (!permissions.includes("inventory") || !inventoryAccess.length)) {
            return "attendance.html";
        }

        const office = inventoryAccess.includes("rizal")
            ? "Rizal"
            : inventoryAccess.includes("cebu")
                ? "Cebu"
                : typeof account.office === "string" && ["rizal", "cebu"].includes(account.office.trim().toLowerCase())
                    ? account.office.trim().replace(/^./, character => character.toUpperCase())
                    : null;
        return office ? `inventory.html?office=${encodeURIComponent(office)}` : "inventory.html";
    }

    function showLoginMessage(message, isError = true) {
        const messageElement = document.getElementById("divMessage");
        messageElement.textContent = message;
        messageElement.style.color = isError ? "red" : "green";
    }

    function formatAuthError(error) {
        const message = String(error?.message || "");
        if (/INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/i.test(message)) {
            return "Invalid email or password.";
        }
        if (/USER_DISABLED/i.test(message)) {
            return "This account is disabled in one of the Firebase projects.";
        }
        if (/OPERATION_NOT_ALLOWED/i.test(message)) {
            return "Email/Password sign-in must be enabled in all three Firebase projects.";
        }
        if (/NETWORK_REQUEST_FAILED|Failed to fetch/i.test(message)) {
            return "Could not reach Firebase. Check your connection and Firebase authorized domains.";
        }
        return message || "Sign-in failed. Please try again.";
    }

    async function login() {
        const email = document.getElementById("UsernameInput").value.trim();
        const password = document.getElementById("PasswordInput").value;
        const signInButton = document.getElementById("SignInButton");

        if (!email || !password) {
            showLoginMessage("Enter your email and password.");
            return;
        }

        signInButton.disabled = true;
        try {
            const { uid, profile } = await window.firebaseServices.signIn(email, password);
            const username = String(profile.username);
            const accounts = { [username]: { ...profile, username, uid } };
            localStorage.setItem("userAccounts", JSON.stringify(accounts));
            localStorage.setItem("loggedInUser", username);
            if (!window.authSession?.set(username, uid)) {
                throw new Error("Secure browser session storage is unavailable. Enable site storage and try again.");
            }

            showLoginMessage("Sign-in successful.", false);
            window.setTimeout(() => {
                window.location.assign(getInventoryRedirect(profile));
            }, 300);
        } catch (error) {
            window.firebaseServices.signOut();
            showLoginMessage(formatAuthError(error));
        } finally {
            signInButton.disabled = false;
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        const form = document.getElementById("form1");
        const passwordInput = document.getElementById("PasswordInput");
        const togglePasswordIcon = document.getElementById("togglePasswordIcon");

        form?.addEventListener("submit", event => {
            event.preventDefault();
            login();
        });
        togglePasswordIcon?.addEventListener("click", () => {
            passwordInput.type = passwordInput.type === "password" ? "text" : "password";
            window.setLucideIcon?.(togglePasswordIcon, passwordInput.type === "password" ? "eye" : "eye-off");
        });
    });
})();
