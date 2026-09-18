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

    if (!window.firebase) return;

    firebase.initializeApp(firebaseConfig);
    const database = firebase.firestore();
    const recordsCollection = database.collection("attendanceRecords");
    const accountsCollection = database.collection("accounts");
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

    window.sharedAttendance = {
        ready: Promise.resolve(),
        async load() {
            await this.ready;
            const snapshot = await recordsCollection.get();
            return snapshot.docs.reduce((records, document) => {
                records[document.id] = document.data();
                return records;
            }, {});
        },
        async save(records) {
            await this.ready;
            const batch = database.batch();
            Object.entries(records).forEach(([key, record]) => {
                const date = record.date || key.split(":")[0];
                batch.set(recordsCollection.doc(key), { ...record, date }, { merge: true });
            });
            await batch.commit();
        },
        async clearDate(date) {
            await this.ready;
            const snapshot = await recordsCollection.where("date", "==", date).get();
            const batch = database.batch();
            snapshot.docs.forEach(document => batch.delete(document.ref));
            await batch.commit();
        },
        async loadAccounts() {
            return loadAccountsFromFirestore();
        },
        async saveAccounts(accounts) {
            return saveAccountsToFirestore(accounts);
        }
    };

    window.sharedAccounts = {
        ready: window.sharedAttendance.ready,
        load: () => window.sharedAttendance.loadAccounts(),
        save: accounts => window.sharedAttendance.saveAccounts(accounts)
    };
})();
