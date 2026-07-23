import { useState } from 'react';

const initialForm = {
  doctorName: '',
  licenseType: '',
  licenseNumber: '',
  expiryDate: '',
  notificationEmail: '',
};

const licenseOptions = [
  'State Medical License',
  'DEA Registration',
  'Medicare ID',
  'Medicaid ID',
  'Board Certification',
  'NPI Number',
  'Other',
];

const getDaysRemainingFromDate = (expiryDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(`${expiryDate}T00:00:00`);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};

function App() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: '' }));
  };

  const validate = () => {
    const nextErrors = {};
    if (!form.doctorName.trim()) nextErrors.doctorName = 'Doctor Name is required.';
    if (!form.licenseType) nextErrors.licenseType = 'License Type is required.';
    if (!form.licenseNumber.trim()) nextErrors.licenseNumber = 'License Number is required.';
    if (!form.expiryDate) nextErrors.expiryDate = 'Expiry Date is required.';

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!form.notificationEmail || !emailPattern.test(form.notificationEmail)) {
      nextErrors.notificationEmail = 'Enter a valid email address.';
    }

    return nextErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setSuccessMessage('');
      setErrorMessage('Please fix the highlighted fields and try again.');
      return;
    }

    setIsLoading(true);
    setSuccessMessage('');
    setErrorMessage('');

    try {
      const API_URL = import.meta.env.VITE_API_URL || '/api/licenses';
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        const backendErrors = data.errors || {};
        setErrors(backendErrors);
        setErrorMessage(data.message || 'Unable to save the license.');
        return;
      }

      if (data.immediateAlert) {
        const daysRemaining = data.daysRemaining ?? getDaysRemainingFromDate(form.expiryDate);
        setSuccessMessage(`✅ License added successfully! An expiration alert was sent immediately — expires in ${daysRemaining} days.`);
      } else {
        setSuccessMessage('✅ License added successfully!');
      }

      setForm(initialForm);
      setErrors({});
    } catch (error) {
      setErrorMessage('Could not connect to the backend server.');
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    borderRadius: '12px',
    border: '1px solid #c7d2fe',
    outline: 'none',
    fontSize: '15px',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(79, 70, 229, 0.08)',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: 'linear-gradient(135deg, #6d28d9, #8b5cf6, #c084fc)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          background: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 20px 45px rgba(76, 29, 149, 0.3)',
          padding: '28px',
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: '8px', color: '#312e81', textAlign: 'center' }}>
          Doctor License Tracker
        </h1>
        <p style={{ marginTop: 0, marginBottom: '20px', color: '#4b5563', textAlign: 'center' }}>
          Add and monitor doctor license renewal details.
        </p>

        {successMessage && (
          <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '10px', background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }}>
            {successMessage}
          </div>
        )}

        {errorMessage && (
          <div style={{ marginBottom: '14px', padding: '12px 14px', borderRadius: '10px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ display: 'grid', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#374151', fontWeight: 600 }}>Doctor Name</label>
              <input
                name="doctorName"
                value={form.doctorName}
                onChange={handleChange}
                style={{ ...inputStyle, borderColor: errors.doctorName ? '#ef4444' : '#c7d2fe' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
                onBlur={(e) => (e.currentTarget.style.borderColor = errors.doctorName ? '#ef4444' : '#c7d2fe')}
              />
              {errors.doctorName && <div style={{ marginTop: '4px', color: '#b91c1c', fontSize: '13px' }}>{errors.doctorName}</div>}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#374151', fontWeight: 600 }}>License Type</label>
              <select
                name="licenseType"
                value={form.licenseType}
                onChange={handleChange}
                style={{ ...inputStyle, borderColor: errors.licenseType ? '#ef4444' : '#c7d2fe' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
                onBlur={(e) => (e.currentTarget.style.borderColor = errors.licenseType ? '#ef4444' : '#c7d2fe')}
              >
                <option value="">Select a license type</option>
                {licenseOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors.licenseType && <div style={{ marginTop: '4px', color: '#b91c1c', fontSize: '13px' }}>{errors.licenseType}</div>}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#374151', fontWeight: 600 }}>License Number</label>
              <input
                name="licenseNumber"
                value={form.licenseNumber}
                onChange={handleChange}
                style={{ ...inputStyle, borderColor: errors.licenseNumber ? '#ef4444' : '#c7d2fe' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
                onBlur={(e) => (e.currentTarget.style.borderColor = errors.licenseNumber ? '#ef4444' : '#c7d2fe')}
              />
              {errors.licenseNumber && <div style={{ marginTop: '4px', color: '#b91c1c', fontSize: '13px' }}>{errors.licenseNumber}</div>}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#374151', fontWeight: 600 }}>Expiry Date</label>
              <input
                type="date"
                name="expiryDate"
                value={form.expiryDate}
                onChange={handleChange}
                style={{ ...inputStyle, borderColor: errors.expiryDate ? '#ef4444' : '#c7d2fe' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
                onBlur={(e) => (e.currentTarget.style.borderColor = errors.expiryDate ? '#ef4444' : '#c7d2fe')}
              />
              {errors.expiryDate && <div style={{ marginTop: '4px', color: '#b91c1c', fontSize: '13px' }}>{errors.expiryDate}</div>}
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: '#374151', fontWeight: 600 }}>Notification Email</label>
              <input
                type="email"
                name="notificationEmail"
                value={form.notificationEmail}
                onChange={handleChange}
                style={{ ...inputStyle, borderColor: errors.notificationEmail ? '#ef4444' : '#c7d2fe' }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#4f46e5')}
                onBlur={(e) => (e.currentTarget.style.borderColor = errors.notificationEmail ? '#ef4444' : '#c7d2fe')}
              />
              {errors.notificationEmail && <div style={{ marginTop: '4px', color: '#b91c1c', fontSize: '13px' }}>{errors.notificationEmail}</div>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                marginTop: '6px',
                padding: '13px 18px',
                borderRadius: '12px',
                border: 'none',
                background: '#4338ca',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 700,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.8 : 1,
                boxShadow: '0 10px 24px rgba(67, 56, 202, 0.25)',
              }}
            >
              {isLoading ? 'Saving...' : 'Save License'}
            </button>
          </div>
        </form>

        <p style={{ marginTop: '18px', marginBottom: 0, textAlign: 'center', fontSize: '13px', color: '#4b5563' }}>
          Daily automated emails are sent at midnight for licenses expiring within 60 days.
        </p>
      </div>
    </div>
  );
}

export default App;
