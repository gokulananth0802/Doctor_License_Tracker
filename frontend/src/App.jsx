import { useState, useEffect } from 'react';

const DEMO_OFFICE_ID = 'DEMO-OFFICE-101';
const DEMO_PASSWORD = 'Password123!';

const initialForm = {
  providerName: '',
  taxIdNpi: '',
  credentialType: '',
  providerNumber: '',
  issuingAuthority: '',
  issueDate: '',
  expirationDate: '',
  renewalDueDate: '',
  reminderSchedule: '30 days',
  responsiblePerson: '',
  coordinatorEmail: '',
  status: 'Active',
  renewalSubmittedDate: '',
  renewalCompletedDate: '',
  lastReminderSent: '',
  nextReminderDate: '',
};

const credentialOptions = [
  'State Medical License',
  'DEA Registration',
  'Medicare ID',
  'Medicaid ID',
  'Board Certification',
  'NPI Number',
  'Specialty Certification',
  'Controlled Substance License',
  'Other',
];

const statusOptions = ['Active', 'Pending Renewal', 'Renewed', 'Expired'];

const reminderScheduleOptions = ['90 days', '60 days', '45 days', '30 days', '15 days', '7 days'];

const getDaysRemainingFromDate = (expiryDate) => {
  if (!expiryDate) return 9999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dateStr = String(expiryDate).split('T')[0];
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return 9999;

  const expiry = new Date(year, month - 1, day);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};

