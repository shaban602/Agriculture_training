
import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:5000/api";

const sections = [
  { name: "Dashboard", icon: "▦" },
  { name: "Farmers", icon: "♙" },
  { name: "Trainers", icon: "♧" },
  { name: "Training Events", icon: "▣" },
  { name: "Attendance", icon: "✓" },
  { name: "Product Adoption", icon: "↗" },
  { name: "Expenses", icon: "$" },
  { name: "Training Topics", icon: "≡" },
];

const configurations = {
  Farmers: {
    endpoint: "farmers",
    fields: [
      { key: "farmers_id", label: "Farmer ID", type: "number", required: true },
      { key: "full_name", label: "Full name" },
      { key: "farmers_email", label: "Email" },
      { key: "farmers_contact", label: "Contact" },
      { key: "farmers_lacation", label: "Location" },
      { key: "joined_date", label: "Joined date", type: "date" },
    ],
    id: "farmers_id",
  },
  Trainers: {
    endpoint: "trainers",
    fields: [
      { key: "trainer_id", label: "Trainer ID", type: "number", required: true },
      { key: "full_name", label: "Full name" },
      { key: "trainer_email", label: "Email" },
      { key: "trainer_contact", label: "Contact" },
      { key: "trainer_region", label: "Region" },
      { key: "hire_date", label: "Hire date", type: "date" },
    ],
    id: "trainer_id",
  },
  "Training Events": {
    endpoint: "events",
    fields: [
      { key: "event_id", label: "Event ID", type: "number", required: true },
      { key: "trainer_id", label: "Trainer ID", type: "number" },
      { key: "event_name", label: "Event name" },
      { key: "event_date", label: "Date", type: "date" },
      { key: "event_location", label: "Location" },
      { key: "event_topic", label: "Topic" },
      { key: "maxparticipants", label: "Maximum participants", type: "number" },
    ],
    id: "event_id",
  },
  Attendance: {
    endpoint: "attendance",
    fields: [
      { key: "farmers_id", label: "Farmer ID", type: "number", required: true },
      { key: "event_id", label: "Event ID", type: "number", required: true },
      { key: "attendance_date", label: "Attendance date", type: "date" },
      { key: "feedback_score", label: "Feedback score", type: "number" },
      { key: "votes", label: "Votes", type: "number" },
    ],
    id: null,
    keys: ["event_id", "farmers_id"],
  },
  "Product Adoption": {
    endpoint: "product-adoption",
    fields: [
      { key: "event_id", label: "Event ID", type: "number", required: true },
      { key: "farmers_id", label: "Farmer ID", type: "number", required: true },
      { key: "product_name", label: "Product name" },
      { key: "adoption_date", label: "Adoption date", type: "date" },
      { key: "adoption_status", label: "Adoption status" },
    ],
    id: null,
    keys: ["event_id", "farmers_id"],
  },
  Expenses: {
    endpoint: "expenses",
    fields: [
      { key: "expense_id", label: "Expense ID", type: "number", required: true },
      { key: "event_id", label: "Event ID", type: "number" },
      { key: "expense_name", label: "Expense name" },
      { key: "expense_description", label: "Description" },
      { key: "expense_date", label: "Expense date", type: "date" },
      { key: "amount", label: "Amount", type: "number" },
    ],
    id: "expense_id",
  },
  "Training Topics": {
    endpoint: "training-topics",
    fields: [
      { key: "topic_id", label: "Topic ID", type: "number", required: true },
      { key: "topic_name", label: "Topic name", required: true },
      { key: "description", label: "Description" },
    ],
    id: "topic_id",
  },
};

function normalizeRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.records)) return result.records;
  return [];
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    return value.slice(0, 10);
  }

  return String(value);
}

