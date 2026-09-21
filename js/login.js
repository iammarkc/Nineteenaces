function getLocation(callback) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(callback, showError);
    } else {
        console.log("Geolocation is not supported by this browser.");
    }
}

function showPosition(position) {
    document.getElementById("HiddenCoordinates").value = position.coords.latitude + "," + position.coords.longitude;
    //alert(document.getElementById("HiddenCoordinates").value);
    //alert("Latitude: " + position.coords.latitude + "\nLongitude: " + position.coords.longitude);
}

function showError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            //alert("User denied the request for Geolocation.");
            break;
        case error.POSITION_UNAVAILABLE:
            //alert("Location information is unavailable.");
            break;
        case error.TIMEOUT:
            //alert("The request to get user location timed out.");
            break;
        case error.UNKNOWN_ERROR:
            //alert("An unknown error occurred.");
            break;
    }
}

// Remove the old DOMContentLoaded getLocation call
// document.addEventListener("DOMContentLoaded", getLocation);

document.addEventListener("DOMContentLoaded", function () {
    getLocation(showPosition);
});

function readStoredValue(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        try {
            return sessionStorage.getItem(key);
        } catch (sessionError) {
            return null;
        }
    }
}

function writeStoredValue(key, value) {
    try {
        localStorage.setItem(key, value);
        return;
    } catch (error) {
        try {
            sessionStorage.setItem(key, value);
        } catch (sessionError) {
            // Ignore storage errors in restricted/private browsing modes.
        }
    }
}

function storeLoginSession(username) {
    if (window.authSession) {
        window.authSession.set(username);
        return;
    }
    writeStoredValue("loggedInUser", username);
}

function getInventoryRedirect(account) {
    const permissions = Array.isArray(account && account.permissions)
        ? account.permissions.map(permission => String(permission).trim().toLowerCase())
        : [];

    const hasInventoryAccess = Array.isArray(account && account.inventoryAccess)
        ? account.inventoryAccess.length > 0
        : Boolean(account && account.office);

    if (permissions.includes("attendance") && (!permissions.includes("inventory") || !hasInventoryAccess)) {
        return "attendance.html";
    }

    const inventoryAccess = Array.isArray(account && account.inventoryAccess)
        ? account.inventoryAccess.map(value => String(value).trim().toLowerCase())
        : [];
    const office = inventoryAccess.includes("rizal")
        ? "Rizal"
        : inventoryAccess.includes("cebu")
            ? "Cebu"
            : account && typeof account.office === "string" && ["rizal", "cebu"].includes(account.office.trim().toLowerCase())
                ? account.office.trim().replace(/^./, character => character.toUpperCase())
                : null;

    return office ? `inventory.html?office=${encodeURIComponent(office)}` : "inventory.html";
}

const DEFAULT_ACCOUNT_SEED = {
    admin: {
        name: "System Administrator",
        username: "admin",
        email: "admin@system.com",
        password: "Admin123!",
        role: "Developer",
        permissions: ["inventory"],
        office: "",
        inventoryAccess: ["Rizal", "Cebu"],
        disabled: false
    },
    testuser: {
        name: "Test User",
        username: "testuser",
        email: "testuser@system.com",
        password: "Test123!",
        role: "User",
        permissions: ["inventory"],
        office: "Rizal",
        inventoryAccess: ["Rizal"],
        disabled: false
    },
    demo: {
        name: "Demo User",
        username: "demo",
        email: "demo@system.com",
        password: "Demo123!",
        role: "User",
        permissions: ["inventory"],
        office: "Cebu",
        inventoryAccess: ["Cebu"],
        disabled: false
    }
};

function ensureDefaultAdminAccount() {
    const storedAccounts = JSON.parse(readStoredValue("userAccounts") || "{}") || {};
    const accounts = { ...DEFAULT_ACCOUNT_SEED, ...storedAccounts };

    if (!storedAccounts.admin) {
        writeStoredValue("userAccounts", JSON.stringify(accounts));
    }

    return accounts;
}

// Test credentials for development
const TEST_CREDENTIALS = {
    "testuser": "Test123!",
    "admin": "Admin123!",
    "demo": "Demo123!"
};