function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem('doctor_tracker_auth') === 'true';
  });
  const [officeId, setOfficeId] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Dashboard & Licenses state
  const [licenses, setLicenses] = useState([]);
  const [isLoadingLicenses, setIsLoadingLicenses] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('All');
  const [selectedLicenseForModal, setSelectedLicenseForModal] = useState(null);

  // Modal & Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [formSuccessMessage, setFormSuccessMessage] = useState('');
  const [formErrorMessage, setFormErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Active side section
  const [activeSection, setActiveSection] = useState('Dashboard');

  // Helper function to robustly execute backend requests with fallback
  const callBackendApi = async (path, options = {}) => {
    const urls = [];
    if (import.meta.env.VITE_API_URL) {
      const base = import.meta.env.VITE_API_URL.replace(/\/$/, '');
      urls.push(base.endsWith('/licenses') || base.endsWith('/api/licenses') ? base : `${base}${path}`);
    }
    urls.push(path);
    urls.push(`http://localhost:5000${path}`);

    for (const url of urls) {
      try {
        const response = await fetch(url, options);
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          return { ok: response.ok, status: response.status, data };
        }
      } catch (err) {
        // try fallback url
      }
    }
    return { ok: false, message: 'Could not connect to backend server.' };
  };

  // Fetch licenses when authenticated
  const fetchLicenses = async () => {
    setIsLoadingLicenses(true);
    try {
      const result = await callBackendApi('/api/licenses');
      if (result.ok && Array.isArray(result.data)) {
        setLicenses(result.data);
      } else {
        console.warn('Backend responded but did not return array:', result);
      }
    } catch (err) {
      console.error('Failed to fetch licenses:', err);
    } finally {
      setIsLoadingLicenses(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchLicenses();
    }
  }, [isAuthenticated]);

  // Auth Submit
  const handleLogin = (e) => {
    e.preventDefault();
    setAuthError('');
    if (!officeId.trim() || !password) {
      setAuthError('Please enter both Office ID and Password.');
      return;
    }
    if (officeId.trim() === DEMO_OFFICE_ID && password === DEMO_PASSWORD) {
      localStorage.setItem('doctor_tracker_auth', 'true');
      setIsAuthenticated(true);
    } else {
      setAuthError('Invalid Office ID or Password. Use demo credentials below.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('doctor_tracker_auth');
    setIsAuthenticated(false);
    setOfficeId('');
    setPassword('');
  };

  const autofillDemoCredentials = () => {
    setOfficeId(DEMO_OFFICE_ID);
    setPassword(DEMO_PASSWORD);
    setAuthError('');
  };

  // Form handling
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validateForm = () => {
    const nextErrors = {};
    if (!form.providerName.trim()) nextErrors.providerName = 'Provider Name is required.';
    if (!form.taxIdNpi.trim()) nextErrors.taxIdNpi = 'Provider Tax ID / NPI is required.';
    if (!form.credentialType) nextErrors.credentialType = 'Credential Type is required.';
    if (!form.providerNumber.trim()) nextErrors.providerNumber = 'Provider Number is required.';
    if (!form.issuingAuthority.trim()) nextErrors.issuingAuthority = 'Issuing Authority is required.';
    if (!form.expirationDate) nextErrors.expirationDate = 'Expiration Date is required.';
    if (!form.renewalDueDate) nextErrors.renewalDueDate = 'Renewal Due Date is required.';
    if (!form.reminderSchedule) nextErrors.reminderSchedule = 'Reminder Schedule is required.';
    if (!form.responsiblePerson.trim()) nextErrors.responsiblePerson = 'Responsible Person is required.';

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.coordinatorEmail || !emailPattern.test(form.coordinatorEmail)) {
      nextErrors.coordinatorEmail = 'Enter a valid email address.';
    }

    if (!form.status) nextErrors.status = 'Status is required.';
    return nextErrors;
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = validateForm();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setFormErrorMessage('Please complete all required fields.');
      return;
    }

    setIsSaving(true);
    setFormSuccessMessage('');
    setFormErrorMessage('');

    try {
      const result = await callBackendApi('/api/licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!result.ok) {
        setErrors(result.data?.errors || {});
        setFormErrorMessage(result.data?.message || result.message || 'Failed to save credential.');
        return;
      }

      setFormSuccessMessage('Credential successfully added.');
      setForm(initialForm);
      setErrors({});
      fetchLicenses();
      setTimeout(() => {
        setIsModalOpen(false);
        setFormSuccessMessage('');
      }, 1000);
    } catch (err) {
      setFormErrorMessage('Could not connect to backend server.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLicense = async (id) => {
    if (!window.confirm('Are you sure you want to delete this credential record?')) return;
    try {
      const result = await callBackendApi(`/api/licenses/${id}`, { method: 'DELETE' });
      if (result.ok) {
        fetchLicenses();
      }
    } catch (err) {
      console.error('Failed to delete license:', err);
    }
  };

  // Filtered licenses
  const filteredLicenses = licenses.filter((lic) => {
    const nameMatch = (lic.providerName || lic.doctorName || '').toLowerCase().includes(searchQuery.toLowerCase());
    const npiMatch = (lic.taxIdNpi || '').toLowerCase().includes(searchQuery.toLowerCase());
    const numberMatch = (lic.providerNumber || lic.licenseNumber || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSearch = nameMatch || npiMatch || numberMatch;

    const matchesStatus =
      selectedStatusFilter === 'All'
        ? true
        : (lic.status || 'Active').toLowerCase() === selectedStatusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  // Calculate stats
  const totalCount = licenses.length;
  const activeCount = licenses.filter((l) => (l.status || 'Active') === 'Active').length;
  const pendingCount = licenses.filter((l) => l.status === 'Pending Renewal').length;
  const expiredCount = licenses.filter((l) => {
    const days = getDaysRemainingFromDate(l.expirationDate || l.expiryDate);
    return days < 0 || l.status === 'Expired';
  }).length;

  // ----------------------------------------------------
  // PROFESSIONAL LOGIN SCREEN
  // ----------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div style={styles.authContainer}>
        <div style={styles.authCard}>
          <div style={styles.authHeader}>
            <div style={styles.logoBadge}>DLM</div>
            <h1 style={styles.authTitle}>Doctor License Tracker</h1>
            <p style={styles.authSubtitle}>Credential Management Portal</p>
          </div>

          <div style={styles.demoBox}>
            <div style={{ fontWeight: '600', marginBottom: '4px', fontSize: '13px', color: '#1e3a8a' }}>
              Demo Authentication Access:
            </div>
            <div style={{ fontSize: '13px', color: '#334155' }}>
              <strong>Office ID:</strong> {DEMO_OFFICE_ID} &nbsp;|&nbsp; <strong>Password:</strong> {DEMO_PASSWORD}
            </div>
            <button type="button" onClick={autofillDemoCredentials} style={styles.autofillBtn}>
              Auto-fill Demo Credentials
            </button>
          </div>

          {authError && <div style={styles.errorBanner}>{authError}</div>}

          <form onSubmit={handleLogin} style={{ display: 'grid', gap: '16px' }}>
            <div>
              <label style={styles.label}>Office ID</label>
              <input
                type="text"
                placeholder="Enter Office ID"
                value={officeId}
                onChange={(e) => setOfficeId(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                placeholder="Enter Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
              />
            </div>

            <button type="submit" style={styles.primaryButton}>
              Sign In to Dashboard
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // MAIN ENTERPRISE DASHBOARD & SIDEBAR LAYOUT
  // ----------------------------------------------------
  return (
    <div style={styles.layoutContainer}>
      {/* SIDEBAR NAVIGATION */}
      <aside style={styles.sidebar}>
        <div>
          <div style={styles.sidebarHeader}>
            <div style={styles.brandBadge}>DLM</div>
            <div>
              <h2 style={styles.toolHeading}>License Tracker</h2>
              <span style={styles.toolSubheading}>Provider Credential System</span>
            </div>
          </div>

          <nav style={styles.sidebarNav}>
            <div style={styles.navSectionLabel}>MODULES</div>
            <button
              onClick={() => setActiveSection('Dashboard')}
              style={{
                ...styles.navItem,
                ...(activeSection === 'Dashboard' ? styles.activeNavItem : {}),
              }}
            >
              <span style={styles.navBullet} />
              <span>Dashboard</span>
            </button>
          </nav>
        </div>

        {/* SIDEBAR FOOTER */}
        <div style={styles.sidebarFooter}>
          <div>
            <div style={{ fontWeight: '600', fontSize: '13px', color: '#0f172a' }}>{DEMO_OFFICE_ID}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Administrator Account</div>
          </div>
          <button onClick={handleLogout} style={styles.logoutBtn} title="Sign Out">
            Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main style={styles.mainContent}>
        {/* DASHBOARD HEADER */}
        <header style={styles.topHeader}>
          <div>
            <h1 style={styles.pageTitle}>Credential Dashboard</h1>
            <p style={styles.pageSubtext}>
              Monitor provider license status, compliance deadlines, and expiration notifications.
            </p>
          </div>

          {/* ADD NEW LICENSE BUTTON */}
          <button
            onClick={() => {
              setForm(initialForm);
              setErrors({});
              setFormErrorMessage('');
              setFormSuccessMessage('');
              setIsModalOpen(true);
            }}
            style={styles.addLicenseBtn}
          >
            Add new License
          </button>
        </header>

        {/* METRICS STATS BAR */}
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>TOTAL CREDENTIALS</div>
            <div style={styles.statValue}>{totalCount}</div>
          </div>
          <div style={{ ...styles.statCard, borderTop: '3px solid #10b981' }}>
            <div style={styles.statLabel}>ACTIVE</div>
            <div style={{ ...styles.statValue, color: '#059669' }}>{activeCount}</div>
          </div>
          <div style={{ ...styles.statCard, borderTop: '3px solid #f59e0b' }}>
            <div style={styles.statLabel}>PENDING RENEWAL</div>
            <div style={{ ...styles.statValue, color: '#d97706' }}>{pendingCount}</div>
          </div>
          <div style={{ ...styles.statCard, borderTop: '3px solid #ef4444' }}>
            <div style={styles.statLabel}>EXPIRED / URGENT</div>
            <div style={{ ...styles.statValue, color: '#dc2626' }}>{expiredCount}</div>
          </div>
        </div>

        {/* TOOLBAR CONTROLS: PROPER ALIGNMENT FOR SEARCH AND FILTERS */}
        <div style={styles.toolbarContainer}>
          <div style={styles.searchWrapper}>
            <label style={styles.fieldLabelInline}>Search Records</label>
            <input
              type="text"
              placeholder="Search provider name, Tax ID / NPI, or license number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          <div style={styles.filterWrapper}>
            <label style={styles.fieldLabelInline}>Filter by Status</label>
            <div style={styles.filterTabGroup}>
              {['All', 'Active', 'Pending Renewal', 'Expired'].map((st) => (
                <button
                  key={st}
                  onClick={() => setSelectedStatusFilter(st)}
                  style={{
                    ...styles.filterTab,
                    ...(selectedStatusFilter === st ? styles.activeFilterTab : {}),
                  }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* LICENSES CARD GRID DISPLAY */}
        {isLoadingLicenses ? (
          <div style={styles.loadingBox}>Loading provider records...</div>
        ) : filteredLicenses.length === 0 ? (
          <div style={styles.emptyBox}>
            <h3 style={{ margin: '0 0 6px', color: '#1e293b', fontSize: '16px', fontWeight: '600' }}>
              No credential records found
            </h3>
            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
              {searchQuery || selectedStatusFilter !== 'All'
                ? 'No matches found for the selected filter or search query.'
                : 'Click "Add new License" above to register a new provider credential.'}
            </p>
          </div>
        ) : (
          <div style={styles.cardGrid}>
            {filteredLicenses.map((lic) => {
              const daysRemaining = getDaysRemainingFromDate(lic.expirationDate || lic.expiryDate);
              const providerName = lic.providerName || lic.doctorName || 'N/A';
              const credType = lic.credentialType || lic.licenseType || 'State License';
              const provNum = lic.providerNumber || lic.licenseNumber || 'N/A';
              const taxNpi = lic.taxIdNpi || 'N/A';
              const status = lic.status || (daysRemaining < 0 ? 'Expired' : 'Active');

              // Professional status badge logic
              let highlightBg = '#f0fdf4';
              let highlightColor = '#15803d';
              let highlightBorder = '#bbf7d0';
              let statusText = `Active — ${daysRemaining} Days Remaining`;

              if (daysRemaining < 0) {
                highlightBg = '#fef2f2';
                highlightColor = '#991b1b';
                highlightBorder = '#fca5a5';
                statusText = `Expired — ${Math.abs(daysRemaining)} Days Ago`;
              } else if (daysRemaining <= 15) {
                highlightBg = '#fff1f2';
                highlightColor = '#9f1239';
                highlightBorder = '#fecdd3';
                statusText = `Urgent — ${daysRemaining} Days Remaining`;
              } else if (daysRemaining <= 45) {
                highlightBg = '#fffbe6';
                highlightColor = '#92400e';
                highlightBorder = '#fef08a';
                statusText = `Renewal Alert — ${daysRemaining} Days Remaining`;
              }

              return (
                <div
                  key={lic.id || `${providerName}-${provNum}`}
                  style={styles.licenseCardClickable}
                  onClick={() => setSelectedLicenseForModal(lic)}
                >
                  {/* CARD HEADER (IMPORTANT SUMMARY DATA) */}
                  <div style={styles.cardHeader}>
                    <div>
                      <h3 style={styles.cardProviderName}>{providerName}</h3>
                      <div style={styles.cardNpi}>Tax ID / NPI: {taxNpi}</div>
                    </div>
                    <span
                      style={{
                        ...styles.statusBadge,
                        background:
                          status === 'Active'
                            ? '#f0fdf4'
                            : status === 'Pending Renewal'
                            ? '#fffbe6'
                            : status === 'Renewed'
                            ? '#eff6ff'
                            : '#fef2f2',
                        color:
                          status === 'Active'
                            ? '#166534'
                            : status === 'Pending Renewal'
                            ? '#92400e'
                            : status === 'Renewed'
                            ? '#1e40af'
                            : '#991b1b',
                        borderColor:
                          status === 'Active'
                            ? '#bbf7d0'
                            : status === 'Pending Renewal'
                            ? '#fef08a'
                            : status === 'Renewed'
                            ? '#bfdbfe'
                            : '#fca5a5',
                      }}
                    >
                      {status}
                    </span>
                  </div>

                  {/* HIGHLIGHTED REMAINING DAYS BANNER */}
                  <div
                    style={{
                      ...styles.daysHighlightBanner,
                      background: highlightBg,
                      color: highlightColor,
                      borderColor: highlightBorder,
                    }}
                  >
                    {statusText}
                  </div>

                  {/* PRIMARY SUMMARY METRICS */}
                  <div style={styles.cardSummaryGrid}>
                    <div>
                      <div style={styles.detailLabel}>Credential Type</div>
                      <div style={styles.detailValue}>{credType}</div>
                    </div>

                    <div>
                      <div style={styles.detailLabel}>License Number</div>
                      <div style={styles.detailValue}>{provNum}</div>
                    </div>

                    <div>
                      <div style={styles.detailLabel}>Expiration Date</div>
                      <div style={{ ...styles.detailValue, fontWeight: '700' }}>
                        {lic.expirationDate || lic.expiryDate || 'N/A'}
                      </div>
                    </div>

                    <div>
                      <div style={styles.detailLabel}>Assigned Staff</div>
                      <div style={styles.detailValue}>{lic.responsiblePerson || 'N/A'}</div>
                    </div>
                  </div>

                  {/* CARD FOOTER CTA */}
                  <div style={styles.cardFooterCTA}>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#2563eb' }}>
                      View Full Details →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* ---------------------------------------------------- */}
      {/* FULL DETAILS MODAL VIEW (ON CARD CLICK) */}
      {/* ---------------------------------------------------- */}
      {selectedLicenseForModal && (
        <div style={styles.modalBackdrop} onClick={() => setSelectedLicenseForModal(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#2563eb', textTransform: 'uppercase' }}>
                  Provider Credential Profile
                </div>
                <h2 style={{ margin: '2px 0 0', fontSize: '22px', color: '#0f172a', fontWeight: '700' }}>
                  {selectedLicenseForModal.providerName || selectedLicenseForModal.doctorName || 'Provider Details'}
                </h2>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                  Tax ID / NPI: <strong>{selectedLicenseForModal.taxIdNpi || 'N/A'}</strong>
                </div>
              </div>
              <button onClick={() => setSelectedLicenseForModal(null)} style={styles.closeModalBtn}>
                Close
              </button>
            </div>

            {/* EXPIRATION HIGHLIGHT IN MODAL */}
            {(() => {
              const daysRemaining = getDaysRemainingFromDate(
                selectedLicenseForModal.expirationDate || selectedLicenseForModal.expiryDate
              );
              let highlightBg = '#f0fdf4';
              let highlightColor = '#15803d';
              let highlightBorder = '#bbf7d0';
              let statusText = `Active — ${daysRemaining} Days Remaining`;

              if (daysRemaining < 0) {
                highlightBg = '#fef2f2';
                highlightColor = '#991b1b';
                highlightBorder = '#fca5a5';
                statusText = `Expired — ${Math.abs(daysRemaining)} Days Ago`;
              } else if (daysRemaining <= 15) {
                highlightBg = '#fff1f2';
                highlightColor = '#9f1239';
                highlightBorder = '#fecdd3';
                statusText = `Urgent — ${daysRemaining} Days Remaining`;
              } else if (daysRemaining <= 45) {
                highlightBg = '#fffbe6';
                highlightColor = '#92400e';
                highlightBorder = '#fef08a';
                statusText = `Renewal Alert — ${daysRemaining} Days Remaining`;
              }

              return (
                <div
                  style={{
                    ...styles.daysHighlightBanner,
                    background: highlightBg,
                    color: highlightColor,
                    borderColor: highlightBorder,
                    marginBottom: '20px',
                    fontSize: '14px',
                    padding: '12px 16px',
                  }}
                >
                  Status: <strong>{selectedLicenseForModal.status || 'Active'}</strong> &nbsp;|&nbsp; {statusText}
                </div>
              );
            })()}

            <div style={{ display: 'grid', gap: '16px' }}>
              {/* SECTION 1: CREDENTIAL & ISSUING DETAILS */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>1. Credential & Licensing Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <div style={styles.detailLabel}>Credential Type</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.credentialType || selectedLicenseForModal.licenseType || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Provider / License Number</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.providerNumber || selectedLicenseForModal.licenseNumber || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Issuing Authority</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.issuingAuthority || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Issue Date</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.issueDate || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Expiration Date</div>
                    <div style={{ ...styles.detailValue, fontWeight: '700' }}>{selectedLicenseForModal.expirationDate || selectedLicenseForModal.expiryDate || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Renewal Due Date</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.renewalDueDate || 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: REMINDER & STAFF ASSIGNMENT */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>2. Reminder Schedule & Staff Assignment</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <div style={styles.detailLabel}>Reminder Schedule</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.reminderSchedule || '30 days'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Responsible Coordinator</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.responsiblePerson || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Coordinator Email</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.coordinatorEmail || selectedLicenseForModal.notificationEmail || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Status</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.status || 'Active'}</div>
                  </div>
                </div>
              </div>

              {/* SECTION 3: RENEWAL TRACKING METRICS */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>3. Renewal Tracking Metrics</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <div style={styles.detailLabel}>Renewal Submitted Date</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.renewalSubmittedDate || 'Not Submitted'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Renewal Completed Date</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.renewalCompletedDate || 'Not Completed'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Last Reminder Sent</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.lastReminderSent || 'None Sent'}</div>
                  </div>
                  <div>
                    <div style={styles.detailLabel}>Next Reminder Date</div>
                    <div style={styles.detailValue}>{selectedLicenseForModal.nextReminderDate || 'Not Scheduled'}</div>
                  </div>
                </div>
              </div>

              {/* SECTION 4: RECORD SYSTEM METADATA */}
              <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'right' }}>
                System Record ID: {selectedLicenseForModal.id || 'N/A'} &nbsp;|&nbsp; Created: {selectedLicenseForModal.createdAt ? selectedLicenseForModal.createdAt.split('T')[0] : 'N/A'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '14px', borderTop: '1px solid #e2e8f0' }}>
                {selectedLicenseForModal.id ? (
                  <button
                    onClick={() => {
                      handleDeleteLicense(selectedLicenseForModal.id);
                      setSelectedLicenseForModal(null);
                    }}
                    style={styles.deleteCardBtn}
                  >
                    Delete Credential Record
                  </button>
                ) : <div />}

                <button onClick={() => setSelectedLicenseForModal(null)} style={styles.primaryButton}>
                  Close Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* ADD NEW LICENSE MODAL FORM */}
      {/* ---------------------------------------------------- */}
      {isModalOpen && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modalCard}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a', fontWeight: '700' }}>
                  Register New Provider Credential
                </h2>
                <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '13px' }}>
                  Enter credential parameters to establish compliance tracking.
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} style={styles.closeModalBtn}>
                Close
              </button>
            </div>

            {formSuccessMessage && <div style={styles.successBanner}>{formSuccessMessage}</div>}
            {formErrorMessage && <div style={styles.errorBanner}>{formErrorMessage}</div>}

            <form onSubmit={handleFormSubmit} style={{ display: 'grid', gap: '16px' }}>
              {/* SECTION 1: PROVIDER INFORMATION */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>1. Provider Information</div>
                <div style={styles.formGrid2}>
                  <div>
                    <label style={styles.label}>
                      Provider Name <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      name="providerName"
                      placeholder="e.g. Dr. Jane Smith"
                      value={form.providerName}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.providerName ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.providerName && <div style={styles.fieldError}>{errors.providerName}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Provider Tax ID / NPI <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      name="taxIdNpi"
                      placeholder="e.g. 1982736405"
                      value={form.taxIdNpi}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.taxIdNpi ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.taxIdNpi && <div style={styles.fieldError}>{errors.taxIdNpi}</div>}
                  </div>
                </div>
              </div>

              {/* SECTION 2: CREDENTIAL & ISSUING DETAILS */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>2. Credential & Expiration Details</div>
                <div style={styles.formGrid2}>
                  <div>
                    <label style={styles.label}>
                      Credential Type <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <select
                      name="credentialType"
                      value={form.credentialType}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.credentialType ? '#ef4444' : '#cbd5e1' }}
                    >
                      <option value="">Select Credential Type</option>
                      {credentialOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {errors.credentialType && <div style={styles.fieldError}>{errors.credentialType}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Provider / License Number <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      name="providerNumber"
                      placeholder="e.g. MD-987654"
                      value={form.providerNumber}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.providerNumber ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.providerNumber && <div style={styles.fieldError}>{errors.providerNumber}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Issuing Authority <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      name="issuingAuthority"
                      placeholder="e.g. Medicare / Medicaid / State Board"
                      value={form.issuingAuthority}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.issuingAuthority ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.issuingAuthority && <div style={styles.fieldError}>{errors.issuingAuthority}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>Issue Date (Optional)</label>
                    <input
                      type="date"
                      name="issueDate"
                      value={form.issueDate}
                      onChange={handleFormChange}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>
                      Expiration Date <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      name="expirationDate"
                      value={form.expirationDate}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.expirationDate ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.expirationDate && <div style={styles.fieldError}>{errors.expirationDate}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Renewal Due Date <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="date"
                      name="renewalDueDate"
                      value={form.renewalDueDate}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.renewalDueDate ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.renewalDueDate && <div style={styles.fieldError}>{errors.renewalDueDate}</div>}
                  </div>
                </div>
              </div>

              {/* SECTION 3: REMINDERS & STAFF ASSIGNMENT */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>3. Reminders & Staff Assignment</div>
                <div style={styles.formGrid2}>
                  <div>
                    <label style={styles.label}>
                      Reminder Schedule <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <select
                      name="reminderSchedule"
                      value={form.reminderSchedule}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.reminderSchedule ? '#ef4444' : '#cbd5e1' }}
                    >
                      {reminderScheduleOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    {errors.reminderSchedule && <div style={styles.fieldError}>{errors.reminderSchedule}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Responsible Person <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      name="responsiblePerson"
                      placeholder="e.g. Credentialing Coordinator"
                      value={form.responsiblePerson}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.responsiblePerson ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.responsiblePerson && <div style={styles.fieldError}>{errors.responsiblePerson}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Coordinator Email <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="email"
                      name="coordinatorEmail"
                      placeholder="e.g. coordinator@clinic.com"
                      value={form.coordinatorEmail}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.coordinatorEmail ? '#ef4444' : '#cbd5e1' }}
                    />
                    {errors.coordinatorEmail && <div style={styles.fieldError}>{errors.coordinatorEmail}</div>}
                  </div>

                  <div>
                    <label style={styles.label}>
                      Status <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <select
                      name="status"
                      value={form.status}
                      onChange={handleFormChange}
                      style={{ ...styles.input, borderColor: errors.status ? '#ef4444' : '#cbd5e1' }}
                    >
                      {statusOptions.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    {errors.status && <div style={styles.fieldError}>{errors.status}</div>}
                  </div>
                </div>
              </div>

              {/* SECTION 4: OPTIONAL RENEWAL TRACKING */}
              <div style={styles.formSection}>
                <div style={styles.sectionHeading}>4. Optional Renewal Metrics</div>
                <div style={styles.formGrid2}>
                  <div>
                    <label style={styles.label}>Renewal Submitted Date</label>
                    <input
                      type="date"
                      name="renewalSubmittedDate"
                      value={form.renewalSubmittedDate}
                      onChange={handleFormChange}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Renewal Completed Date</label>
                    <input
                      type="date"
                      name="renewalCompletedDate"
                      value={form.renewalCompletedDate}
                      onChange={handleFormChange}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Last Reminder Sent</label>
                    <input
                      type="date"
                      name="lastReminderSent"
                      value={form.lastReminderSent}
                      onChange={handleFormChange}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.label}>Next Reminder Date</label>
                    <input
                      type="date"
                      name="nextReminderDate"
                      value={form.nextReminderDate}
                      onChange={handleFormChange}
                      style={styles.input}
                    />
                  </div>
                </div>
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={styles.cancelBtn}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  style={styles.primaryButton}
                >
                  {isSaving ? 'Saving Record...' : 'Save Credential'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// CLEAN ENTERPRISE SYSTEM STYLES
// ----------------------------------------------------
const styles = {
  authContainer: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#0f172a',
    padding: '24px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  authCard: {
    width: '100%',
    maxWidth: '420px',
    background: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
    padding: '36px 32px',
    border: '1px solid #1e293b',
  },
  authHeader: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  logoBadge: {
    width: '48px',
    height: '48px',
    borderRadius: '10px',
    background: '#1e293b',
    color: '#ffffff',
    display: 'grid',
    placeItems: 'center',
    fontWeight: '800',
    fontSize: '14px',
    letterSpacing: '0.05em',
    margin: '0 auto 14px',
  },
  authTitle: {
    margin: 0,
    fontSize: '22px',
    fontWeight: '700',
    color: '#0f172a',
  },
  authSubtitle: {
    margin: '4px 0 0',
    color: '#64748b',
    fontSize: '13px',
  },
  demoBox: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '12px 14px',
    marginBottom: '20px',
  },
  autofillBtn: {
    marginTop: '10px',
    width: '100%',
    padding: '8px',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#334155',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    outline: 'none',
    fontSize: '14px',
    background: '#ffffff',
    color: '#0f172a',
  },
  primaryButton: {
    padding: '11px 18px',
    borderRadius: '6px',
    border: 'none',
    background: '#2563eb',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  errorBanner: {
    padding: '10px 12px',
    borderRadius: '6px',
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fca5a5',
    marginBottom: '16px',
    fontSize: '13px',
  },
  successBanner: {
    padding: '10px 12px',
    borderRadius: '6px',
    background: '#f0fdf4',
    color: '#166534',
    border: '1px solid #bbf7d0',
    marginBottom: '16px',
    fontSize: '13px',
  },
  fieldError: {
    marginTop: '4px',
    color: '#dc2626',
    fontSize: '12px',
  },

  // LAYOUT
  layoutContainer: {
    display: 'flex',
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  },
  sidebar: {
    width: '250px',
    background: '#ffffff',
    borderRight: '1px solid #e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '24px 16px',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingBottom: '20px',
    borderBottom: '1px solid #e2e8f0',
    marginBottom: '24px',
  },
  brandBadge: {
    width: '38px',
    height: '38px',
    borderRadius: '8px',
    background: '#0f172a',
    color: '#ffffff',
    display: 'grid',
    placeItems: 'center',
    fontWeight: '800',
    fontSize: '12px',
  },
  toolHeading: {
    margin: 0,
    fontSize: '15px',
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: '1.2',
  },
  toolSubheading: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '500',
  },
  sidebarNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  navSectionLabel: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: '0.05em',
    marginBottom: '8px',
    paddingLeft: '8px',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '6px',
    border: 'none',
    background: 'transparent',
    color: '#475569',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
  },
  activeNavItem: {
    background: '#f1f5f9',
    color: '#0f172a',
  },
  navBullet: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: '#2563eb',
  },
  sidebarFooter: {
    paddingTop: '16px',
    borderTop: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoutBtn: {
    padding: '6px 10px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#475569',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },

  // MAIN CONTENT
  mainContent: {
    flex: '1',
    padding: '32px 40px',
    overflowY: 'auto',
  },
  topHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '28px',
    gap: '16px',
    flexWrap: 'wrap',
  },
  pageTitle: {
    margin: 0,
    fontSize: '22px',
    color: '#0f172a',
    fontWeight: '700',
  },
  pageSubtext: {
    margin: '4px 0 0',
    color: '#64748b',
    fontSize: '14px',
  },
  addLicenseBtn: {
    padding: '10px 18px',
    borderRadius: '6px',
    border: 'none',
    background: '#2563eb',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '28px',
  },
  statCard: {
    background: '#ffffff',
    borderRadius: '8px',
    padding: '18px 20px',
    border: '1px solid #e2e8f0',
  },
  statLabel: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: '0.05em',
  },
  statValue: {
    fontSize: '26px',
    fontWeight: '700',
    color: '#0f172a',
    marginTop: '6px',
  },

  // TOOLBAR CONTROLS ALIGNMENT
  toolbarContainer: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '16px 20px',
    marginBottom: '24px',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: '24px',
    flexWrap: 'wrap',
  },
  searchWrapper: {
    flex: '1',
    minWidth: '280px',
  },
  filterWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  fieldLabelInline: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#475569',
    marginBottom: '6px',
    display: 'block',
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '9px 12px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
    outline: 'none',
    background: '#ffffff',
    color: '#0f172a',
  },
  filterTabGroup: {
    display: 'flex',
    gap: '4px',
    background: '#f1f5f9',
    padding: '3px',
    borderRadius: '6px',
  },
  filterTab: {
    padding: '6px 12px',
    borderRadius: '4px',
    border: 'none',
    background: 'transparent',
    color: '#475569',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  activeFilterTab: {
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
  },

  // CARD GRID
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: '20px',
  },
  licenseCardClickable: {
    background: '#ffffff',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    cursor: 'pointer',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
  },
  cardSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '14px',
  },
  cardFooterCTA: {
    paddingTop: '10px',
    borderTop: '1px solid #f1f5f9',
    textAlign: 'right',
  },
  licenseCard: {
    background: '#ffffff',
    borderRadius: '10px',
    border: '1px solid #e2e8f0',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '12px',
  },
  cardProviderName: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '700',
    color: '#0f172a',
  },
  cardNpi: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '2px',
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    border: '1px solid',
    whiteSpace: 'nowrap',
  },
  daysHighlightBanner: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid',
    fontWeight: '600',
    fontSize: '12px',
    textAlign: 'center',
    marginBottom: '16px',
  },
  cardDetailsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
    marginBottom: '16px',
  },
  detailLabel: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: '13px',
    color: '#1e293b',
    fontWeight: '600',
    marginTop: '2px',
  },
  optionalDatesBox: {
    background: '#f8fafc',
    borderRadius: '6px',
    padding: '10px 12px',
    marginBottom: '16px',
    border: '1px solid #e2e8f0',
  },
  cardFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '12px',
    borderTop: '1px solid #f1f5f9',
    gap: '12px',
  },
  deleteCardBtn: {
    padding: '5px 10px',
    borderRadius: '4px',
    border: '1px solid #fca5a5',
    background: '#ffffff',
    color: '#dc2626',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  loadingBox: {
    textAlign: 'center',
    padding: '40px',
    color: '#64748b',
    fontSize: '14px',
  },
  emptyBox: {
    background: '#ffffff',
    borderRadius: '8px',
    padding: '40px 24px',
    textAlign: 'center',
    border: '1px solid #e2e8f0',
  },

  // MODAL
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(15, 23, 42, 0.5)',
    display: 'grid',
    placeItems: 'center',
    padding: '20px',
    zIndex: 1000,
    overflowY: 'auto',
  },
  modalCard: {
    background: '#ffffff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '640px',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    padding: '28px 30px',
    border: '1px solid #cbd5e1',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px',
  },
  closeModalBtn: {
    background: '#f1f5f9',
    border: '1px solid #cbd5e1',
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#475569',
    cursor: 'pointer',
  },
  formSection: {
    background: '#f8fafc',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #e2e8f0',
  },
  sectionHeading: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  formGrid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '12px',
  },
  cancelBtn: {
    padding: '10px 16px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#475569',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
};

export default App;