function App() {
  const [active, setActive] = useState("Dashboard");
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [apiErrors, setApiErrors] = useState({});
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({});
  const [editingRow, setEditingRow] = useState(null);

  const loadRecords = useCallback(async () => {
    const resources = Object.entries(configurations).filter(
      ([, config]) => config.endpoint
    );

    const results = await Promise.allSettled(
      resources.map(async ([name, config]) => {
        const response = await fetch(`${API}/${config.endpoint}`);

        if (!response.ok) {
          throw new Error(`${name}: HTTP ${response.status}`);
        }

        return [name, normalizeRows(await response.json())];
      })
    );

    const loaded = {};
    const errors = {};

    results.forEach((result, index) => {
      const name = resources[index][0];

      if (result.status === "fulfilled") {
        loaded[result.value[0]] = result.value[1];
      } else {
        errors[name] = true;
        loaded[name] = [];
      }
    });

    setRecords((previous) => ({ ...previous, ...loaded }));

    setApiErrors(errors);

    setLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(loadRecords);
  }, [loadRecords]);

  const rows = records[active] || [];
  const config = configurations[active];

  const filteredRows = rows.filter((row) =>
    Object.values(row).some((value) =>
      String(value ?? "")
        .toLowerCase()
        .includes(search.toLowerCase())
    )
  );

  function openForm() {
    const initial = {};

    config.fields.forEach((field) => {
      initial[field.key] = "";
    });

    setFormData(initial);
    setEditingRow(null);
    setShowForm(true);
    setNotice("");
  }

  function openEditForm(row) {
    const values = {};

    config.fields.forEach((field) => {
      const value = row[field.key];
      values[field.key] =
        field.type === "date" && value
          ? displayValue(value).slice(0, 10)
          : value ?? "";
    });

    setFormData(values);
    setEditingRow(row);
    setShowForm(true);
    setNotice("");
  }

  async function saveRecord(event) {
    event.preventDefault();

    if (!config?.endpoint) {
      setNotice("This section is not connected to a database endpoint yet.");
      return;
    }

    try {
      const recordKeys = config.keys || [config.id];
      const endpoint = editingRow
        ? `${API}/${config.endpoint}/${recordKeys
            .map((key) => encodeURIComponent(editingRow[key]))
            .join("/")}`
        : `${API}/${config.endpoint}`;
      const response = await fetch(endpoint, {
        method: editingRow ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(formData).map(([key, value]) => [
              key,
              value === "" ? null : value,
            ])
          )
        ),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "Could not save this record.");
      }

      setShowForm(false);
      setEditingRow(null);
      setNotice(
        editingRow ? "Record updated successfully." : "Record saved successfully."
      );
      setLoading(true);
      await loadRecords();
    } catch (error) {
      setNotice(error.message || "Unable to save the record.");
    }
  }

  async function deleteRecord(row) {
    const recordKeys = config?.keys || (config?.id ? [config.id] : []);

    if (
      !config?.endpoint ||
      recordKeys.length === 0 ||
      recordKeys.some((key) => row[key] == null)
    ) {
      setNotice("Delete is unavailable because this record has no configured ID.");
      return;
    }

    if (!window.confirm("Are you sure you want to delete this record?")) {
      return;
    }

    try {
      const response = await fetch(
        `${API}/${config.endpoint}/${recordKeys
          .map((key) => encodeURIComponent(row[key]))
          .join("/")}`,
        { method: "DELETE" }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message || "Could not delete this record.");
      }

      setNotice("Record deleted successfully.");
      setLoading(true);
      await loadRecords();
    } catch (error) {
      setNotice(error.message || "Unable to delete the record.");
    }
  }

  const stats = [
    { label: "Farmers", value: (records.Farmers || []).length, icon: "♙", section: "Farmers" },
    { label: "Trainers", value: (records.Trainers || []).length, icon: "♧", section: "Trainers" },
    { label: "Training Events", value: (records["Training Events"] || []).length, icon: "▣", section: "Training Events" },
    { label: "Attendance", value: (records.Attendance || []).length, icon: "✓", section: "Attendance" },
    { label: "Product Adoption", value: (records["Product Adoption"] || []).length, icon: "↗", section: "Product Adoption" },
    { label: "Expenses", value: (records.Expenses || []).length, icon: "$", section: "Expenses" },
    { label: "Training Topics", value: (records["Training Topics"] || []).length, icon: "≡", section: "Training Topics" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/assets/livestock-logo.svg" alt="Atlantis Life livestock logo" />
          <div>
            <h2>Atlantis Life</h2>
            <p>Livestock Training</p>
          </div>
        </div>

        <p className="sidebar-heading">MAIN MENU</p>

        <nav className="navigation">
          {sections.map((section) => (
            <button
              key={section.name}
              type="button"
              className={`nav-item ${active === section.name ? "active" : ""}`}
              onClick={() => {
                setActive(section.name);
                setSearch("");
                setShowForm(false);
                setNotice("");
              }}
            >
              <span className="nav-icon">{section.icon}</span>
              <span>{section.name}</span>
              {active === section.name && <span className="nav-arrow">›</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <strong>Atlantis Life</strong>
          <p>Livestock Training System</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Workspace / {active}</p>
            <h1>{active}</h1>
          </div>

          <div className="profile">
            <div className="avatar">A</div>
            <div>
              <strong>Administrator</strong>
              <p>System manager</p>
            </div>
          </div>
        </header>

        {active === "Dashboard" ? (
          <section className="dashboard">
            <div className="welcome-panel">
              <div>
                <span className="eyebrow">LIVESTOCK MANAGEMENT</span>
                <h2>Welcome to your training dashboard</h2>
                <p>
                  Manage farmers, organize training sessions, and monitor
                  livestock development in one place.
                </p>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setActive("Farmers")}
                >
                  View Farmers <span>→</span>
                </button>
              </div>
              <div className="welcome-icon">🐄</div>
            </div>

            <div className="section-heading">
              <div>
                <h2>Overview</h2>
                <p>A quick summary of your training activities.</p>
              </div>
              <span className="status-label">LIVE DATABASE</span>
            </div>

            {Object.keys(apiErrors).length > 0 && (
              <div className="alert error-alert">
                {Object.keys(apiErrors).join(", ")} could not be loaded. Check
                that your backend has these API routes.
              </div>
            )}

            <div className="stats-grid">
              {stats.map((stat) => (
                <button
                  className="stat-card"
                  key={stat.label}
                  type="button"
                  onClick={() => setActive(stat.section)}
                  aria-label={`${stat.label}: ${stat.value} records. Open ${stat.section}.`}
                >
                  <div className="stat-top">
                    <span>{stat.label}</span>
                    <span className="stat-icon">{stat.icon}</span>
                  </div>
                  <strong className="stat-value">
                    {loading ? "..." : stat.value}
                  </strong>
                  <span className="stat-caption">Records in the database</span>
                </button>
              ))}
            </div>

            <div className="recent-panel">
              <div className="section-heading">
                <div>
                  <h2>Recent Farmers</h2>
                  <p>Farmers retrieved from your database.</p>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setActive("Farmers")}
                >
                  View all
                </button>
              </div>

              {(records.Farmers || []).length === 0 ? (
                <p className="empty-state">
                  {loading
                    ? "Loading farmers..."
                    : "No farmer records available."}
                </p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Farmer ID</th>
                        <th>Full name</th>
                        <th>Email</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(records.Farmers || []).slice(0, 5).map((farmer, index) => (
                        <tr key={farmer.farmers_id ?? index}>
                          <td>{displayValue(farmer.farmers_id)}</td>
                          <td>{displayValue(farmer.full_name)}</td>
                          <td>{displayValue(farmer.farmers_email)}</td>
                          <td>{displayValue(farmer.farmers_lacation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="records-panel">
            <div className="section-heading">
              <div>
                <h2>{active} Management</h2>
                <p>View and manage your {active.toLowerCase()} records.</p>
              </div>

              {active !== "Reports" && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={openForm}
                >
                  + Add Record
                </button>
              )}
            </div>

            {notice && <div className="alert">{notice}</div>}
            {apiErrors[active] && (
              <div className="alert error-alert">
                {active} could not be loaded. Check that your backend has this
                API route.
              </div>
            )}

            {showForm && (
              <form className="record-form" onSubmit={saveRecord}>
                <h3>{editingRow ? "Edit" : "Add"} {active} Record</h3>

                <div className="form-grid">
                  {config.fields.map((field) => (
                    <label key={field.key}>
                      {field.label}
                      <input
                        type={field.type || "text"}
                        value={formData[field.key] ?? ""}
                        required={field.required || false}
                        disabled={Boolean(
                          editingRow &&
                            (config.keys || [config.id]).includes(field.key)
                        )}
                        onChange={(event) =>
                          setFormData((previous) => ({
                            ...previous,
                            [field.key]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>

                <div className="form-actions">
                  <button className="primary-button" type="submit">
                    {editingRow ? "Save Changes" : "Save Record"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingRow(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="table-toolbar">
              <input
                type="search"
                placeholder={`Search ${active.toLowerCase()}...`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setLoading(true);
                  setApiErrors({});
                  loadRecords();
                }}
              >
                ↻ Refresh
              </button>
            </div>

            {loading ? (
              <div className="empty-state">Loading records...</div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      {rows.length > 0 &&
                        Object.keys(rows[0]).map((key) => (
                          <th key={key}>
                            {config.fields.find((field) => field.key === key)?.label ||
                              key
                                .replaceAll("_", " ")
                                .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                          </th>
                        ))}
                      {rows.length > 0 && (config?.id || config?.keys) && (
                        <th>Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={row[config?.id] ?? index}>
                        {Object.keys(rows[0] || {}).map((key) => (
                          <td key={key}>{displayValue(row[key])}</td>
                        ))}
                        {(config?.id || config?.keys) && (
                          <td>
                            <div className="row-actions">
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => openEditForm(row)}
                              >
                                Edit
                              </button>
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() => deleteRecord(row)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredRows.length === 0 && (
                  <div className="empty-state">
                    {search
                      ? "No records match your search."
                      : "No records found."}
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
