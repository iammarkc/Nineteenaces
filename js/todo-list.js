(function () {
    "use strict";

    const categories = [
        "Uploader",
        "Papel",
        "POS",
        "Meeting",
        "Office Supplies & Equipment",
        "Personnel SOP's & Requirements",
        "Daily IT Output Report",
        "Extra Tasks",
        "Orientation",
        "To Do"
    ];
    const tasks = [];
    const monthInput = document.getElementById("todoMonth");
    const searchInput = document.getElementById("todoSearch");
    const addForm = document.getElementById("todoAddForm");
    const addButton = document.getElementById("toggleTodoForm");
    const notice = document.getElementById("todoNotice");
    const username = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "User";
    const accounts = JSON.parse(localStorage.getItem("userAccounts") || "{}");
    const account = accounts[username];
    const currentRole = username === "admin" || account?.role === "Developer" ? "Developer" : (account?.role || "User");
    const permissions = new Set(Array.isArray(account?.permissions) ? account.permissions : []);

    if (currentRole !== "Developer" && !permissions.has("todoList")) {
        window.location.replace("inventory.html");
        return;
    }
    let activeTaskEdit = null;

    function getLocalMonth() {
        const date = new Date();
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function getPreviousMonth(month) {
        const [year, monthNumber] = month.split("-").map(Number);
        const date = new Date(year, monthNumber - 2, 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function showNotice(message, kind = "info") {
        notice.textContent = message;
        notice.dataset.kind = kind;
        notice.hidden = !message;
    }

    function getFirestoreErrorMessage(action, error, collection = "todoTasks") {
        const details = String(error?.message || "");
        if (/429|quota|rate limit/i.test(details)) {
            return `${action} failed because Firebase is rate limiting requests. Wait briefly, then retry.`;
        }
        if (/403|permission|denied/i.test(details)) {
            return `Firestore denied ${action.toLowerCase()}. Deploy the ${collection} rule, then retry.`;
        }
        return `${action} failed. ${details || "Check your connection and try again."}`;
    }

    function getMonthTasks() {
        return tasks.filter(task => task.month === monthInput.value);
    }

    function render() {
        const monthTasks = getMonthTasks();
        const completedCount = monthTasks.filter(task => task.completed).length;
        const pendingCount = monthTasks.filter(task => !task.completed).length;
        const progress = monthTasks.length ? Math.round(completedCount / monthTasks.length * 100) : 0;
        document.getElementById("totalTaskCount").textContent = monthTasks.length;
        document.getElementById("pendingTaskCount").textContent = pendingCount;
        document.getElementById("completedTaskCount").textContent = completedCount;
        document.getElementById("overallProgressLabel").textContent = `${progress}%`;
        document.getElementById("overallProgressBar").style.width = `${progress}%`;
        document.querySelector(".todo-progress-track").setAttribute("aria-valuenow", progress);

        const search = searchInput.value.trim().toLowerCase();
        categories.forEach(category => {
            const categoryTasks = monthTasks.filter(task => task.category === category);
            const categoryCompleted = categoryTasks.filter(task => task.completed).length;
            const categoryProgress = categoryTasks.length ? Math.round(categoryCompleted / categoryTasks.length * 100) : 0;
            document.querySelector(`[data-category-progress="${category}"]`).textContent = `${categoryCompleted}/${categoryTasks.length} completed`;
            document.querySelector(`[data-category-bar="${category}"]`).style.width = `${categoryProgress}%`;

            const visibleTasks = categoryTasks.filter(task => task.title.toLowerCase().includes(search));
            const rows = visibleTasks.map(task => `
                <tr class="todo-row${task.completed ? " is-complete" : ""}" data-task-id="${escapeHtml(task.id)}">
                    <td><input class="todo-check" type="checkbox" aria-label="Mark ${escapeHtml(task.title)} complete" ${task.completed ? "checked" : ""}></td>
                    <td><input class="todo-date" type="date" aria-label="Date for ${escapeHtml(task.title)}" value="${escapeHtml(task.date || "")}"></td>
                    <td><span class="todo-task-label" title="Double-click to edit">${escapeHtml(task.title)}</span></td>
                    <td><button class="todo-delete" type="button" title="Delete task" aria-label="Delete ${escapeHtml(task.title)}"><i class="bi bi-trash3" aria-hidden="true"></i></button></td>
                </tr>`).join("");
            document.querySelector(`[data-category-rows="${category}"]`).innerHTML = rows || `<tr><td class="todo-empty" colspan="4">${search ? "No matching tasks" : "No tasks this month"}</td></tr>`;
        });
    }

    function getTaskId(row) {
        return tasks.findIndex(task => task.id === row.dataset.taskId);
    }

    async function persistTask(index, previousTask) {
        try {
            await window.sharedTodoList.save(tasks[index]);
            showNotice("");
            render();
        } catch (error) {
            tasks[index] = previousTask;
            render();
            showNotice(getFirestoreErrorMessage("Task save", error), "error");
            console.error("To-do task save failed.", error);
        }
    }

    async function carryPendingTasksIntoMonth(targetMonth) {
        if (!/^\d{4}-\d{2}$/.test(targetMonth)) return;
        const sourceMonth = getPreviousMonth(targetMonth);
        const existingIds = new Set(tasks.map(task => task.id));
        const pendingSources = tasks.filter(task => task.month === sourceMonth && !task.completed);
        const carryTasks = pendingSources
            .map(task => ({
                ...task,
                id: `carry-${task.id}-${targetMonth}`,
                month: targetMonth,
                date: "",
                completed: false,
                carriedFrom: task.id,
                createdAt: Date.now()
            }))
            .filter(task => !existingIds.has(task.id));

        const savedTasks = [];
        let firstCarryError = null;
        for (const task of carryTasks) {
            try {
                await window.sharedTodoList.save(task);
                savedTasks.push(task);
            } catch (error) {
                firstCarryError ||= error;
                console.error("Pending task carry-forward failed.", error);
            }
        }
        if (savedTasks.length) tasks.push(...savedTasks);
        if (firstCarryError) {
            showNotice(getFirestoreErrorMessage("Some pending tasks could not be carried forward", firstCarryError), "error");
        }
        render();
    }

    function finishTaskEdit(commitChanges) {
        const edit = activeTaskEdit;
        if (!edit) return;
        activeTaskEdit = null;
        document.removeEventListener("pointerdown", edit.onOutsidePointerDown, true);
        const index = getTaskId(edit.row);
        if (index < 0) return;

        if (!commitChanges) {
            render();
            return;
        }

        const nextTitle = edit.input.value.trim();
        if (!nextTitle) {
            showNotice("Task names cannot be empty.", "error");
            render();
            return;
        }
        if (nextTitle === edit.previousTitle) {
            render();
            return;
        }

        const previousTask = { ...tasks[index] };
        tasks[index].title = nextTitle;
        void persistTask(index, previousTask);
    }

    document.getElementById("todoBoard").addEventListener("dblclick", event => {
        const label = event.target.closest(".todo-task-label");
        if (!label || activeTaskEdit) return;
        const row = label.closest(".todo-row");
        const index = getTaskId(row);
        if (index < 0) return;

        const input = document.createElement("input");
        input.className = "todo-task-edit";
        input.type = "text";
        input.maxLength = 240;
        input.value = tasks[index].title;
        input.setAttribute("aria-label", "Edit task name");
        label.replaceWith(input);
        const onOutsidePointerDown = pointerEvent => {
            if (!input.contains(pointerEvent.target)) finishTaskEdit(true);
        };
        activeTaskEdit = { row, input, previousTitle: tasks[index].title, onOutsidePointerDown };
        input.addEventListener("keydown", keyEvent => {
            if (keyEvent.key === "Enter") {
                keyEvent.preventDefault();
                finishTaskEdit(true);
            } else if (keyEvent.key === "Escape") {
                keyEvent.preventDefault();
                finishTaskEdit(false);
            }
        });
        document.addEventListener("pointerdown", onOutsidePointerDown, true);
        input.focus();
        input.select();
    });

    document.getElementById("todoBoard").addEventListener("change", event => {
        const row = event.target.closest(".todo-row");
        if (!row) return;
        if (!event.target.matches(".todo-check, .todo-date")) return;
        const index = getTaskId(row);
        if (index < 0) return;
        const previousTask = { ...tasks[index] };
        if (event.target.matches(".todo-check")) {
            const completedOn = new Date();
            tasks[index].completed = event.target.checked;
            tasks[index].date = event.target.checked
                ? `${completedOn.getFullYear()}-${String(completedOn.getMonth() + 1).padStart(2, "0")}-${String(completedOn.getDate()).padStart(2, "0")}`
                : "";
        }
        if (event.target.matches(".todo-date")) tasks[index].date = event.target.value;
        persistTask(index, previousTask);
    });

    document.getElementById("todoBoard").addEventListener("click", async event => {
        const button = event.target.closest(".todo-delete");
        if (!button) return;
        const row = button.closest(".todo-row");
        const index = getTaskId(row);
        if (index < 0) return;
        const [task] = tasks.splice(index, 1);
        render();
        try {
            await window.sharedTodoList.delete(task.id);
            showNotice("");
        } catch (error) {
            tasks.splice(index, 0, task);
            render();
            showNotice(getFirestoreErrorMessage("Task delete", error), "error");
            console.error("To-do task delete failed.", error);
        }
    });

    addButton.addEventListener("click", () => {
        addForm.hidden = !addForm.hidden;
        addButton.setAttribute("aria-expanded", String(!addForm.hidden));
        if (!addForm.hidden) document.getElementById("todoTitle").focus();
    });

    addForm.addEventListener("submit", async event => {
        event.preventDefault();
        const titleInput = document.getElementById("todoTitle");
        const task = {
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            category: document.getElementById("todoCategory").value,
            date: document.getElementById("todoDate").value,
            title: titleInput.value.trim(),
            month: monthInput.value,
            completed: false,
            createdAt: Date.now()
        };
        if (!task.title || !categories.includes(task.category) || !/^\d{4}-\d{2}$/.test(task.month)) return;

        const submitButton = addForm.querySelector("[type=submit]");
        submitButton.disabled = true;
        try {
            await window.sharedTodoList.save(task);
            tasks.push(task);
            addForm.reset();
            render();
            showNotice("");
            titleInput.focus();
        } catch (error) {
            showNotice(getFirestoreErrorMessage("Task add", error), "error");
            console.error("To-do task create failed.", error);
        } finally {
            submitButton.disabled = false;
        }
    });

    monthInput.value = getLocalMonth();
    monthInput.addEventListener("change", () => {
        finishTaskEdit(true);
        render();
        void carryPendingTasksIntoMonth(monthInput.value);
    });
    searchInput.addEventListener("input", render);

    document.getElementById("exportTodoReport").addEventListener("click", async event => {
        const button = event.currentTarget;
        const monthTasks = getMonthTasks();
        const completedTasks = monthTasks.filter(task => task.completed);
        const pendingTasks = monthTasks.filter(task => !task.completed);
        if (!window.ExcelJS) {
            showNotice("The Excel report library could not be loaded. Check your connection and try again.", "error");
            return;
        }

        button.disabled = true;
        try {
            const [year, monthNumber] = monthInput.value.split("-").map(Number);
            const monthDate = new Date(year, monthNumber - 1, 1);
            const monthName = monthDate.toLocaleString("en-US", { month: "long" });
            const workbook = new window.ExcelJS.Workbook();
            workbook.creator = "R2 Lucky9 Games";
            const worksheet = workbook.addWorksheet(`${monthName} Summary`);
            worksheet.columns = [
                { header: "Task Type", key: "taskType", width: 16 },
                { header: "Date Accomplished", key: "dateAccomplished", width: 18 },
                { header: `Tasks Accomplished (${completedTasks.length})`, key: "tasksAccomplished", width: 40 },
                { header: "", key: "spacerOne", width: 1.38 },
                { header: "", key: "spacerTwo", width: 1.38 },
                { header: `Pending Tasks (${pendingTasks.length})`, key: "pendingTasks", width: 37.38 },
                { header: "Notes", key: "notes", width: 37.38 }
            ];
            worksheet.getRow(1).height = 30;
            worksheet.getRow(1).eachCell({ includeEmpty: true }, cell => {
                cell.font = { bold: true, size: 12 };
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            });
            worksheet.getColumn(2).numFmt = 'm"/"d';

            const toExcelDate = value => {
                if (!value) return null;
                const [dateYear, dateMonth, day] = value.split("-").map(Number);
                return new Date(dateYear, dateMonth - 1, day);
            };
            for (let index = 0; index < Math.max(completedTasks.length, pendingTasks.length); index += 1) {
                const completedTask = completedTasks[index];
                const pendingTask = pendingTasks[index];
                const row = worksheet.addRow([
                    completedTask?.category || "",
                    toExcelDate(completedTask?.date),
                    completedTask?.title || "",
                    "",
                    "",
                    pendingTask?.title || "",
                    ""
                ]);
                row.eachCell({ includeEmpty: true }, cell => {
                    cell.alignment = { vertical: "top", wrapText: true };
                });
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = `${monthName} Summary.xlsx`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            showNotice("");
        } catch (error) {
            console.error("Monthly summary export failed.", error);
            showNotice("The Excel report could not be created. Try again.", "error");
        } finally {
            button.disabled = false;
        }
    });

    document.querySelector(".user-display-name").textContent = account?.name || username;
    document.querySelector(".user-display-username").textContent = `@${username}`;

    const inventoryAccess = new Set(currentRole === "Developer"
        ? ["Rizal", "Cebu"]
        : (Array.isArray(account?.inventoryAccess) ? account.inventoryAccess : (account?.office ? [account.office] : [])));
    document.querySelectorAll("#adminMenu + .dropdown-menu [data-permission]").forEach(item => {
        const menuEntry = item.closest("li");
        if (!menuEntry) return;
        if (item.id === "clearInventoryMenuBtn") {
            menuEntry.style.display = currentRole === "Developer" ? "" : "none";
        } else if (item.dataset.inventoryOffice) {
            menuEntry.style.display = permissions.has(item.dataset.permission) && inventoryAccess.has(item.dataset.inventoryOffice) ? "" : "none";
        } else if (["addAccount", "users"].includes(item.dataset.permission)) {
            menuEntry.style.display = currentRole === "Developer" || permissions.has(item.dataset.permission) ? "" : "none";
        } else {
            menuEntry.style.display = currentRole === "Developer" || permissions.has(item.dataset.permission) ? "" : "none";
        }
    });
    const administratorMenuItem = document.getElementById("administratorMenuItem");
    if (administratorMenuItem) {
        administratorMenuItem.style.display = currentRole === "Developer" || permissions.has("administrator") ? "" : "none";
    }
    document.querySelectorAll("#adminMenu + .dropdown-menu .dropdown-divider").forEach(divider => {
        const dividerEntry = divider.closest("li");
        const followingItems = [];
        let nextEntry = dividerEntry?.nextElementSibling;
        while (nextEntry && !nextEntry.querySelector(".dropdown-divider")) {
            followingItems.push(nextEntry);
            nextEntry = nextEntry.nextElementSibling;
        }
        if (dividerEntry) dividerEntry.style.display = followingItems.some(item => item.style.display !== "none") ? "" : "none";
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
        window.authSession?.logout();
        window.location.href = "index.html";
    });

    window.sharedTodoList.load().then(async loadedTasks => {
        tasks.push(...loadedTasks.filter(task => categories.includes(task.category) && task.id && task.month && task.title));
        await carryPendingTasksIntoMonth(monthInput.value);
        render();
    }).catch(error => {
        render();
        showNotice(getFirestoreErrorMessage("To-Do list load", error), "error");
        console.error("To-do task load failed.", error);
    });
})();