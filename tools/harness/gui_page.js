"use strict";

(() => {
  const csrf = document.querySelector('meta[name="csrf"]').content;
  const refreshSeconds = Math.max(3, Number(document.querySelector('meta[name="refresh"]').content) || 5);
  const byId = id => document.getElementById(id);
  const taskNodes = new Map(), drafts = new Map();
  const selectedIssues = new Set();
  let workspaces = [], workspaceId = "", workspaceDetail = null, requirementRows = [], requirementsLoadedFor = "";
  const mobile = matchMedia("(max-width:760px)");
  let snapshot = null, allTasks = [], selectedPlan = "", activeView = "monitor", online = false;
  let refreshing = false, actionPending = false, openIssue = null, issueSignature = "", confirmation = null;
  let modelState = null, modelTimer = null;

  function element(tagName, attributes = {}, ...children) {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === false) continue;
      if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value);
      else node.setAttribute(name, value === true ? "" : String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child === undefined || child === null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const icon = name => element("i", {"data-lucide": name, "aria-hidden": "true"});
  const icons = () => globalThis.harnessIcons?.();
  function fill(id, ...children) {
    const nodes = children.flat(Infinity).filter(Boolean), target = byId(id);
    if (nodes.length !== target.childNodes.length || nodes.some((node, index) => node !== target.childNodes[index])) target.replaceChildren(...nodes);
  }
  const shortened = value => value ? String(value).slice(0, 12) : "-";
  const formatTime = timestamp => timestamp ? new Date(timestamp * 1000).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"}) : "-";
  function tokensText(attempt) {
    const estimate = attempt.usage?.agent_estimate || attempt.usage?.size_estimate;
    if (!estimate) return "-";
    const count = value => value >= 1e6 ? (value / 1e6).toFixed(1) + "M" : value >= 1e3 ? (value / 1e3).toFixed(1) + "k" : String(value);
    return `~${count(estimate.input_tokens)} in / ~${count(estimate.output_tokens)} out (${attempt.usage.agent_estimate ? "agent estimate" : "size only"})`;
  }
  function duration(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "-";
    const value = Math.max(0, Math.round(seconds));
    if (value >= 3600) return `${Math.floor(value / 3600)}h ${Math.floor(value % 3600 / 60)}m`;
    return value >= 60 ? `${Math.floor(value / 60)}m ${value % 60}s` : `${value}s`;
  }
  function badge(text, kind) {
    if (!kind) kind = ["Done", "Completed", "pass", "approve", "verified", "Succeeded", "succeeded"].includes(text) ? "positive"
      : ["Executing", "In Progress", "In Review", "Active", "Running", "Validating", "Approved", "running"].includes(text) ? "active"
      : ["Blocked", "Failed", "Cancelled", "fail", "INVALID", "Fenced", "TimedOut", "failed"].includes(text) ? "negative"
      : ["Paused", "Ready", "Requested", "Acknowledged", "Refining", "Pausing", "Cancelling", "needs_answers"].includes(text) ? "warning" : "";
    return element("span", {class: "tag " + kind}, text || "-");
  }
  const empty = message => element("div", {class: "empty"}, icon("circle-check"), message);
  function table(headers, rows, className = "") {
    return element("div", {class: "table-wrap"}, element("table", {class: className},
      element("thead", {}, element("tr", {}, headers.map(header => element("th", {scope: "col"}, header)))), element("tbody", {}, rows)));
  }
  function linkButton(text, callback) { return element("button", {type: "button", class: "link", onclick: callback}, text); }
  function notify(message) {
    byId("toast").textContent = message; byId("toast").hidden = false;
    clearTimeout(notify.timeout); notify.timeout = setTimeout(() => { byId("toast").hidden = true; }, 5000);
  }
  async function api(path, body) {
    const options = {cache: "no-store", signal: AbortSignal.timeout(30000)};
    if (body !== undefined) Object.assign(options, {method: "POST", headers: {"Content-Type": "application/json", "X-Harness-Token": csrf}, body: JSON.stringify(body)});
    const response = await fetch(path, options), data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  function latestPlans() {
    const result = new Map();
    for (const plan of snapshot?.plans || []) if (!result.has(plan.plan_id) || result.get(plan.plan_id).version < plan.version) result.set(plan.plan_id, plan);
    return [...result.values()];
  }
  const currentPlan = () => latestPlans().find(plan => plan.plan_id === selectedPlan);
  const currentIssues = () => (snapshot?.issues || []).filter(issue => issue.plan_id === selectedPlan);
  const issueIds = () => new Set(currentIssues().map(issue => issue.issue_id));
  const currentTasks = () => { const ids = issueIds(); return allTasks.filter(task => task.issue_ids.some(id => ids.has(id))); };

  async function refresh() {
    if (refreshing) return;
    refreshing = true; byId("refresh").disabled = true;
    try {
      const [report, tasks, workflow] = await Promise.all([api("/api/status"), api("/api/tasks"), api("/api/workflow")]);
      snapshot = report; allTasks = tasks; workspaces = workflow.workspaces; online = true;
      if (!workspaces.some(item => item.workspace_id === workspaceId)) workspaceId = workspaces.at(-1)?.workspace_id || "";
      const requestedWorkspace = workspaceId;
      const detail = requestedWorkspace ? await api("/api/workflow?workspace=" + encodeURIComponent(requestedWorkspace)) : null;
      if (workspaceId !== requestedWorkspace) { setTimeout(refresh, 0); return; }
      workspaceDetail = detail;
      loadRequirementsEditor();
      if (!currentPlan()) selectedPlan = (latestPlans().find(plan => plan.state === "Executing") || latestPlans()[0])?.plan_id || "";
      byId("connection-error").hidden = true; render();
      if (openIssue) await showIssue(openIssue, true);
      if (activeView === "activity") await refreshLog();
      if (activeView === "models") await refreshModels();
    } catch (error) {
      online = false; byId("connection-error").textContent = "Connection unavailable: " + error.message;
      byId("connection-error").hidden = false; renderControls();
    } finally {
      refreshing = false; byId("refresh").disabled = false;
      byId("connection").className = "connection " + (online ? "online" : "offline");
      byId("connection-label").textContent = online ? "Connected" : "Offline";
    }
  }
  function render() {
    const plans = latestPlans(), select = byId("plan-select"), signature = JSON.stringify(plans.map(plan => [plan.plan_id, plan.version]));
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...(plans.length ? plans.map(plan => element("option", {value: plan.plan_id}, `${plan.plan_id} / v${plan.version}`)) : [element("option", {}, "No plans")]));
      select.dataset.signature = signature;
    }
    select.disabled = !plans.length; select.value = selectedPlan;
    const plan = currentPlan(), issues = currentIssues(), tasks = currentTasks();
    byId("plan-title").textContent = plan?.plan_id || "Harness workspace";
    byId("plan-eyebrow").textContent = plan ? `PLAN / VERSION ${plan.version}` : "WORKSPACE";
    byId("plan-meta").textContent = plan ? `${issues.length} issues / digest ${plan.digest} / approval ${plan.approval}`
      + (plan.run_branch ? ` / run branch ${plan.run_branch}` : "") : "No plans in this store.";
    if (workspaceDetail?.draft_stale) byId("plan-meta").textContent += " / requirements changed since the draft";
    fill("plan-state", badge(plan?.cancel_requested && plan.state === "Executing" ? "Cancelling" : plan?.pause_requested ? "Pausing" : plan?.state || "No plan"));
    fill("isolation", icon("shield-check"), badge("Tier " + snapshot.isolation.tier, snapshot.isolation.tier === "A" ? "positive" : "warning"));
    byId("isolation").title = snapshot.isolation.reason; byId("store-path").textContent = snapshot.store;
    byId("mode-badge").hidden = !snapshot.read_only; byId("issue-count").textContent = issues.filter(issue => !snapshot.archived_issues.includes(issue.issue_id)).length;
    byId("task-count").textContent = tasks.length; byId("task-count").hidden = !tasks.length;
    byId("updated-time").textContent = "Updated " + formatTime(snapshot.now);
    const total = snapshot.usage_detail?.total, measured = total && total.counts.agent_estimate + total.counts.size_estimate > 0;
    byId("usage-note").textContent = "Tokens and cost: " + (measured ? snapshot.usage : "unavailable"); byId("usage-note").title = snapshot.usage || "";
    const failedRun = snapshot.managed_runs.find(job => job.plan_id === selectedPlan && !job.running && job.exit_code !== 0);
    const preparation = workspaces.filter(item => item.plan_id === selectedPlan).map(item => item.job).filter(Boolean)
      .sort((left, right) => (left.started_at || 0) - (right.started_at || 0)).at(-1);
    const failedPreparation = preparation?.state === "failed" ? preparation : null;
    const notice = plan?.paused_reason && plan.state === "Paused" ? plan.paused_reason : plan?.cancel_requested && plan.state === "Executing" ? "Cancellation requested; waiting for the runner to finish." : plan?.pause_requested && plan.state === "Executing" ? "Pause requested; active execution is draining." : failedRun ? `Runner exited with code ${failedRun.exit_code}.` : failedPreparation ? `${failedPreparation.kind}: preparation failed. ${failedPreparation.error || "Open Planning to read the output."}` : preparation?.state === "running" ? `${preparation.kind}: preparation running, the output follows in Planning.` : "";
    byId("plan-notice").textContent = notice; byId("plan-notice").hidden = !notice;
    byId("plan-notice").className = "banner" + (failedRun || failedPreparation ? " error" : "");
    renderMetrics(); renderExecution(); renderPhases(); renderAttention(); renderCoverage(); renderIssues(); renderTasks(); renderEvents(); renderPlanning(); renderControls(); icons();
  }
  function renderControls() {
    const plan = currentPlan(), allowed = Boolean(plan && online && !snapshot?.read_only && !actionPending);
    const executing = plan?.state === "Executing", runnerAlive = snapshot?.runner.status === "alive";
    const managedRunning = snapshot?.managed_runs?.some(job => job.running);
    byId("run").hidden = !plan || !(["Approved", "Paused"].includes(plan.state) || executing && !runnerAlive);
    byId("run-label").textContent = plan?.state === "Approved" ? "Start run" : executing ? "Recover" : "Resume";
    byId("run").disabled = !allowed || !snapshot?.run_permitted || plan?.approval !== "valid" || runnerAlive || managedRunning;
    byId("run").title = plan?.approval !== "valid" ? "A valid signed approval is required" : !snapshot?.run_permitted ? snapshot?.isolation.reason || "Isolation is not verified" : runnerAlive || managedRunning ? "A runner is already active" : "Start approved live execution";
    byId("pause").hidden = !executing; byId("pause").disabled = !allowed || plan?.pause_requested;
    byId("plan-actions").hidden = !plan || !["Approved", "Executing", "Paused", "Draft", "Proposed"].includes(plan.state);
    byId("pause-now").hidden = !executing; byId("cancel-drain").hidden = !executing;
    for (const id of ["pause-now", "cancel-drain", "cancel-now"]) byId(id).disabled = !allowed;
    for (const button of document.querySelectorAll(".task button")) button.disabled = !online || Boolean(snapshot?.read_only) || button.dataset.pending === "true";
    renderWorkflowControls(); renderArchiveControls();
  }
  function renderWorkflowControls() {
    const editable = online && !snapshot?.read_only && !actionPending;
    for (const id of ["preview-requirements", "save-requirements", "add-requirement"]) byId(id).disabled = !editable;
    byId("update-requirements").disabled = !editable || !workspaceDetail;
    const detail = workspaceDetail, running = workspaces.some(item => item.job?.state === "running");
    const verifying = snapshot?.isolation_verification?.job?.state === "running";
    const ready = editable && detail && !running && !verifying && snapshot?.isolation.tier === "A";
    byId("verify-isolation").disabled = !editable || running || verifying;
    byId("verify-isolation").textContent = verifying ? "Verifying isolation..." : "Verify isolation";
    const state = detail?.plan?.state, revisable = !state || ["Draft", "Proposed", "Cancelled"].includes(state);
    const staleDraft = Boolean(detail?.draft_stale);
    byId("investigate-plan").disabled = !ready || !revisable || (Boolean(detail?.draft) && !staleDraft);
    byId("prepare-plan").disabled = !ready || !revisable || !detail?.draft || staleDraft || Boolean(detail?.questions.length);
    byId("revise-plan").disabled = !ready || !revisable || !detail?.draft || !byId("investigation-feedback").value.trim();
    byId("import-plan").disabled = !ready || state !== "Approved";
    byId("investigate-plan").title = !revisable ? "An approved, running or paused plan cannot be revised; cancel it first" : staleDraft ? "The requirements changed; investigate them again" : detail?.draft ? "Requirements changed; revise the existing draft instead" : !ready ? "Preparation cannot start now: see the notice above" : "Draft phases and issues from the requirements";
    byId("prepare-plan").title = staleDraft ? "The requirements changed; investigate again first" : detail?.questions.length ? "Answer the investigator's questions first" : !detail?.draft ? "Investigate first to draft phases and issues" : !revisable ? "An approved, running or paused plan cannot be revised" : !ready ? "Preparation cannot start now: see the notice above" : "Run the investigation, checks and planning steps";
    byId("approve-plan").disabled = !ready || state !== "Proposed" || !detail?.preflight || Boolean(detail?.questions.length)
      || byId("approval-confirm").value !== detail?.plan?.digest.slice(0, 12);
    byId("approve-plan").title = !ready ? "Approval cannot start now: see the notice above"
      : state !== "Proposed" ? `Only a Proposed plan can be approved; this one is ${state || "not prepared"}`
      : !detail?.preflight ? "Prepare plan and checks first" : detail?.questions.length ? "Answer the investigator's questions first"
      : byId("approval-confirm").value !== detail?.plan?.digest.slice(0, 12) ? "Type the first 12 characters of the digest exactly" : "Approve the reviewed plan";
    byId("import-plan").title = !ready ? "Import cannot start now: see the notice above"
      : state !== "Approved" ? `Only an approved plan can be imported; this one is ${state || "not prepared"}` : "Import the approved issues";
    for (const button of byId("investigation-answers").querySelectorAll("button")) button.disabled = !ready || !revisable;
  }
  function renderPlanning() {
    const verification = snapshot.isolation_verification, verificationJob = verification.job;
    fill("verification-state", badge(verificationJob?.state || "Not started here"));
    byId("verification-reason").textContent = snapshot.isolation.reason;
    byId("verification-output").textContent = (verificationJob?.error ? verificationJob.error + "\n\n" : "")
      + (verification.output || "No verification started from this dashboard.");
    const select = byId("workspace-select"), signature = JSON.stringify(workspaces.map(item => [item.workspace_id, item.name]));
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...(workspaces.length ? workspaces.map(item => element("option", {value: item.workspace_id}, item.name + " / " + item.plan_id)) : [element("option", {value: ""}, "No workspaces")]));
      select.dataset.signature = signature;
    }
    select.value = workspaceId;
    const detail = workspaceDetail; byId("workspace-detail").hidden = !detail;
    if (!detail) return;
    byId("workspace-title").textContent = detail.plan_id;
    const job = detail.job;
    fill("workflow-state", job ? [job.kind + ": ", badge(job.state)] : badge("Requirements saved"));
    byId("workflow-output").textContent = (job?.error ? job.error + "\n\n" : "") + (detail.output || "No preparation output yet.");
    byId("planning-report").textContent = detail.report || "Start investigation to draft phases and issues.";
    byId("planning-definitions").textContent = JSON.stringify({requirements: detail.requirements, plan: detail.plan?.plan || null, draft: detail.draft}, null, 2);
    byId("planning-preflight").textContent = JSON.stringify(detail.preflight, null, 2);
    byId("approval-digest").textContent = detail.plan ? `v${detail.plan.plan.version} / ${detail.plan.state} / digest ${detail.plan.digest}` : "Prepare the plan before approval.";
    const questions = detail.questions, target = byId("investigation-questions"), questionSignature = JSON.stringify([workspaceId, questions]);
    byId("investigation-answers").hidden = !questions.length;
    if (target.dataset.signature !== questionSignature) {
      target.replaceChildren(...questions.map(question => field(`${question.id}: ${question.question}\n${question.why}${question.options?.length ? "\nOptions: " + question.options.join("; ") : ""}`,
        element("textarea", {name: question.id, rows: 3, required: true}))));
      target.dataset.signature = questionSignature;
    }
  }
  function loadRequirementsEditor() {
    const detail = workspaceDetail;
    if (!detail || requirementsLoadedFor === detail.workspace_id) return;
    requirementsLoadedFor = detail.workspace_id;
    requirementRows = (detail.requirements || []).map(row => ({id: row.id, title: row.title}));
    byId("requirements-name").value = detail.name || "requirements.md";
    byId("requirements-markdown").value = detail.source || (detail.requirements || []).map(row => "- " + row.title).join("\n");
    byId("requirements-editor").hidden = !requirementRows.length;
    renderRequirementEditor();
  }
  function renderRequirementEditor() {
    fill("editable-requirements", requirementRows.map(row => {
      const id = element("input", {value: row.id, "aria-label": "Requirement ID", required: true});
      const text = element("textarea", {rows: 3, "aria-label": "Requirement text", required: true});
      text.value = row.title;
      id.addEventListener("input", () => { row.id = id.value; });
      text.addEventListener("input", () => { row.title = text.value; });
      return element("div", {class: "section"}, field("ID", id), field("Requirement", text),
        element("button", {type: "button", class: "command", onclick: () => { requirementRows = requirementRows.filter(item => item !== row); renderRequirementEditor(); }}, "Remove"));
    }));
    byId("requirements-editor").hidden = false;
  }
  async function workflowAction(kind, extra = {}) {
    const detail = workspaceDetail;
    try {
      byId("workflow-error").hidden = true;
      const body = {workspace_id: workspaceId, ...extra};
      if (detail?.plan) Object.assign(body, {version: detail.plan.plan.version, digest: detail.plan.digest});
      if (await perform("/api/workflow/" + kind, body)) {
        byId("approval-confirm").value = "";
        notify(kind === "approve" ? "Plan approved. Import its issues next." : "Preparation started. Output will refresh here.");
      }
    } catch (error) { byId("workflow-error").textContent = error.message; byId("workflow-error").hidden = false; }
  }
  function renderMetrics() {
    const plan = currentPlan(), issues = currentIssues(), done = issues.filter(issue => issue.state === "Done").length;
    const blocked = issues.filter(issue => issue.state === "Blocked").length, budget = snapshot.budgets[plan?.plan_id];
    const metric = (label, value, note) => element("div", {class: "metric"}, element("div", {class: "metric-label"}, label), element("div", {class: "metric-value"}, value), element("div", {class: "metric-note"}, note));
    fill("metrics", metric("Completed", `${done} / ${issues.length}`, blocked ? `${blocked} blocked` : "No blockers"),
      metric("Run time", duration(budget?.wall_clock_s.used), budget ? "of " + duration(budget.wall_clock_s.limit) : "Not started"),
      metric("Pull requests", budget ? `${budget.pull_requests.used} / ${budget.pull_requests.limit}` : "0", "Current run"),
      metric("Human tasks", currentTasks().length, currentTasks().filter(task => task.state === "Requested").length + " awaiting acknowledgement"));
  }
  function renderExecution() {
    const ids = issueIds(), workers = snapshot.workers.filter(worker => ids.has(worker.issue)), checks = snapshot.checks.filter(job => job.plan_id === selectedPlan);
    const rows = workers.map(worker => element("tr", {}, element("td", {}, icon("activity")),
      element("td", {}, linkButton(worker.issue, () => showIssue(worker.issue)), element("div", {class: "small muted"}, worker.attempt_id)),
      element("td", {}, worker.role || "Worker"), element("td", {}, worker.model || worker.tier || "-"),
      element("td", {}, duration(worker.elapsed_s)), element("td", {}, worker.lease_expires_in_s > 0 ? duration(worker.lease_expires_in_s) : badge("Expired", "negative"))));
    for (const job of checks) {
      const phase = job.issue_id.startsWith("phase-") ? job.issue_id.slice(6) : "";
      const label = phase ? linkButton("phase " + phase, () => { byId("phase-filter").value = phase; selectView("issues"); renderIssues(); })
        : ids.has(job.issue_id) ? linkButton(job.issue_id, () => showIssue(job.issue_id)) : job.issue_id;
      rows.push(element("tr", {}, element("td", {}, icon("list-checks")),
        element("td", {}, label, element("div", {class: "mono muted"}, shortened(job.head_rev))),
        element("td", {}, "Checks / " + job.stage), element("td", {}, job.runner),
        element("td", {}, job.elapsed_s == null ? "-" : duration(job.elapsed_s)),
        element("td", {}, job.lease_expires_in_s > 0 ? duration(job.lease_expires_in_s) : badge("Expired", "negative"))));
    }
    fill("execution", rows.length ? table(["", "Issue / attempt", "Role", "Model / runner", "Elapsed", "Lease"], rows, "execution-table") : empty("No active workers or checks."));
    fill("runner-state", badge(snapshot.runner.status === "alive" ? "Runner healthy" : snapshot.runner.status === "none" ? "No runner" : "Runner stale", snapshot.runner.status === "alive" ? "positive" : ""));
  }
  function renderPhases() {
    const plan = currentPlan(), phases = snapshot.phases.filter(phase => phase.plan_id === selectedPlan && phase.version === plan?.version);
    byId("phase-count").textContent = `${phases.filter(phase => phase.state === "Done").length} / ${phases.length} done`;
    fill("phases", phases.length ? phases.map(phase => {
      const total = Object.values(phase.issues).reduce((sum, count) => sum + count, 0), done = phase.issues.Done || 0;
      return element("div", {class: "phase-row"}, element("div", {class: "phase-top"}, linkButton(phase.phase, () => { byId("phase-filter").value = phase.phase; selectView("issues"); renderIssues(); icons(); }), badge(phase.state)),
        element("div", {class: "phase-bottom"}, element("progress", {value: done, max: Math.max(1, total), "aria-label": phase.phase + " completion"}), element("span", {}, `${done} / ${total} issues`)));
    }) : empty("No phases."));
  }
  function renderAttention() {
    const ids = issueIds(), blockers = snapshot.blockers.filter(blocker => ids.has(blocker.issue_id));
    const items = blockers.map(blocker => {
      const task = currentTasks().find(item => item.issue_ids.includes(blocker.issue_id));
      return element("div", {class: "attention-row"}, icon("circle-alert"), element("div", {}, linkButton(blocker.issue_id, () => showIssue(blocker.issue_id)),
        element("p", {}, blocker.reason || task?.why || (blocker.unmet_dependencies.length ? "Waiting on " + blocker.unmet_dependencies.join(", ") : "Blocked")), task ? linkButton(task.task_id, () => selectView("tasks")) : null));
    });
    for (const task of currentTasks().filter(task => !blockers.some(blocker => task.issue_ids.includes(blocker.issue_id)))) items.push(element("div", {class: "attention-row"}, icon("circle-help"), element("div", {}, linkButton(task.task_id, () => selectView("tasks")), element("p", {}, task.why))));
    byId("attention-count").textContent = items.length ? String(items.length) : ""; fill("attention", items.length ? items : empty("Nothing needs attention."));
  }
  function renderCoverage() {
    const plan = currentPlan(), requirements = snapshot.requirements.filter(item => item.plan_id === selectedPlan && item.version === plan?.version);
    byId("coverage-count").textContent = `${requirements.filter(item => item.coverage === "verified").length} / ${requirements.length} verified`;
    byId("requirements").className = requirements.length ? "coverage" : "";
    fill("requirements", requirements.length ? requirements.map(item => element("div", {class: "coverage-item", title: item.title}, element("strong", {}, item.id), badge(item.coverage, item.coverage === "verified" ? "positive" : item.coverage === "in progress" ? "active" : ""))) : empty("No requirements."));
  }
  function setOptions(select, values, allLabel) {
    const signature = JSON.stringify(values); if (select.dataset.signature === signature) return;
    const old = select.value; select.replaceChildren(element("option", {value: ""}, allLabel), ...values.map(value => element("option", {value}, value)));
    if (values.includes(old)) select.value = old; select.dataset.signature = signature;
  }
  function pullRequest(number) {
    return snapshot.repository && number ? element("a", {href: `https://github.com/${snapshot.repository}/pull/${Number(number)}`, target: "_blank", rel: "noopener noreferrer", title: "Open pull request"}, "#" + number) : number ? "#" + number : "-";
  }
  function renderIssues() {
    const issues = currentIssues(), ids = issueIds(), metadata = new Map(issues.map(issue => [issue.issue_id, issue]));
    setOptions(byId("state-filter"), [...new Set(issues.map(issue => issue.state))].sort(), "All states");
    setOptions(byId("phase-filter"), [...new Set(issues.map(issue => issue.phase))].sort(), "All phases");
    const query = byId("issue-search").value.trim().toLowerCase();
    const archived = new Set(snapshot.archived_issues), showArchived = byId("show-archived").checked;
    const filtered = snapshot.queue.filter(issue => ids.has(issue.issue_id) && (showArchived || !archived.has(issue.issue_id)) && (!byId("state-filter").value || issue.state === byId("state-filter").value)
      && (!byId("phase-filter").value || issue.phase === byId("phase-filter").value)
      && (!query || `${issue.issue_id} ${issue.phase} ${metadata.get(issue.issue_id).blocked_reason}`.toLowerCase().includes(query)));
    const selectable = filtered.filter(issue => issue.state === "Done");
    for (const id of selectedIssues) if (!selectable.some(issue => issue.issue_id === id)) selectedIssues.delete(id);
    const checkbox = issue => element("input", {type: "checkbox", checked: selectedIssues.has(issue.issue_id), disabled: issue.state !== "Done",
      "aria-label": "Select " + issue.issue_id, onchange: event => { if (event.target.checked) selectedIssues.add(issue.issue_id); else selectedIssues.delete(issue.issue_id); renderArchiveControls(); }});
    const all = element("input", {type: "checkbox", "aria-label": "Select all visible Done issues", disabled: !selectable.length,
      checked: selectable.length > 0 && selectable.every(issue => selectedIssues.has(issue.issue_id)),
      onchange: event => { selectedIssues.clear(); if (event.target.checked) for (const issue of selectable) selectedIssues.add(issue.issue_id); renderIssues(); }});
    byId("filtered-count").textContent = `${filtered.length} / ${issues.length} (${issues.filter(issue => archived.has(issue.issue_id)).length} archived)`;
    fill("issues", filtered.length ? table([all, "Issue", "Phase", "State", "Pull request", "Context"], filtered.map(issue => element("tr", {},
      element("td", {}, checkbox(issue)),
      element("td", {}, linkButton(issue.issue_id, () => showIssue(issue.issue_id))), element("td", {}, issue.phase), element("td", {}, badge(issue.state)), element("td", {}, pullRequest(issue.pr)),
      element("td", {class: "muted"}, archived.has(issue.issue_id) ? "Archived" : metadata.get(issue.issue_id).blocked_reason || (issue.unmet_dependencies.length ? "Waiting on " + issue.unmet_dependencies.join(", ") : shortened(issue.head))))), "issue-table") : empty(query || byId("state-filter").value || byId("phase-filter").value ? "No matching issues." : "No visible issues."));
    renderArchiveControls();
  }
  function renderArchiveControls() {
    const allowed = online && !snapshot?.read_only && !actionPending, archived = new Set(snapshot?.archived_issues || []);
    byId("archive-issues").disabled = !allowed || ![...selectedIssues].some(id => !archived.has(id));
    byId("restore-issues").disabled = !allowed || ![...selectedIssues].some(id => archived.has(id));
  }
  function field(label, input) { return element("label", {class: "field"}, label, input); }
  function taskForm(task) {
    const saved = drafts.get(task.task_id) || {}, card = element("article", {class: "task", id: "task-" + task.task_id, tabindex: "-1"});
    card.append(element("div", {class: "task-header"}, element("h3", {}, task.task_id), badge(task.kind), element("span", {class: "task-state"}, badge(task.state))),
      element("p", {}, task.why), element("p", {class: "muted"}, task.request), element("p", {class: "small muted"}, `Owner ${task.owner} / ${duration(task.age_s)} waiting / ${task.issue_ids.join(", ")}`));
    for (const failure of task.evidence || task.extra?.evidence || []) card.append(element("div", {class: "failure"}, `${failure.kind} (${failure.class}): ${failure.detail || ""}`));
    if (task.kind === "manual_test") card.append(element("details", {class: "evidence"}, element("summary", {}, "Test context"), element("pre", {class: "log"}, JSON.stringify(task.extra, null, 2))));
    if (task.extra?.analysis) card.append(element("details", {class: "evidence", open: ""}, element("summary", {}, "Strong analysis"), element("pre", {class: "log"}, JSON.stringify(task.extra.analysis, null, 2))));
    const form = element("form"), known = new Set(), add = (name, label, options = {}) => {
      known.add(name);
      const input = options.multiline ? element("textarea", {name, rows: 3, required: options.required}) : element("input", {name, type: "text", required: options.required});
      input.value = saved[name] ?? options.value ?? ""; form.append(field(label, input)); return input;
    };
    if (task.kind === "decision") {
      known.add("option"); form.append(element("fieldset", {}, element("legend", {}, "Decision"), task.options.map(option => element("label", {class: "choice"},
        element("input", {type: "radio", name: "option", value: option, checked: saved.option === option, required: true}), element("span", {}, option)))));
      add("guidance", "Guidance", {multiline: true});
    } else if (task.kind === "manual_test") {
      known.add("outcome");
      const outcome = element("select", {name: "outcome", required: true}, element("option", {value: ""}, "Select outcome"), ["pass", "fail", "inconclusive"].map(value => element("option", {value}, value)));
      outcome.value = saved.outcome || ""; form.append(field("Outcome", outcome));
      add("tester", "Tester", {required: true, value: task.owner}); add("revision", "Tested revision", {required: true, value: task.extra?.tested_head || ""});
      add("evidence", "Evidence references", {multiline: true}); add("notes", "Notes", {multiline: true});
    } else {
      form.append(field("Asset file", element("input", {type: "file", name: "artifact", required: true}))); known.add("artifact");
      add("source", "Source", {required: true}); add("license", "License", {required: true}); add("author", "Author", {required: true}); add("attribution", "Attribution");
    }
    for (const name of task.response_format.required || []) if (!known.has(name)) add(name, name.replaceAll("_", " "), {required: true});
    for (const name of task.response_format.optional || []) if (!known.has(name)) add(name, name.replaceAll("_", " "));
    const errorBox = element("div", {class: "failure", role: "alert", hidden: true});
    const submit = element("button", {type: "submit", class: "command primary", disabled: snapshot.read_only || !online}, icon("check"), "Submit response");
    const controls = element("div", {class: "form-actions"}, submit);
    if (task.state === "Requested") controls.append(element("button", {type: "button", class: "command", "data-acknowledge": true, disabled: snapshot.read_only || !online, onclick: async event => {
      const button = event.currentTarget; button.disabled = true; button.dataset.pending = "true";
      try { await api("/api/respond", {task_id: task.task_id, ack: true}); notify("Task acknowledged"); await refresh(); }
      catch (error) { notify(error.message); }
      finally { button.dataset.pending = "false"; button.disabled = Boolean(snapshot.read_only) || !online; }
    }}, icon("check"), "Acknowledge"));
    form.append(errorBox, controls); card.append(form);
    form.addEventListener("input", () => drafts.set(task.task_id, Object.fromEntries([...new FormData(form)].filter(([, value]) => typeof value === "string"))));
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (submit.disabled) return;
      const answers = Object.fromEntries([...new FormData(form)].filter(([name]) => name !== "artifact"));
      if (answers.option === "cancel the issue" && !globalThis.confirm("Cancel " + task.issue_ids.join(", ") + "? Dependent work will not run.")) return;
      if (answers.evidence !== undefined) answers.evidence = answers.evidence.split("\n").map(line => line.trim()).filter(Boolean);
      submit.disabled = true; submit.dataset.pending = "true"; errorBox.hidden = true;
      try {
        const body = {task_id: task.task_id, answers}, file = form.elements.namedItem("artifact")?.files?.[0];
        if (file) {
          if (file.size > 10 * 1024 * 1024) throw new Error("The GUI upload limit is 10 MiB.");
          body.upload = {name: file.name, data: await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file);
          })};
        }
        const result = await api("/api/respond", body);
        if (result.status !== "resolved") { await refresh(); if (result.status === "stale") notify(result.reason); throw new Error(result.reason || result.status); }
        drafts.delete(task.task_id); notify("Response recorded"); await refresh();
      } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
      finally { submit.dataset.pending = "false"; submit.disabled = Boolean(snapshot.read_only) || !online; }
    });
    return card;
  }
  function renderTasks() {
    const tasks = currentTasks(); byId("tasks-count").textContent = `${tasks.length} open`;
    if (!tasks.length) { fill("tasks", empty("No open human tasks.")); return; }
    fill("tasks", tasks.map(task => {
      const previous = taskNodes.get(task.task_id), signature = JSON.stringify([task.kind, task.round, task.owner, task.why, task.request, task.options, task.extra, task.response_format]);
      if (task.kind === "manual_test" && previous && previous.head !== task.extra?.tested_head) {
        const draft = drafts.get(task.task_id) || {};
        for (const name of ["revision", "outcome", "evidence"]) delete draft[name];
        drafts.set(task.task_id, draft);
      }
      if (previous?.signature !== signature) taskNodes.set(task.task_id, {signature, head: task.extra?.tested_head, node: taskForm(task)});
      const node = taskNodes.get(task.task_id).node;
      node.querySelector(".task-state").replaceChildren(badge(task.state));
      if (task.state !== "Requested") node.querySelector("[data-acknowledge]")?.remove();
      return node;
    }));
  }
  function renderEvents() {
    const events = snapshot.events.filter(event => !event.plan_id || event.plan_id === selectedPlan).slice().reverse();
    fill("events", events.length ? table(["Time", "Event", "Issue", "Detail"], events.map(event => element("tr", {}, element("td", {class: "mono"}, formatTime(event.ts)), element("td", {}, event.type),
      element("td", {}, event.issue_id ? linkButton(event.issue_id, () => showIssue(event.issue_id)) : "-"), element("td", {class: "muted"}, Object.entries(event.data || {}).filter(([key]) => !["issue", "issue_id"].includes(key)).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join(" / ").slice(0, 240)))), "event-table") : empty("No recent activity."));
  }
  async function refreshLog() {
    try { const log = await api("/api/log?plan=" + encodeURIComponent(selectedPlan)); byId("run-log").textContent = log.output || "No runner output."; }
    catch (error) { byId("run-log").textContent = error.message; }
  }
  async function showIssue(id, quiet = false) {
    if (!quiet) { openIssue = id; issueSignature = ""; fill("issue-detail", element("p", {class: "muted"}, "Loading")); if (!byId("issue-dialog").open) byId("issue-dialog").showModal(); }
    try {
      const detail = await api("/api/issue/" + encodeURIComponent(id)); if (openIssue !== id) return;
      const signature = JSON.stringify(detail); if (quiet && signature === issueSignature) return; issueSignature = signature;
      const issue = detail.issue, definitions = element("dl");
      for (const [label, value] of [["Phase", issue.phase_id], ["Requirements", issue.requirement_ids.join(", ")], ["Branch", issue.branch], ["Head", issue.head_rev || "-"], ["Base", issue.base_rev || "-"], ["Pull request", pullRequest(issue.pr)], ["Dependencies", issue.deps.join(", ") || "-"]]) definitions.append(element("dt", {}, label), element("dd", {}, value));
      const children = [badge(detail.state), element("h2", {}, issue.issue_id), element("p", {class: "muted"}, issue.title), definitions];
      if (issue.blocked_reason) children.push(element("div", {class: "failure"}, issue.blocked_reason));
      for (const [label, values] of [["Outcomes", issue.outcomes], ["Acceptance criteria", issue.acceptance_criteria], ["Non-goals", issue.non_goals], ["Code anchors", issue.code_anchors], ["Validation commands", issue.validation_commands]]) if (values.length) children.push(element("h3", {}, label), element("ul", {}, values.map(value => element("li", {}, value))));
      children.push(element("h3", {}, "Evidence"));
      if (!detail.evidence.length) children.push(element("p", {class: "muted"}, "No evidence."));
      for (const evidence of detail.evidence.slice().reverse()) children.push(element("details", {class: "evidence"}, element("summary", {}, element("strong", {}, evidence.kind), badge(evidence.verdict), element("span", {class: "mono muted"}, shortened(evidence.head_rev)), badge(evidence.valid ? "Current" : "Invalidated", evidence.valid ? "" : "warning")), element("pre", {class: "log"}, JSON.stringify(evidence.detail, null, 2))));
      if (detail.attempts.length) children.push(element("h3", {}, "Attempts"), table(["Attempt", "Role", "Model", "Outcome", "Est. tokens"], detail.attempts.map(attempt => element("tr", {}, element("td", {}, attempt.attempt_id), element("td", {}, attempt.role), element("td", {}, attempt.model || attempt.tier || "-"), element("td", {}, badge(attempt.outcome || "Running")), element("td", {class: "small muted"}, tokensText(attempt))))));
      if (detail.human_tasks.length) children.push(element("h3", {}, "Human tasks"), element("ul", {}, detail.human_tasks.map(task => element("li", {}, task.task_id + " / " + task.state + ": " + task.why))));
      if (detail.journal.length) children.push(element("h3", {}, "History"), element("ul", {}, detail.journal.map(entry => element("li", {}, `${formatTime(entry.ts)} / ${entry.from_state || "New"} -> ${entry.to_state} / ${entry.actor}`))));
      fill("issue-detail", children); icons();
    } catch (error) { if (!quiet) fill("issue-detail", element("div", {class: "failure"}, error.message)); }
  }
  async function refreshModels() {
    clearTimeout(modelTimer); modelTimer = null;
    try {
      modelState = await api("/api/models"); renderModels();
      if (modelState.probing) modelTimer = setTimeout(refreshModels, 4000);
    } catch (error) {
      byId("models-error").textContent = "Models unavailable: " + error.message; byId("models-error").hidden = false;
    }
  }
  function renderModels() {
    const state = modelState; if (!state) return;
    const sources = state.sources || [];
    if (!byId("model-sources").dataset.ready) {
      fill("model-sources", sources.map(source => element("label", {class: "choice"},
        element("input", {type: "checkbox", value: source, checked: true}), source)));
      byId("model-sources").dataset.ready = "true";
    }
    const probe = state.probe, checkedAt = probe?.checked_at || state.cache?.checked_at;
    // Two evidence sources, each a positive list from a different candidate set. Union them:
    // an empty probe result must not hide ids a previous probe accepted ([] is truthy in JS),
    // and an id is only "rejected" when some probe actually asked about it.
    const evidence = state.probing ? [] : [probe, state.cache].filter(Boolean);
    const available = new Set(evidence.flatMap((result) => result.available || []));
    const asked = new Set(evidence.flatMap((result) => result.candidates || []));
    byId("models-checked").textContent = state.probing ? "Probing..." : checkedAt ? "Checked " + formatTime(checkedAt) : "Never probed";
    const rows = [];
    for (const source of sources) for (const tier of ["low", "standard", "strong"]) for (const id of (state.catalog?.[source]?.[tier] || [])) {
      const accepted = available.has(id), rejected = !accepted && asked.has(id);
      rows.push(element("tr", {}, element("td", {}, source), element("td", {}, tier), element("td", {class: "mono small"}, id),
        element("td", {}, badge(accepted ? "accepted" : rejected ? "rejected" : "not probed",
          accepted ? "positive" : rejected ? "negative" : ""))));
    }
    fill("models-table", rows.length ? table(["Source", "Tier", "Model", "This runtime"], rows) : empty("No candidate ids in the catalog."));
    const button = byId("probe-models"), wait = state.probe_after_s || 0;
    button.disabled = Boolean(state.read_only || state.probing || wait);
    button.title = state.read_only ? "Read-only mode does not probe the runtime" : state.probing ? "A probe is running"
      : wait ? `Probe again in ${wait}s` : "Ask the runtime which ids it accepts";
    const problem = state.probe_error || (probe && !probe.reachable ? "Model routing unavailable: " + (probe.reason || "unknown reason") : "");
    byId("models-error").textContent = problem; byId("models-error").hidden = !problem;
    icons();
  }
  function selectView(view) {
    activeView = view;
    for (const section of document.querySelectorAll("main>.view")) section.hidden = section.id !== "view-" + view;
    for (const button of document.querySelectorAll("[data-view]")) button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
    closeNavigation(); if (view === "activity") refreshLog();
    if (view === "models") refreshModels();
  }
  function updateNavigation() {
    const open = byId("app").classList.contains("nav-open");
    byId("sidebar").inert = mobile.matches && !open;
    byId("menu-toggle").setAttribute("aria-expanded", String(open));
  }
  function closeNavigation() { byId("app").classList.remove("nav-open"); byId("nav-backdrop").hidden = true; updateNavigation(); }
  async function perform(path, body) {
    if (actionPending) return false;
    actionPending = true; renderControls();
    try { await api(path, body); await refresh(); return true; }
    finally { actionPending = false; renderControls(); }
  }
  function confirmAction(kind, options = {}) {
    const plan = currentPlan(); if (!plan) return; byId("plan-actions").open = false;
    confirmation = {path: "/api/" + kind, body: {plan_id: plan.plan_id, version: plan.version, ...options}, needsText: kind !== "pause"};
    const title = kind === "resume" ? (plan.state === "Approved" ? "Start live run" : "Resume live run") : kind === "pause" ? "Pause now" : options.drain ? "Cancel after active work" : "Cancel plan";
    byId("confirm-title").textContent = title;
    byId("confirm-copy").textContent = kind === "resume" ? `${plan.plan_id}: approved workers will run. Eligible merges can deploy to production.` : kind === "pause" ? `${plan.plan_id}: active workers and check jobs will be cancelled.` : `${plan.plan_id}: cancellation is permanent.${options.drain ? " Active work will finish first." : " Active work will be stopped."}`;
    byId("confirm-plan").value = ""; byId("confirm-plan").placeholder = plan.plan_id; byId("confirm-field").hidden = !confirmation.needsText;
    byId("confirm-submit").textContent = title; byId("confirm-submit").className = "command " + (kind === "cancel" ? "danger" : "primary");
    byId("confirm-submit").disabled = confirmation.needsText; byId("confirm-error").hidden = true; byId("confirm-dialog").showModal();
  }
  byId("refresh").addEventListener("click", refresh);
  byId("verify-isolation").addEventListener("click", async () => {
    selectView("planning"); byId("verification-details").open = true;
    try { if (await perform("/api/isolation/verify", {})) notify("Sandbox verification started. Progress appears in Planning."); }
    catch (error) { notify(error.message); }
  });
  byId("requirements-file").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Markdown is limited to 1 MiB.");
      byId("requirements-markdown").value = await file.text(); byId("requirements-name").value = file.name;
      byId("requirements-editor").hidden = true; byId("workflow-error").hidden = true;
    } catch (error) { byId("workflow-error").textContent = error.message; byId("workflow-error").hidden = false; }
  });
  byId("requirements-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const result = await api("/api/workflow/preview", {markdown: byId("requirements-markdown").value});
      requirementRows = result.requirements; renderRequirementEditor(); byId("workflow-error").hidden = true;
    } catch (error) { byId("workflow-error").textContent = error.message; byId("workflow-error").hidden = false; }
  });
  byId("add-requirement").addEventListener("click", () => {
    let number = 1; while (requirementRows.some(row => row.id === "R" + number)) number++;
    requirementRows.push({id: "R" + number, title: ""}); renderRequirementEditor();
  });
  byId("save-requirements").addEventListener("click", async () => {
    if (actionPending) return;
    actionPending = true; renderControls();
    try {
      const record = await api("/api/workflow/create", {name: byId("requirements-name").value,
        markdown: byId("requirements-markdown").value, requirements: requirementRows});
      workspaceId = record.workspace_id; byId("new-workspace").open = false; byId("workflow-error").hidden = true;
      await refresh(); notify("Requirements saved. Start investigation when ready.");
    } catch (error) { byId("workflow-error").textContent = error.message; byId("workflow-error").hidden = false; }
    finally { actionPending = false; renderControls(); }
  });
  byId("update-requirements").addEventListener("click", async () => {
    if (actionPending || !workspaceId) return;
    actionPending = true; renderControls();
    try {
      await api("/api/workflow/requirements", {workspace_id: workspaceId,
        markdown: byId("requirements-markdown").value, requirements: requirementRows});
      byId("workflow-error").hidden = true; await refresh();
      notify("Requirements updated. Revise the draft so the plan covers them, then prepare and approve again.");
    } catch (error) { byId("workflow-error").textContent = error.message; byId("workflow-error").hidden = false; }
    finally { actionPending = false; renderControls(); }
  });
  byId("workspace-select").addEventListener("change", async event => {
    workspaceId = event.target.value; workspaceDetail = null; byId("workspace-detail").hidden = true; renderControls();
    byId("approval-confirm").value = ""; byId("investigation-feedback").value = "";
    byId("workflow-error").hidden = true; await refresh();
  });
  byId("investigate-plan").addEventListener("click", () => workflowAction("investigate"));
  byId("prepare-plan").addEventListener("click", () => workflowAction("plan"));
  byId("import-plan").addEventListener("click", () => workflowAction("import"));
  byId("revise-plan").addEventListener("click", () => workflowAction("investigate", {feedback: byId("investigation-feedback").value}));
  byId("investigation-feedback").addEventListener("input", renderWorkflowControls);
  byId("approval-confirm").addEventListener("input", renderWorkflowControls);
  byId("approve-plan-form").addEventListener("submit", event => {
    event.preventDefault(); if (!byId("approve-plan").disabled) workflowAction("approve", {confirm: byId("approval-confirm").value});
  });
  byId("investigation-answers").addEventListener("submit", event => {
    event.preventDefault(); workflowAction("investigate", {answers: Object.fromEntries(new FormData(event.target))});
  });
  byId("show-archived").addEventListener("change", () => { selectedIssues.clear(); renderIssues(); icons(); });
  for (const [id, archived] of [["archive-issues", true], ["restore-issues", false]]) byId(id).addEventListener("click", async () => {
    try {
      const existing = new Set(snapshot.archived_issues), issue_ids = [...selectedIssues].filter(issue => existing.has(issue) !== archived);
      if (await perform("/api/archive", {issue_ids, archived})) { selectedIssues.clear(); renderIssues(); notify(archived ? "Completed issues archived. History is preserved." : "Issues restored."); }
    } catch (error) { notify(error.message); }
  });
  byId("probe-models").addEventListener("click", async () => {
    const sources = [...byId("model-sources").querySelectorAll("input:checked")].map(input => input.value);
    if (!sources.length) { notify("Choose at least one model source"); return; }
    byId("probe-models").disabled = true;
    try { await api("/api/models/probe", {sources}); notify("Probe started; results appear here"); await refreshModels(); }
    catch (error) { notify(error.message); renderModels(); }
  });
  byId("plan-select").addEventListener("change", event => { selectedPlan = event.target.value; byId("issue-search").value = ""; byId("state-filter").value = ""; byId("phase-filter").value = ""; if (byId("issue-dialog").open) byId("issue-dialog").close(); render(); if (activeView === "activity") refreshLog(); });
  for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => selectView(button.dataset.view));
  for (const id of ["issue-search", "state-filter", "phase-filter"]) byId(id).addEventListener(id === "issue-search" ? "input" : "change", () => { renderIssues(); icons(); });
  byId("menu-toggle").addEventListener("click", () => { const open = byId("app").classList.toggle("nav-open"); byId("nav-backdrop").hidden = !open; updateNavigation(); if (open) byId("plan-select").focus(); });
  byId("nav-backdrop").addEventListener("click", closeNavigation);
  mobile.addEventListener("change", updateNavigation);
  document.addEventListener("keydown", event => {
    if (!mobile.matches || !byId("app").classList.contains("nav-open")) return;
    if (event.key === "Escape") { closeNavigation(); byId("menu-toggle").focus(); }
    if (event.key === "Tab") {
      const controls = [...byId("sidebar").querySelectorAll("button:not(:disabled), select:not(:disabled)")];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  });
  byId("close-issue").addEventListener("click", () => byId("issue-dialog").close()); byId("issue-dialog").addEventListener("close", () => { openIssue = null; });
  byId("run").addEventListener("click", () => confirmAction("resume"));
  byId("pause").addEventListener("click", async () => { const plan = currentPlan(); if (!plan) return; try { if (await perform("/api/pause", {plan_id: plan.plan_id, version: plan.version, now: false})) notify("Pause requested"); } catch (error) { notify(error.message); } });
  byId("pause-now").addEventListener("click", () => confirmAction("pause", {now: true}));
  byId("cancel-drain").addEventListener("click", () => confirmAction("cancel", {drain: true})); byId("cancel-now").addEventListener("click", () => confirmAction("cancel", {drain: false}));
  byId("dismiss-confirm").addEventListener("click", () => byId("confirm-dialog").close());
  byId("confirm-plan").addEventListener("input", event => { byId("confirm-submit").disabled = event.target.value !== confirmation?.body.plan_id; });
  byId("confirm-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!confirmation || byId("confirm-submit").disabled) return; byId("confirm-submit").disabled = true;
    try { if (await perform(confirmation.path, {...confirmation.body, confirm: byId("confirm-plan").value})) { byId("confirm-dialog").close(); notify("Request recorded"); } }
    catch (error) { byId("confirm-error").textContent = error.message; byId("confirm-error").hidden = false; }
    finally { byId("confirm-submit").disabled = Boolean(confirmation?.needsText && byId("confirm-plan").value !== confirmation.body.plan_id); }
  });
  updateNavigation(); icons(); refresh(); setInterval(() => { if (byId("auto-refresh").checked && !document.hidden) refresh(); }, refreshSeconds * 1000);
})();