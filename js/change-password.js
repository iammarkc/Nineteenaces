(function () {
    const menuButton = document.getElementById("changePasswordMenuBtn");
    const saveButton = document.getElementById("savePasswordBtn");
    const message = "Password resets must be completed for all three Firebase Authentication projects with the same new password. Contact the Firebase administrator to send the reset emails.";

    if (menuButton) {
        menuButton.addEventListener("click", event => {
            event.preventDefault();
            alert(message);
        });
    }

    if (saveButton) {
        saveButton.addEventListener("click", () => {
            alert(message);
        });
    }
})();
