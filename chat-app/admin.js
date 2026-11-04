const API_BASE = window.CHAT_API_URL || `${location.protocol === "https:" ? "https" : "http"}://${location.hostname || "127.0.0.1"}:8000`;
const API_URL = `${API_BASE}/api`;
const TOKEN_KEY = "chat_access_token";
const statusMessage = document.getElementById("status");
const tableBody = document.getElementById("user-table-body");
const token = localStorage.getItem(TOKEN_KEY);

function showStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers,
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem(TOKEN_KEY);
            location.href = "index.html";
        }
        throw new Error(data.detail || "Yêu cầu không thành công.");
    }
    return data;
}

function createActionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", handler);
    return button;
}

async function loadUsers() {
    tableBody.replaceChildren();
    showStatus("Đang tải danh sách tài khoản...");
    try {
        const users = await apiRequest("/admin/users");
        if (!users.length) {
            showStatus("Chưa có tài khoản nào.");
            return;
        }
        users.forEach((user, index) => {
            const row = document.createElement("tr");
            const number = document.createElement("td");
            number.textContent = String(index + 1);
            const username = document.createElement("td");
            username.textContent = user.username;
            const created = document.createElement("td");
            created.textContent = user.created_at || "Không rõ";
            const actions = document.createElement("td");
            const actionGroup = document.createElement("div");
            actionGroup.className = "actions";
            actionGroup.append(
                createActionButton("Đổi mật khẩu", "warning", () => resetPassword(user)),
                createActionButton("Xóa", "danger", () => deleteUser(user)),
            );
            actions.append(actionGroup);
            row.append(number, username, created, actions);
            tableBody.append(row);
        });
        showStatus(`Có ${users.length} tài khoản.`);
    } catch (error) {
        showStatus(error.message || "Không thể tải dữ liệu.", true);
    }
}

async function deleteUser(user) {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản "${user.username}"?`)) return;
    try {
        const result = await apiRequest(`/admin/users/${encodeURIComponent(user._id)}`, { method: "DELETE" });
        showStatus(result.message);
        await loadUsers();
    } catch (error) {
        showStatus(error.message || "Không thể xóa tài khoản.", true);
    }
}

async function resetPassword(user) {
    const newPassword = prompt(`Nhập mật khẩu mới (ít nhất 8 ký tự) cho "${user.username}":`);
    if (newPassword === null) return;
    if (newPassword.length < 8 || new TextEncoder().encode(newPassword).length > 72) {
        showStatus("Mật khẩu phải có từ 8 đến 72 byte.", true);
        return;
    }
    try {
        const result = await apiRequest(
            `/admin/users/${encodeURIComponent(user._id)}/reset-password`,
            { method: "PUT", body: JSON.stringify({ new_password: newPassword }) },
        );
        showStatus(result.message);
    } catch (error) {
        showStatus(error.message || "Không thể đổi mật khẩu.", true);
    }
}

document.getElementById("refresh-btn").addEventListener("click", loadUsers);
document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "index.html";
});

async function initializeAdminPage() {
    if (!token) {
        location.href = "index.html";
        return;
    }
    try {
        const user = await apiRequest("/me");
        if (!user.is_admin) {
            showStatus("Tài khoản hiện tại không có quyền quản trị.", true);
            return;
        }
        await loadUsers();
    } catch (error) {
        showStatus(error.message || "Không thể xác thực quyền quản trị.", true);
    }
}

initializeAdminPage();
