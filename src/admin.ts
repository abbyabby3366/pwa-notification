import "./styles.css";

interface AdminSubscription {
  id: string;
  device: string;
  pushHost: string;
  userAgent: string;
  createdAt: string;
}

interface DeliveryResult {
  id: string;
  device: string;
  pushHost: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
}

type LogKind = "ok" | "err" | "info";

interface LogEntry {
  kind: LogKind;
  message: string;
  timestampIso: string;
}

// DOM Elements
const errorBanner = document.getElementById("admin-error-banner") as HTMLElement;
const errorTitle = document.getElementById("admin-error-title") as HTMLElement;
const errorMessage = document.getElementById("admin-error-message") as HTMLElement;

const deviceCountPill = document.getElementById("device-count-pill") as HTMLElement;
const adminSendForm = document.getElementById("admin-send-form") as HTMLFormElement;
const selectTarget = document.getElementById("select-target") as HTMLSelectElement;
const selectDelay = document.getElementById("select-delay") as HTMLSelectElement;
const inputTitle = document.getElementById("admin-title") as HTMLInputElement;
const inputBody = document.getElementById("admin-body") as HTMLTextAreaElement;
const inputUrl = document.getElementById("admin-url") as HTMLInputElement;
const btnAdminSend = document.getElementById("btn-admin-send") as HTMLButtonElement;

const devicesTbody = document.getElementById("devices-tbody") as HTMLTableSectionElement;
const adminLog = document.getElementById("admin-log") as HTMLUListElement;

const confirmDeleteDialog = document.getElementById("confirm-delete-dialog") as HTMLDialogElement;
const deleteDialogText = document.getElementById("delete-dialog-text") as HTMLElement;
const btnCancelDelete = document.getElementById("btn-cancel-delete") as HTMLButtonElement;
const btnConfirmDelete = document.getElementById("btn-confirm-delete") as HTMLButtonElement;

// State
let subscriptions: AdminSubscription[] = [];
let pendingDeleteSub: AdminSubscription | null = null;
const logs: LogEntry[] = [];

