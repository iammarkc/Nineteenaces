(function () {
    const firebaseProjects = window.firebaseProjects;
    const firebaseAuthStorageKey = "firebaseAuthTokens";
    const firebaseConfig = firebaseProjects.main;
    const firestoreRestBase = "https://firestore.googleapis.com/v1/projects/nineteenaces-8ba08/databases/(default)/documents";

    function readAuthState() {
        try {
            return JSON.parse(sessionStorage.getItem(firebaseAuthStorageKey) || "null");
        } catch (error) {
            return null;
        }
    }

    function writeAuthState(authState) {
        sessionStorage.setItem(firebaseAuthStorageKey, JSON.stringify(authState));
    }

    function clearAuthState() {
        sessionStorage.removeItem(firebaseAuthStorageKey);
    }

    function getProjectForDocumentPath(pathname) {
        const match = pathname.match(/\/documents\/(.+)$/);
        const collection = match ? decodeURIComponent(match[1].split("/")[0]) : "";
        if (collection === "attendanceRecords" || collection === "attendanceRecordDeletions" ||
            collection === "attendanceHistory" || collection === "attendanceTasks" ||
            collection === "attendanceTaskDeletions" || collection === "todoTasks") {
            return ["attendanceTodo", firebaseProjects.attendanceTodo];
        }
        const inventoryOffice = match ? decodeURIComponent(match[1].split("/")[1] || "").toLowerCase() : "";
        if ((collection === "inventoryData" || collection === "inventoryHistory") && inventoryOffice === "cebu") {
            return ["cebuInventory", firebaseProjects.cebuInventory];
        }
        return ["main", firebaseProjects.main];
    }

    async function getProjectIdToken(projectKey) {
        const authState = readAuthState();
        const projectAuth = authState?.projects?.[projectKey];
        if (!projectAuth) throw new Error("Sign in is required to access Firebase data.");
        if (projectAuth.expiresAt > Date.now() + 60_000) return projectAuth.idToken;

        const config = firebaseProjects[projectKey];
        const response = await window.fetch(`https://securetoken.googleapis.com/v1/token?key=${config.apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: projectAuth.refreshToken })
        });
        const result = await response.json();
        if (!response.ok) {
            clearAuthState();
            throw new Error(result.error?.message || `Firebase session refresh failed: ${response.status}`);
        }

        authState.projects[projectKey] = {
            idToken: result.id_token,
            refreshToken: result.refresh_token,
            expiresAt: Date.now() + Number(result.expires_in) * 1000
        };
        writeAuthState(authState);
        return result.id_token;
    }

    async function firestoreFetch(url, options = {}) {
        const requestUrl = new URL(url, window.location.href);
        const [projectKey, projectConfig] = getProjectForDocumentPath(requestUrl.pathname);
        requestUrl.pathname = requestUrl.pathname.replace(
            /\/projects\/[^/]+\/databases\//,
            `/projects/${projectConfig.projectId}/databases/`
        );
        requestUrl.searchParams.set("key", projectConfig.apiKey);
        const token = await getProjectIdToken(projectKey);
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);
        return window.fetch(requestUrl.toString(), { ...options, headers });
    }

    const fetch = firestoreFetch;

    async function firebaseAuthRequest(projectKey, endpoint, body) {
        const config = firebaseProjects[projectKey];
        const response = await window.fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${config.apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || `Firebase Authentication failed: ${response.status}`);
        return result;
    }

    async function signInToAllProjects(email, password) {
        clearAuthState();
        try {
            const entries = await Promise.all(Object.entries(firebaseProjects).map(async ([projectKey]) => {
                const result = await firebaseAuthRequest(projectKey, "accounts:signInWithPassword", {
                    email,
                    password,
                    returnSecureToken: true
                });
                return [projectKey, {
                    idToken: result.idToken,
                    refreshToken: result.refreshToken,
                    expiresAt: Date.now() + Number(result.expiresIn) * 1000,
                    uid: result.localId,
                    email: result.email
                }];
            }));
            const projects = Object.fromEntries(entries);
            writeAuthState({
                uid: projects.main.uid,
                email: projects.main.email,
                projects
            });

            const profileResponse = await fetch(
                `${firestoreRestBase}/userProfiles/${encodeURIComponent(projects.main.uid)}?key=${firebaseConfig.apiKey}`
            );
            if (profileResponse.status === 404) {
                throw new Error("Your Firebase Auth account is signed in, but its userProfiles document is missing in the main Firebase project. Create it in Firestore using your main-project UID.");
            }
            if (!profileResponse.ok) throw new Error(`User profile read failed: ${profileResponse.status}`);
            const profileDocument = await profileResponse.json();
            const profile = Object.keys(profileDocument.fields || {}).reduce((result, key) => ({
                ...result,
                [key]: fromFirestoreValue(profileDocument.fields[key])
            }), {});
            if (profile.disabled) throw new Error("This account is disabled. Contact your administrator.");
            if (!profile.username) throw new Error("The user profile must include a username.");
            return { uid: projects.main.uid, email: projects.main.email, profile };
        } catch (error) {
            clearAuthState();
            throw error;
        }
    }

    window.firebaseServices = {
        signIn: signInToAllProjects,
        signOut: clearAuthState,
        getCurrentUser() {
            const authState = readAuthState();
            return authState ? { uid: authState.uid, email: authState.email } : null;
        }
    };

    function toFirestoreValue(value) {
        if (value === null) return { nullValue: null };
        if (typeof value === "boolean") return { booleanValue: value };
        if (typeof value === "number") return { doubleValue: value };
        if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
        if (typeof value === "object") {
            return { mapValue: { fields: Object.keys(value).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(value[key]) }), {}) } };
        }
        return { stringValue: String(value) };
    }

    function fromFirestoreValue(value) {
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.integerValue !== undefined) return Number(value.integerValue);
        if (value.doubleValue !== undefined) return value.doubleValue;
        if (value.nullValue !== undefined) return null;
        if (value.arrayValue) return (value.arrayValue.values || []).map(fromFirestoreValue);
        if (value.mapValue) return Object.keys(value.mapValue.fields || {}).reduce((object, key) => ({ ...object, [key]: fromFirestoreValue(value.mapValue.fields[key]) }), {});
        return null;
    }

    async function loadFirestoreCollection(collectionPath) {
        const documents = [];
        let pageToken = "";

        do {
            const params = new URLSearchParams({ key: firebaseConfig.apiKey, pageSize: "300" });
            if (pageToken) params.set("pageToken", pageToken);
            const response = await fetch(`${firestoreRestBase}/${collectionPath}?${params.toString()}`, { cache: "no-store" });
            if (!response.ok) throw new Error(`Firestore collection read failed: ${response.status}`);
            const result = await response.json();
            documents.push(...(result.documents || []));
            pageToken = result.nextPageToken || "";
        } while (pageToken);

        return documents;
    }

    async function loadAccountsFromFirestore() {
        const documents = await loadFirestoreCollection("userProfiles");
        return documents.reduce((accounts, document) => {
            const account = Object.keys(document.fields || {}).reduce((result, key) => ({
                ...result,
                [key]: fromFirestoreValue(document.fields[key])
            }), {});
            if (account.username) accounts[account.username] = account;
            return accounts;
        }, {});
    }

    async function loadDeletedAccountUsernamesFromFirestore() {
        return new Set();
    }

    async function saveAccountsToFirestore() {
        throw new Error("Account management is disabled in the static site. Manage Firebase Authentication users and profiles in Firebase Console.");
    }

    async function saveAccountToFirestore() {
        return saveAccountsToFirestore();
    }

    async function deleteAccountFromFirestore() {
        return saveAccountsToFirestore();
    }

    async function saveAccountThemeToFirestore(username, theme) {
        const authState = readAuthState();
        if (!authState?.uid) throw new Error("Sign in is required to save the theme.");
        const params = new URLSearchParams({ key: firebaseConfig.apiKey, "updateMask.fieldPaths": "theme" });
        const response = await fetch(`${firestoreRestBase}/userProfiles/${encodeURIComponent(authState.uid)}?${params.toString()}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { theme: toFirestoreValue(theme) } })
        });
        if (!response.ok) throw new Error(`Account theme update failed: ${response.status}`);
    }

    async function loadAttendanceFromFirestore() {
        const [documents, deletedRecordIds] = await Promise.all([
            loadFirestoreCollection("attendanceRecords"),
            loadDeletedAttendanceRecordIdsFromFirestore()
        ]);
        return documents.reduce((records, document) => {
            const recordId = document.name.split("/").pop();
            if (deletedRecordIds.has(recordId)) return records;
            records[recordId] = Object.keys(document.fields || {}).reduce((record, key) => ({ ...record, [key]: fromFirestoreValue(document.fields[key]) }), {});
            return records;
        }, {});
    }

    async function loadDeletedAttendanceRecordIdsFromFirestore() {
        const documents = await loadFirestoreCollection("attendanceRecordDeletions");
        return new Set(documents.map(document => document.name.split("/").pop()));
    }

    async function saveAttendanceToFirestore(records) {
        const deletedRecordIds = await loadDeletedAttendanceRecordIdsFromFirestore();
        await Promise.all(Object.entries(records).filter(([recordId]) => !deletedRecordIds.has(recordId)).map(async ([recordId, record]) => {
            const response = await fetch(`${firestoreRestBase}/attendanceRecords/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: Object.keys(record).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(record[key]) }), {}) })
            });
            if (!response.ok) throw new Error(`Firestore attendance write failed: ${response.status}`);
        }));
    }

    async function deleteAttendanceRecordFromFirestore(recordId) {
        const deletionResponse = await fetch(`${firestoreRestBase}/attendanceRecordDeletions/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { recordId: toFirestoreValue(recordId), deletedAt: toFirestoreValue(new Date().toISOString()) } })
        });
        if (!deletionResponse.ok) throw new Error(`Firestore attendance deletion record failed: ${deletionResponse.status}`);
        const response = await fetch(`${firestoreRestBase}/attendanceRecords/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error(`Firestore attendance delete failed: ${response.status}`);
    }

    async function loadAttendanceHistoryFromFirestore() {
        const documents = await loadFirestoreCollection("attendanceHistory");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((entry, key) => ({ ...entry, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveAttendanceHistoryToFirestore(entry) {
        const response = await fetch(`${firestoreRestBase}/attendanceHistory/${encodeURIComponent(entry.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: Object.keys(entry).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(entry[key]) }), {}) })
        });
        if (!response.ok) throw new Error(`Firestore attendance history write failed: ${response.status}`);
    }

    async function loadAttendanceTasksFromFirestore() {
        const [documents, deletedTaskIds] = await Promise.all([
            loadFirestoreCollection("attendanceTasks"),
            loadDeletedAttendanceTaskIdsFromFirestore()
        ]);
        return documents.filter(document => !deletedTaskIds.has(document.name.split("/").pop())).map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((task, key) => ({ ...task, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function loadDeletedAttendanceTaskIdsFromFirestore() {
        const documents = await loadFirestoreCollection("attendanceTaskDeletions");
        return new Set(documents.map(document => document.name.split("/").pop()));
    }

    async function deleteAttendanceTasksFromFirestore(taskIds) {
        await Promise.all([...new Set(taskIds)].map(async taskId => {
            const deletionResponse = await fetch(`${firestoreRestBase}/attendanceTaskDeletions/${encodeURIComponent(taskId)}?key=${firebaseConfig.apiKey}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: { taskId: toFirestoreValue(taskId), deletedAt: toFirestoreValue(new Date().toISOString()) } })
            });
            if (!deletionResponse.ok) throw new Error(`Firestore attendance task deletion record failed: ${deletionResponse.status}`);
            const response = await fetch(`${firestoreRestBase}/attendanceTasks/${encodeURIComponent(taskId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
            if (!response.ok && response.status !== 404) throw new Error(`Firestore attendance task delete failed: ${response.status}`);
        }));
    }

    async function saveAttendanceTasksToFirestore(tasks) {
        const [existingDocuments, deletedTaskIds] = await Promise.all([
            loadFirestoreCollection("attendanceTasks"),
            loadDeletedAttendanceTaskIdsFromFirestore()
        ]);
        const activeTasks = tasks.filter(task => !deletedTaskIds.has(task.id));
        const taskIds = new Set(activeTasks.map(task => task.id));
        await Promise.all([
            ...activeTasks.map(async task => {
                const response = await fetch(`${firestoreRestBase}/attendanceTasks/${encodeURIComponent(task.id)}?key=${firebaseConfig.apiKey}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fields: Object.keys(task).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(task[key]) }), {}) })
                });
                if (!response.ok) throw new Error(`Firestore attendance task write failed: ${response.status}`);
            }),
            ...existingDocuments
                .filter(document => !taskIds.has(document.name.split("/").pop()))
                .map(async document => {
                    const taskId = document.name.split("/").pop();
                    const response = await fetch(`${firestoreRestBase}/attendanceTasks/${encodeURIComponent(taskId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
                    if (!response.ok) throw new Error(`Firestore attendance task delete failed: ${response.status}`);
                })
        ]);
    }

    async function saveAnnouncementToFirestore(announcement) {
        const response = await fetch(`${firestoreRestBase}/announcements/${encodeURIComponent(announcement.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: Object.keys(announcement).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(announcement[key]) }), {}) })
        });
        if (!response.ok) throw new Error(`Announcement write failed: ${response.status}`);
    }

    async function loadAnnouncementsFromFirestore(since) {
        const documents = await loadFirestoreCollection("announcements");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((announcement, key) => ({ ...announcement, [key]: fromFirestoreValue(document.fields[key]) }), {})
        })).filter(announcement => Number(announcement.createdAt) > since)
            .sort((first, second) => Number(first.createdAt) - Number(second.createdAt));
    }

    async function clearAttendanceFromFirestore(date) {
        return clearAttendanceRangeFromFirestore(date, date);
    }

    async function clearAttendanceRangeFromFirestore(start, end) {
        const records = await loadAttendanceFromFirestore();
        const recordIds = Object.entries(records)
            .filter(([recordId, record]) => {
                const recordDate = record.date || recordId.split(":")[0];
                return !start || !end || (recordDate >= start && recordDate <= end);
            })
            .map(([recordId]) => recordId);
        await Promise.all(recordIds.map(async recordId => {
            const response = await fetch(`${firestoreRestBase}/attendanceRecords/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
            if (!response.ok) throw new Error(`Firestore attendance delete failed: ${response.status}`);
        }));
    }

    async function loadInventoryFromFirestore(office) {
        const response = await fetch(`${firestoreRestBase}/inventoryData/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, { cache: "no-store" });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Firestore inventory read failed: ${response.status}`);
        const document = await response.json();
        return Object.keys(document.fields || {}).reduce((inventory, key) => ({ ...inventory, [key]: fromFirestoreValue(document.fields[key]) }), {});
    }

    async function saveInventoryToFirestore(office, inventory) {
        const response = await fetch(`${firestoreRestBase}/inventoryData/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: Object.keys(inventory).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(inventory[key]) }), {}) })
        });
        if (!response.ok) throw new Error(`Firestore inventory write failed: ${response.status}`);
    }

    async function clearInventoryFromFirestore(office) {
        const response = await fetch(`${firestoreRestBase}/inventoryData/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error(`Firestore inventory delete failed: ${response.status}`);
    }

    async function loadInventoryHistoryFromFirestore(office) {
        const response = await fetch(`${firestoreRestBase}/inventoryHistory/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, { cache: "no-store" });
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`Firestore inventory history read failed: ${response.status}`);
        const document = await response.json();
        return document.fields?.entries ? fromFirestoreValue(document.fields.entries) : [];
    }

    async function saveInventoryHistoryToFirestore(office, entries) {
        const response = await fetch(`${firestoreRestBase}/inventoryHistory/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { entries: toFirestoreValue(entries.slice(0, 200)) } })
        });
        if (!response.ok) throw new Error(`Firestore inventory history write failed: ${response.status}`);
    }

    async function loadTodoTasksFromFirestore() {
        const documents = await loadFirestoreCollection("todoTasks");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((task, key) => ({ ...task, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveTodoTaskToFirestore(task) {
        const fields = Object.keys(task).filter(key => key !== "id").reduce((result, key) => ({ ...result, [key]: toFirestoreValue(task[key]) }), {});
        const response = await fetch(`${firestoreRestBase}/todoTasks/${encodeURIComponent(task.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields })
        });
        if (!response.ok) throw new Error(`Firestore to-do task write failed: ${response.status}`);
    }

    async function deleteTodoTaskFromFirestore(taskId) {
        const response = await fetch(`${firestoreRestBase}/todoTasks/${encodeURIComponent(taskId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error(`Firestore to-do task delete failed: ${response.status}`);
    }

    async function loadOnlinePresenceFromFirestore() {
        const documents = await loadFirestoreCollection("onlinePresence");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((entry, key) => ({ ...entry, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveOnlinePresenceToFirestore(sessionId, presence) {
        const fields = Object.keys(presence).reduce((result, key) => ({ ...result, [key]: toFirestoreValue(presence[key]) }), {});
        const response = await fetch(`${firestoreRestBase}/onlinePresence/${encodeURIComponent(sessionId)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields })
        });
        if (!response.ok) throw new Error(`Online presence write failed: ${response.status}`);
    }

    async function removeOnlinePresenceFromFirestore(sessionId) {
        const response = await fetch(`${firestoreRestBase}/onlinePresence/${encodeURIComponent(sessionId)}?key=${firebaseConfig.apiKey}`, {
            method: "DELETE",
            keepalive: true
        });
        if (!response.ok && response.status !== 404) throw new Error(`Online presence delete failed: ${response.status}`);
    }

    async function loadOnlineChatMessagesFromFirestore(chatId) {
        const documents = await loadFirestoreCollection(`onlineChats/${encodeURIComponent(chatId)}/messages`);
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((message, key) => ({ ...message, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveOnlineChatMessageToFirestore(chatId, message) {
        const fields = Object.keys(message).filter(key => key !== "id").reduce((result, key) => ({ ...result, [key]: toFirestoreValue(message[key]) }), {});
        const response = await fetch(`${firestoreRestBase}/onlineChats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(message.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields })
        });
        if (!response.ok) throw new Error(`Online chat message write failed: ${response.status}`);
    }

    window.sharedAttendance = {
        ready: Promise.resolve(),
        async load() {
            return loadAttendanceFromFirestore();
        },
        async save(records) {
            const normalizedRecords = Object.entries(records).reduce((normalized, [key, record]) => ({
                ...normalized,
                [key]: { ...record, date: record.date || key.split(":")[0] }
            }), {});
            return saveAttendanceToFirestore(normalizedRecords);
        },
        async deleteRecord(recordId) {
            return deleteAttendanceRecordFromFirestore(recordId);
        },
        async loadHistory() {
            return loadAttendanceHistoryFromFirestore();
        },
        async saveHistory(entry) {
            return saveAttendanceHistoryToFirestore(entry);
        },
        async loadTasks() {
            return loadAttendanceTasksFromFirestore();
        },
        async loadDeletedTaskIds() {
            return [...await loadDeletedAttendanceTaskIdsFromFirestore()];
        },
        async deleteTasks(taskIds) {
            return deleteAttendanceTasksFromFirestore(taskIds);
        },
        async saveTasks(tasks) {
            return saveAttendanceTasksToFirestore(tasks);
        },
        async clearDate(date) {
            return clearAttendanceFromFirestore(date);
        },
        async clearRange(start, end) {
            return clearAttendanceRangeFromFirestore(start, end);
        },
        async loadAccounts() {
            return loadAccountsFromFirestore();
        },
        async saveAccounts(accounts) {
            return saveAccountsToFirestore(accounts);
        },
        async deleteAccount(username) {
            return deleteAccountFromFirestore(username);
        }
    };

    window.sharedInventory = {
        ready: Promise.resolve(),
        load: office => loadInventoryFromFirestore(office),
        save: (office, inventory) => saveInventoryToFirestore(office, inventory),
        clear: office => clearInventoryFromFirestore(office),
        loadHistory: office => loadInventoryHistoryFromFirestore(office),
        saveHistory: (office, entries) => saveInventoryHistoryToFirestore(office, entries)
    };

    window.sharedTodoList = {
        ready: Promise.resolve(),
        load: () => loadTodoTasksFromFirestore(),
        save: task => saveTodoTaskToFirestore(task),
        delete: taskId => deleteTodoTaskFromFirestore(taskId)
    };

    window.sharedOnlinePresence = {
        ready: Promise.resolve(),
        load: () => loadOnlinePresenceFromFirestore(),
        save: (sessionId, presence) => saveOnlinePresenceToFirestore(sessionId, presence),
        remove: sessionId => removeOnlinePresenceFromFirestore(sessionId)
    };

    window.sharedOnlineChat = {
        ready: Promise.resolve(),
        load: chatId => loadOnlineChatMessagesFromFirestore(chatId),
        send: (chatId, message) => saveOnlineChatMessageToFirestore(chatId, message)
    };

    window.sharedAnnouncements = {
        send: announcement => saveAnnouncementToFirestore(announcement),
        loadSince: timestamp => loadAnnouncementsFromFirestore(timestamp)
    };

    window.sharedAccounts = {
        ready: window.sharedAttendance.ready,
        load: () => window.sharedAttendance.loadAccounts(),
        save: accounts => window.sharedAttendance.saveAccounts(accounts),
        saveOne: (username, account) => saveAccountToFirestore(username, account),
        saveTheme: (username, theme) => saveAccountThemeToFirestore(username, theme),
        delete: username => window.sharedAttendance.deleteAccount(username),
        loadDeleted: async () => [...await loadDeletedAccountUsernamesFromFirestore()]
    };
})();
