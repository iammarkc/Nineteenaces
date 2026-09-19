(function () {
    const firebaseConfig = {
        apiKey: "AIzaSyA259wFRhJ89YtjrAnnyiHsebXS3cgTY-g",
        authDomain: "nineteenaces-8ba08.firebaseapp.com",
        projectId: "nineteenaces-8ba08",
        storageBucket: "nineteenaces-8ba08.firebasestorage.app",
        messagingSenderId: "1011766262049",
        appId: "1:1011766262049:web:6c2641612938379dab2660",
        measurementId: "G-P1FSYLFE5Z"
    };

    const firestoreRestBase = "https://firestore.googleapis.com/v1/projects/nineteenaces-8ba08/databases/(default)/documents";

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

    async function loadAccountsFromFirestore() {
        const response = await fetch(`${firestoreRestBase}/accounts?key=${firebaseConfig.apiKey}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Firestore account read failed: ${response.status}`);
        const result = await response.json();
        return (result.documents || []).reduce((accounts, document) => {
            const username = document.name.split("/").pop();
            accounts[username] = Object.keys(document.fields || {}).reduce((account, key) => ({ ...account, [key]: fromFirestoreValue(document.fields[key]) }), {});
            return accounts;
        }, {});
    }

    async function saveAccountsToFirestore(accounts) {
        await Promise.all(Object.entries(accounts).map(async ([username, account]) => {
            const response = await fetch(`${firestoreRestBase}/accounts/${encodeURIComponent(username)}?key=${firebaseConfig.apiKey}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: Object.keys(account).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(account[key]) }), {}) })
            });
            if (!response.ok) throw new Error(`Firestore account write failed: ${response.status}`);
        }));
    }

    async function deleteAccountFromFirestore(username) {
        const response = await fetch(`${firestoreRestBase}/accounts/${encodeURIComponent(username)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        if (!response.ok) throw new Error(`Firestore account delete failed: ${response.status}`);
    }

    async function loadAttendanceFromFirestore() {
        const response = await fetch(`${firestoreRestBase}/attendanceRecords?key=${firebaseConfig.apiKey}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Firestore attendance read failed: ${response.status}`);
        const result = await response.json();
        return (result.documents || []).reduce((records, document) => {
            const recordId = document.name.split("/").pop();
            records[recordId] = Object.keys(document.fields || {}).reduce((record, key) => ({ ...record, [key]: fromFirestoreValue(document.fields[key]) }), {});
            return records;
        }, {});
    }

    async function saveAttendanceToFirestore(records) {
        await Promise.all(Object.entries(records).map(async ([recordId, record]) => {
            const response = await fetch(`${firestoreRestBase}/attendanceRecords/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: Object.keys(record).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(record[key]) }), {}) })
            });
            if (!response.ok) throw new Error(`Firestore attendance write failed: ${response.status}`);
        }));
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
        clear: office => clearInventoryFromFirestore(office)
    };

    window.sharedAccounts = {
        ready: window.sharedAttendance.ready,
        load: () => window.sharedAttendance.loadAccounts(),
        save: accounts => window.sharedAttendance.saveAccounts(accounts),
        delete: username => window.sharedAttendance.deleteAccount(username)
    };
})();
