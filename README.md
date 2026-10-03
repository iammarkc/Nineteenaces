# Nineteen Aces website

The GitHub Pages site uses three Firebase projects:

| Purpose | Firebase project |
| --- | --- |
| Sign-in, user profiles, Rizal inventory, announcements, presence and chat | `nineteenaces-8ba08` |
| Attendance and To-Do List | `nineteenaces-2` |
| Cebu inventory | `nineteenaces3` |

The web app configuration in `js/firebase-config.js` is client-side configuration, not a service-account credential. Never put Firebase service-account keys in this repository. Rizal inventory remains in the main project; Cebu inventory is routed to `nineteenaces3`.

## Firebase setup

Complete these steps in each project:

1. Enable **Authentication → Sign-in method → Email/Password**.
2. Create a Firestore database.
3. Add the GitHub Pages hostname under **Authentication → Settings → Authorized domains**. Add `localhost` if testing locally.
4. Create every user's Authentication account with the same email and password in all three projects. The static site signs in to all three projects; if any project is missing that user, sign-in fails.
5. Copy that user's UID from each project's Authentication user list and create the access documents below.
6. Publish the matching Firestore rules file from this repository in that project.

### Main project: `nineteenaces-8ba08`

Publish `firestore.rules`. Create `userProfiles/{main-project-uid}` with profile fields such as:

```json
{
  "username": "example",
  "name": "Example User",
  "role": "IT Admin",
  "office": "Cebu",
  "permissions": ["attendance", "attendanceReport", "assignedTasks", "todoList", "inventory"],
  "inventoryAccess": ["Cebu"],
  "disabled": false
}
```

The document ID must be the user's UID in this project. The profile has no password field. Create and edit users in Firebase Console; account creation and deletion in the website are intentionally disabled.
To disable a user, disable or remove that email from Authentication in all three projects. Set `disabled: true` in the main profile as an additional login block.

### Attendance and To-Do project: `nineteenaces-2`

Publish `firestore.attendance-todo.rules`. Create `userAccess/{attendance-todo-project-uid}` for each user:

```json
{
  "permissions": ["attendance", "attendanceReport", "assignedTasks", "todoList"]
}
```

Grant only the permissions the user needs. Use `attendance` for attendance editing, `attendanceReport` for attendance viewing, `assignedTasks` for task assignment, and `todoList` for the shared To-Do List.

### Cebu inventory project: `nineteenaces3`

Publish `firestore.cebu-inventory.rules`. Create `userAccess/{cebu-project-uid}` for each user who should access Cebu inventory:

```json
{
  "permissions": ["inventory"],
  "inventoryAccess": ["Cebu"]
}
```

Users not listed in that project's access collection cannot access Cebu inventory. In the main profile, include `inventory` in `permissions` and `Rizal` or `Cebu` in `inventoryAccess` as appropriate for Rizal inventory or visible navigation. Access checks are enforced by Firestore rules, not only by the website menu.

## Existing data

Changing the project configuration does not move existing Firestore documents. Before publishing, export the existing project's `attendanceRecords`, `attendanceRecordDeletions`, `attendanceHistory`, `attendanceTasks`, `attendanceTaskDeletions`, and `todoTasks` to the `nineteenaces-2` project. Move only the `Cebu` documents from `inventoryData` and `inventoryHistory` to `nineteenaces3`; leave Rizal inventory documents in the main project. Use a trusted Firebase/GCP administrative environment for the export and import; never place admin credentials in the website.

The old custom Firestore-password accounts are not Firebase Authentication users. Recreate/reset each account in Firebase Authentication, then create its profile/access documents in all required projects. Password changes must also be synchronized across all three projects; the static site does not change Auth passwords.

## GitHub Pages

The GitHub Actions workflow deploys only the HTML, CSS, JavaScript, image and font assets. Local account seed files, test credentials, and the Node development server are not included in the published Pages artifact. In GitHub, set the repository's Pages source to **GitHub Actions** and push changes to `main` to deploy.

## Local preview

Serve this directory over HTTP (for example, `npm start`) and open `index.html`. Do not open the HTML directly as a `file:` URL; Firebase authentication requires an authorized web origin.
