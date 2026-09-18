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

    window.sharedAttendance = {
        ready: firebase.auth().signInAnonymously().catch(error => {
            console.warn("Shared attendance authentication unavailable.", error);
        }),
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
        }
    };
})();