function isLocalBackendHost() {
    const hostname = window.location.hostname || "";
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function getBackendApiUrl(pathname = '/api/login') {
    const hostname = window.location.hostname || '';

    if (!isLocalBackendHost()) {
        return null;
    }

    const protocol = window.location.protocol || 'http:';
    const host = window.location.hostname || 'localhost';
    const backendOrigin = `${protocol}//${host}:3100`;

    return `${backendOrigin}${pathname}`;
}

async function loadStaticAccountSeed() {
    try {
        const response = await fetch('data/accounts.json', { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }

        const accounts = await response.json();
        return accounts && typeof accounts === 'object' ? accounts : null;
    } catch (error) {
        console.warn('Static account seed unavailable.', error);
        return null;
    }
}

async function loadSharedAccountSeed() {
    if (!window.sharedAccounts) return null;

    try {
        const accounts = await window.sharedAccounts.load();
        return accounts && typeof accounts === "object" ? accounts : null;
    } catch (error) {
        console.warn("Shared account store unavailable.", error);
        return null;
    }
}

async function login() {
    // Check for test credentials (development mode)
    const inputValue = document.getElementById("UsernameInput").value.trim();
    const password = document.getElementById("PasswordInput").value.trim();
    const messageDiv = document.getElementById("divMessage");
    let accounts = ensureDefaultAdminAccount();
    const backendUrl = getBackendApiUrl('/api/login');

    if (!inputValue || !password) {
        messageDiv.textContent = "✗ Please enter both username and password";
        messageDiv.style.color = "red";
        return;
    }

    let backendMessage = null;

    if (backendUrl) {
        try {
            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    usernameOrEmail: inputValue,
                    password: password
                })
            });

            const result = await response.json();

            if (result.ok) {
                messageDiv.textContent = "✓ Login successful!";
                messageDiv.style.color = "green";

                storeLoginSession(result.account.username);
                writeStoredValue("userAccounts", JSON.stringify(result.accounts || {}));

                setTimeout(function() {
                    window.location.href = getInventoryRedirect(result.account);
                }, 500);

                console.log("Stored backend account login: " + result.account.username);
                return;
            }

            backendMessage = result.message || "Invalid credentials";
        } catch (error) {
            console.warn("Backend login unavailable, falling back to local login flow.", error);
        }
    }

    const staticAccounts = await loadStaticAccountSeed();
    if (staticAccounts) {
        const storedAccounts = JSON.parse(readStoredValue("userAccounts") || "{}") || {};
        accounts = { ...staticAccounts, ...storedAccounts };
        writeStoredValue("userAccounts", JSON.stringify(accounts));
    }

    const sharedAccounts = await loadSharedAccountSeed();
    if (sharedAccounts) {
        const storedAccounts = JSON.parse(readStoredValue("userAccounts") || "{}") || {};
        accounts = { ...accounts, ...storedAccounts, ...sharedAccounts };
        writeStoredValue("userAccounts", JSON.stringify(accounts));
    }

    let sqliteResult = { status: "fallback" };

    if (window.trySqliteLogin) {
        try {
            sqliteResult = await window.trySqliteLogin(inputValue, password);
        } catch (error) {
            console.warn("SQLite login failover triggered.", error);
        }
    }

    if (sqliteResult.status === "success") {
        messageDiv.textContent = "✓ Login successful!";
        messageDiv.style.color = "green";

        storeLoginSession(sqliteResult.account.username);

        setTimeout(function() {
            const account = accounts[sqliteResult.account.username] || sqliteResult.account;
            window.location.href = getInventoryRedirect(account);
        }, 500);

        console.log("Stored SQLite account login: " + sqliteResult.account.username);
        return;
    }

    if (sqliteResult.status === "disabled") {
        messageDiv.textContent = "✗ This account has been disabled by an administrator.";
        messageDiv.style.color = "red";
        return;
    }

    const normalizedInput = inputValue.toLowerCase();
    let matchedUsername = null;
    let storedAccount = null;

    const usernameMatch = Object.keys(accounts).find(usernameKey => usernameKey.toLowerCase() === normalizedInput);
    if (usernameMatch) {
        matchedUsername = usernameMatch;
        storedAccount = accounts[usernameMatch];
    } else {
        const emailMatch = Object.keys(accounts).find(usernameKey => {
            const account = accounts[usernameKey];
            return account && typeof account.email === 'string' && account.email.toLowerCase() === normalizedInput;
        });

        if (emailMatch) {
            matchedUsername = emailMatch;
            storedAccount = accounts[emailMatch];
        }
    }

    if (storedAccount && storedAccount.disabled) {
        messageDiv.textContent = "✗ This account has been disabled by an administrator.";
        messageDiv.style.color = "red";
        return;
    }

    const storedPasswordMatches = storedAccount && window.passwordSecurity
        ? await window.passwordSecurity.verify(password, storedAccount.password)
        : storedAccount && storedAccount.password === password;

    if (storedAccount && storedPasswordMatches) {
        messageDiv.textContent = "✓ Login successful!";
        messageDiv.style.color = "green";

        storeLoginSession(matchedUsername);

        setTimeout(function() {
            window.location.href = getInventoryRedirect(storedAccount);
        }, 500);

        console.log("Stored account login: " + matchedUsername);
        return;
    }

    const testUsername = Object.keys(TEST_CREDENTIALS).find(username => username.toLowerCase() === normalizedInput);
    if (testUsername && TEST_CREDENTIALS[testUsername] === password) {
        messageDiv.textContent = "✓ Test login successful! (Dev Mode)";
        messageDiv.style.color = "green";

        const accountName = testUsername.toLowerCase() === "admin" ? "admin" : testUsername;
        storeLoginSession(accountName);

        if (inputValue.toLowerCase() === "admin") {
            ensureDefaultAdminAccount();
        }
        
        setTimeout(function() {
            const account = accounts[accountName] || { username: accountName };
            window.location.href = getInventoryRedirect(account);
        }, 500);
        
        console.log("Test login: " + inputValue);
        return;
    }
    
    messageDiv.textContent = backendMessage ? `✗ ${backendMessage}` : "✗ Invalid credentials";
    messageDiv.style.color = "red";
}

document.addEventListener("DOMContentLoaded", function () {
    getLocation(showPosition);

    const form = document.getElementById("form1");
    const pwd = document.getElementById("PasswordInput");
    const icon = document.getElementById("togglePasswordIcon");

    if (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            login();
        });
    }

    if (icon && pwd) {
        icon.addEventListener("click", function () {
            if (pwd.type === "password") {
                pwd.type = "text";
                icon.classList.replace("bi-eye", "bi-eye-slash");
            } else {
                pwd.type = "password";
                icon.classList.replace("bi-eye-slash", "bi-eye");
            }
        });
    }
});