function formatGmt8DateTime(iso: string): { date: string; time: string } {
  const dateObj = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dateObj);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  return {
    date: `${get("day")}-${get("month")}-${get("year")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

function showError(title: string, message: string): void {
  errorTitle.textContent = title;
  errorMessage.textContent = message;
  errorBanner.hidden = false;
}

function clearError(): void {
  errorBanner.hidden = true;
}

function addLog(kind: LogKind, message: string, timestampIso = new Date().toISOString()): void {
  logs.unshift({ kind, message, timestampIso });
  if (logs.length > 30) {
    logs.length = 30;
  }
  renderLogs();
}

function renderLogs(): void {
  if (logs.length === 0) {
    adminLog.innerHTML = `<li class="log-empty">No notifications sent in this session yet.</li>`;
    return;
  }

  adminLog.innerHTML = "";
  for (const entry of logs) {
    const { date, time } = formatGmt8DateTime(entry.timestampIso);
    const li = document.createElement("li");
    li.className = `log-item log-item-${entry.kind}`;

    const textSpan = document.createElement("span");
    textSpan.className = "log-text";
    textSpan.textContent = entry.message;

    const tsDiv = document.createElement("div");
    tsDiv.className = "log-timestamp";

    const primaryTime = document.createElement("span");
    primaryTime.className = "log-time-primary";
    primaryTime.textContent = time;

    const secondaryDate = document.createElement("span");
    secondaryDate.className = "log-date-secondary";
    secondaryDate.textContent = `${date} GMT+8`;

    tsDiv.append(primaryTime, secondaryDate);
    li.append(textSpan, tsDiv);
    adminLog.append(li);
  }
}

function renderSubscriptions(): void {
  const count = subscriptions.length;
  deviceCountPill.textContent = `${count} device${count === 1 ? "" : "s"}`;
  btnAdminSend.disabled = count === 0;

  const prevTarget = selectTarget.value;
  selectTarget.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = `All Subscribed Devices (${count})`;
  selectTarget.append(allOpt);

  for (const sub of subscriptions) {
    const opt = document.createElement("option");
    opt.value = sub.id;
    opt.textContent = `${sub.device} — ${sub.pushHost} (${sub.id.slice(0, 6)})`;
    selectTarget.append(opt);
  }

  if (prevTarget && subscriptions.some((s) => s.id === prevTarget)) {
    selectTarget.value = prevTarget;
  }

  if (count === 0) {
    devicesTbody.innerHTML = `<tr><td colspan="4" class="table-empty">No devices subscribed yet. Open the PWA on your iPhone, Add to Home Screen, and enable push notifications.</td></tr>`;
    return;
  }

  devicesTbody.innerHTML = "";
  for (const sub of subscriptions) {
    const tr = document.createElement("tr");

    // Device column
    const tdDevice = document.createElement("td");
    const devTitle = document.createElement("div");
    devTitle.className = "cell-primary";
    devTitle.textContent = sub.device;
    const devId = document.createElement("div");
    devId.className = "cell-secondary";
    devId.textContent = `ID: ${sub.id}`;
    tdDevice.append(devTitle, devId);

    // Push Service column
    const tdHost = document.createElement("td");
    tdHost.className = "cell-mono";
    tdHost.textContent = sub.pushHost;

    // Subscribed At column (2-row stacked date/time in GMT+8)
    const tdTime = document.createElement("td");
    const { date, time } = formatGmt8DateTime(sub.createdAt);
    const dtStack = document.createElement("div");
    dtStack.className = "dt-stack";
    const dateRow = document.createElement("span");
    dateRow.className = "dt-primary";
    dateRow.textContent = date;
    const timeRow = document.createElement("span");
    timeRow.className = "dt-secondary";
    timeRow.textContent = `${time} GMT+8`;
    dtStack.append(dateRow, timeRow);
    tdTime.append(dtStack);

    // Actions column
    const tdActions = document.createElement("td");
    tdActions.className = "col-actions";
    const actionWrap = document.createElement("div");
    actionWrap.className = "row-actions";

    const pingBtn = document.createElement("button");
    pingBtn.type = "button";
    pingBtn.className = "btn btn-secondary btn-xs";
    pingBtn.textContent = "Ping";
    pingBtn.addEventListener("click", () => {
      void sendNotification({
        targetId: sub.id,
        title: inputTitle.value.trim() || "Quick Ping",
        body: inputBody.value.trim() || `Ping to ${sub.device}`,
        url: inputUrl.value.trim() || "/",
        delaySeconds: 0,
      });
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn-danger-outline btn-xs";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      pendingDeleteSub = sub;
      deleteDialogText.textContent = `Remove ${sub.device} (${sub.pushHost}, ID ${sub.id}) from the server?`;
      confirmDeleteDialog.showModal();
    });

    actionWrap.append(pingBtn, delBtn);
    tdActions.append(actionWrap);

    tr.append(tdDevice, tdHost, tdTime, tdActions);
    devicesTbody.append(tr);
  }
}

async function loadSubscriptions(): Promise<void> {
  try {
    const res = await fetch("/api/admin/subscriptions");
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { subscriptions: AdminSubscription[] };
    subscriptions = data.subscriptions;
    renderSubscriptions();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load subscriptions";
    showError("Failed to Load Devices", msg);
  }
}

async function sendNotification(payload: {
  targetId: string;
  title: string;
  body: string;
  url: string;
  delaySeconds: number;
}): Promise<void> {
  clearError();
  btnAdminSend.disabled = true;

  try {
    const res = await fetch("/api/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      scheduled?: boolean;
      delaySeconds?: number;
      targetCount?: number;
      error?: string;
      results?: DeliveryResult[];
    };

    if (!res.ok || !data.ok) {
      const firstErr = data.results?.find((r) => !r.ok)?.error;
      throw new Error(firstErr ?? data.error ?? `HTTP ${res.status}`);
    }

    if (data.scheduled) {
      addLog(
        "info",
        `Scheduled "${payload.title}" to ${data.targetCount} device(s) in ${data.delaySeconds}s.`
      );
    } else if (data.results) {
      for (const r of data.results) {
        if (r.ok) {
          addLog(
            "ok",
            `Sent "${payload.title}" → ${r.device} (${r.pushHost}, HTTP ${r.statusCode ?? 201})`
          );
        } else {
          addLog(
            "err",
            `Failed → ${r.device} (${r.pushHost}): ${r.error ?? `HTTP ${r.statusCode}`}`
          );
        }
      }
    }

    await loadSubscriptions();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send notification";
    showError("Send Failed", msg);
    addLog("err", `Send error: ${msg}`);
  } finally {
    btnAdminSend.disabled = subscriptions.length === 0;
  }
}

async function deleteSubscription(sub: AdminSubscription): Promise<void> {
  clearError();
  try {
    const res = await fetch(`/api/admin/subscriptions/${encodeURIComponent(sub.id)}`, {
      method: "DELETE",
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    addLog("info", `Removed device ${sub.device} (${sub.id}).`);
    await loadSubscriptions();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete device";
    showError("Delete Failed", msg);
    addLog("err", `Delete failed: ${msg}`);
  }
}

// Event Listeners
adminSendForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = inputTitle.value.trim();
  const body = inputBody.value.trim();
  const url = inputUrl.value.trim() || "/";
  const targetId = selectTarget.value;
  const delaySeconds = Number(selectDelay.value);

  if (!title || !body) {
    showError("Missing Fields", "Title and Message are required.");
    return;
  }

  void sendNotification({ targetId, title, body, url, delaySeconds });
});

btnCancelDelete.addEventListener("click", () => {
  pendingDeleteSub = null;
  confirmDeleteDialog.close();
});

btnConfirmDelete.addEventListener("click", () => {
  const target = pendingDeleteSub;
  pendingDeleteSub = null;
  confirmDeleteDialog.close();
  if (target) {
    void deleteSubscription(target);
  }
});

// Boot & auto-sync every 10s
void loadSubscriptions();
window.setInterval(() => {
  void loadSubscriptions();
}, 10000);
