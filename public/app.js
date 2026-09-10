
const $ = id => document.getElementById(id);

let currentUser = null;
let currentUsage = null;
let currentFile = null;
let selectedStyle = '';
let selectedBudget = 'Just give me ideas';
let selectedFeatures = [];
let beforeUrl = '';
let results = [];
let activeResult = 0;
let lastResponse = null;
let resetTokenFromUrl = null;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._yvToast);
  window._yvToast = setTimeout(() => t.classList.remove('show'), 2400);
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(`view-${name}`).classList.add('active');
  document.querySelectorAll('.nav-btn[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name)
  );
  if (name === 'projects') renderProjects();
  if (name === 'account') renderAccount();
  if (name === 'status') loadReadiness();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function api(url, options = {}) {
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { ...headers, ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(
      data.details ? `${data.error || 'Request failed'}\n${data.details}` : (data.error || 'Request failed')
    );
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

function setLoading(on) {
  $('loading').classList.toggle('hidden', !on);
}

function updateUsageUI() {
  if (!currentUser || !currentUsage) {
    $('usagePill').textContent = 'Sign in to see usage';
    return;
  }
  $('usagePill').textContent =
    `${currentUsage.plan.toUpperCase()} • ${currentUsage.used}/${currentUsage.limit} designs used`;
}

async function refreshSession() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user || null;
    currentUsage = data.usage || null;
  } catch {
    currentUser = null;
    currentUsage = null;
  }
  updateAuthUI();
}

function updateAuthUI() {
  $('authOpenBtn').textContent = currentUser ? currentUser.name : 'Sign In';
  $('authOpenBtn').title = currentUser ? 'Open account' : 'Sign in';
  $('headerLogoutBtn').classList.toggle('hidden', !currentUser);
  $('logoutBtn').disabled = !currentUser;
  $('verifyEmailBtn').disabled = !currentUser || !!currentUser.emailVerified;
  $('resetFromAccountBtn').disabled = !currentUser;
  const canManageBilling = !!currentUser && currentUser.plan === 'pro';
  $('billingBtn').classList.toggle('hidden', !canManageBilling);
  $('billingBtn').disabled = !canManageBilling;
  $('proBtn').disabled = canManageBilling;
  $('proBtn').textContent = canManageBilling ? 'Pro Active' : 'Start Pro Test Checkout';
  $('projectsLoginNote').classList.toggle('hidden', !!currentUser);
  updateUsageUI();
  renderAccount();
}

function renderAccount() {
  if (!currentUser) {
    $('accountCard').innerHTML = `
      <h3>Not signed in</h3>
      <p class="muted">Sign in to save designs, view usage, and manage your account.</p>
    `;
    return;
  }

  const usage = currentUsage
    ? `${currentUsage.used} of ${currentUsage.limit} monthly designs used`
    : 'Usage unavailable';

  $('accountCard').innerHTML = `
    <h3>${currentUser.name}</h3>
    <div class="account-row"><strong>Email:</strong> ${currentUser.email}</div>
    <div class="account-row"><strong>Plan:</strong> ${(currentUser.plan || 'free').toUpperCase()}</div>
    <div class="account-row"><strong>Email:</strong> <span class="${currentUser.emailVerified ? 'verified' : 'unverified'}">${currentUser.emailVerified ? 'Verified' : 'Not verified'}</span></div>
    <div class="account-row"><strong>Usage:</strong> ${usage}</div>
  `;
}

async function checkHealth() {
  try {
    const d = await api('/api/health');
    $('serverStatus').textContent =
      `v8 STAGING • DB ${d.databaseMode} • Storage ${d.storageMode} • Email ${d.emailMode} • Stripe ${d.stripeConfigured ? 'configured' : 'not configured'}`;
  } catch {
    $('serverStatus').textContent = 'Server not reachable';
  }
}

async function loadDemo() {
  const response = await fetch('/demo-yard.png');
  const blob = await response.blob();
  currentFile = new File([blob], 'demo-yard.png', { type: blob.type || 'image/png' });
  const url = URL.createObjectURL(blob);
  beforeUrl = url;
  $('uploadPreview').src = url;
  $('uploadPreview').classList.remove('hidden');
  showView('design');
  toast('Demo yard loaded');
}

function updateSlider() {
  const value = Number($('compareRange').value);
  $('afterClip').style.clipPath = `inset(0 0 0 ${value}%)`;
  $('compareLine').style.left = `${value}%`;
  $('compareHandle').style.left = `${value}%`;
}

function renderPlan(items) {
  $('planList').innerHTML =
    (items || []).map(x => `<div>• ${x}</div>`).join('') ||
    '<span class="muted">No design yet.</span>';
}

function renderVariationTabs() {
  $('variationTabs').innerHTML = '';
  results.forEach((item, i) => {
    const button = document.createElement('button');
    button.className = i === activeResult ? 'selected' : '';
    button.textContent = `Variation ${i + 1}`;
    button.onclick = () => {
      activeResult = i;
      $('afterImg').src = item.url;
      renderVariationTabs();
    };
    $('variationTabs').appendChild(button);
  });
}

function openAuth(tab = 'login') {
  $('authModal').classList.remove('hidden');
  setAuthTab(tab);
}
function closeAuth() {
  $('authModal').classList.add('hidden');
}
function setAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.authTab === tab)
  );
  $('loginPane').classList.toggle('hidden', tab !== 'login');
  $('signupPane').classList.toggle('hidden', tab !== 'signup');
  $('forgotPane').classList.toggle('hidden', tab !== 'forgot');
}

document.querySelectorAll('.nav-btn[data-view]').forEach(
  b => b.onclick = () => showView(b.dataset.view)
);
document.querySelectorAll('.goto-design').forEach(
  b => b.onclick = () => showView('design')
);

document.querySelectorAll('.feature-link').forEach(button => {
  button.onclick = () => {
    const target = button.dataset.target || 'design';
    showView(target);
    if (button.textContent.includes('Download results')) {
      toast('Generate a design first, then use Download Result');
    }
  };
});

$('homeDemoBtn').onclick = loadDemo;
$('designDemoBtn').onclick = loadDemo;
$('compareRange').oninput = updateSlider;

$('authOpenBtn').onclick = () => currentUser ? showView('account') : openAuth('login');
$('openSignInFromAccount').onclick = () => openAuth('login');
$('authClose').onclick = closeAuth;
document.querySelectorAll('.auth-tab').forEach(
  b => b.onclick = () => setAuthTab(b.dataset.authTab)
);

$('yardFile').onchange = () => {
  const file = $('yardFile').files?.[0];
  if (!file) return;
  currentFile = file;

  const reader = new FileReader();
  reader.onload = e => {
    beforeUrl = e.target.result;
    $('uploadPreview').src = beforeUrl;
    $('uploadPreview').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
};

$('styleGrid').onclick = e => {
  const button = e.target.closest('button[data-style]');
  if (!button) return;
  [...$('styleGrid').querySelectorAll('button')].forEach(x => x.classList.remove('selected'));
  button.classList.add('selected');
  selectedStyle = button.dataset.style;
};

$('featureGrid').onclick = e => {
  const button = e.target.closest('button');
  if (!button) return;
  button.classList.toggle('selected');
  selectedFeatures = [...$('featureGrid').querySelectorAll('button.selected')]
    .map(x => x.textContent.trim());
};

$('budgetGrid').onclick = e => {
  const button = e.target.closest('button[data-budget]');
  if (!button) return;
  [...$('budgetGrid').querySelectorAll('button')].forEach(x => x.classList.remove('selected'));
  button.classList.add('selected');
  selectedBudget = button.dataset.budget;
};

$('generateBtn').onclick = async () => {
  if (!currentUser) {
    openAuth('login');
    return toast('Sign in before generating a design');
  }
  if (!currentFile) return toast('Upload a yard photo or load the demo yard');
  if (!selectedStyle) return toast('Choose a style first');

  try {
    setLoading(true);

    const form = new FormData();
    form.append('yardImage', currentFile);
    form.append('style', selectedStyle);
    form.append('budget', selectedBudget);
    form.append('features', JSON.stringify(selectedFeatures));
    form.append('notes', $('notes').value.trim());

    const d = await api('/api/design', { method: 'POST', body: form });

    lastResponse = d;
    results = d.results || [];
    activeResult = 0;
    currentUsage = d.usage || currentUsage;
    updateUsageUI();

    $('beforeImg').src = d.beforeImageUrl || beforeUrl;
    $('afterImg').src = results[0]?.url || '';
    $('resultEmpty').classList.add('hidden');
    $('saveProjectBtn').disabled = !results.length;
    $('downloadBtn').disabled = !results.length;
    $('estimateText').textContent = d.estimateRange || '—';

    renderPlan(d.landscapePlan || []);
    renderVariationTabs();
    $('compareRange').value = 50;
    updateSlider();

    toast(d.warning || 'Landscape generated');
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') openAuth('login');
    if (err.code === 'EMAIL_VERIFICATION_REQUIRED') {
      showView('account');
      toast('Verify your email before generating');
    } else if (err.code === 'USAGE_LIMIT_REACHED') {
      showView('pro');
      toast('Monthly design limit reached');
    } else {
      alert('YardVision error:\n\n' + (err.message || 'Unknown error'));
    }
  } finally {
    setLoading(false);
  }
};

$('saveProjectBtn').onclick = async () => {
  if (!currentUser) {
    openAuth('login');
    return toast('Sign in to save this design');
  }
  if (!lastResponse || !results.length) return;

  try {
    await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: `${lastResponse.style} Yard Design`,
        style: lastResponse.style,
        budget: lastResponse.budget,
        features: lastResponse.features || selectedFeatures,
        notes: lastResponse.notes || $('notes').value.trim(),
        estimate: lastResponse.estimateRange,
        before: lastResponse.beforeImageUrl,
        after: results[activeResult].url,
        variation: activeResult + 1
      })
    });
    toast('Design saved to your account');
  } catch (err) {
    toast(err.message || 'Could not save design');
  }
};

$('downloadBtn').onclick = () => {
  if (!results.length) return;
  const a = document.createElement('a');
  a.href = results[activeResult].url;
  a.download = `yardvision-result-${activeResult + 1}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

async function renderProjects() {
  const grid = $('projectGrid');
  grid.innerHTML = '';
  $('projectEmpty').classList.add('hidden');
  if (!currentUser) return;

  try {
    const d = await api('/api/projects');
    const items = d.projects || [];
    if (!items.length) {
      $('projectEmpty').classList.remove('hidden');
      return;
    }

    items.forEach(project => {
      const card = document.createElement('article');
      card.className = 'project-card';
      card.innerHTML = `
        <img src="${project.after}" alt="${project.style} saved yard design">
        <div class="body">
          <strong>${project.name}</strong>
          <p class="muted">${new Date(project.createdAt).toLocaleDateString()} • ${project.budget || ''}</p>
          <div class="row">
            <button class="secondary open-btn">Open</button>
            <button class="secondary delete-btn">Delete</button>
          </div>
        </div>
      `;

      card.querySelector('.open-btn').onclick = () => {
        showView('design');
        $('beforeImg').src = project.before;
        $('afterImg').src = project.after;
        $('resultEmpty').classList.add('hidden');
        results = [{ url: project.after }];
        activeResult = 0;
        renderVariationTabs();
        $('estimateText').textContent = project.estimate || '—';
        renderPlan(project.features || []);
        $('saveProjectBtn').disabled = false;
        $('downloadBtn').disabled = false;
        $('compareRange').value = 50;
        updateSlider();
      };

      card.querySelector('.delete-btn').onclick = async () => {
        try {
          await api(`/api/projects/${project.id}`, { method: 'DELETE' });
          await renderProjects();
          toast('Design deleted');
        } catch (err) {
          toast(err.message || 'Could not delete design');
        }
      };

      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div class="notice">${err.message}</div>`;
  }
}

$('signupBtn').onclick = async () => {
  try {
    const d = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: $('signupName').value.trim(),
        email: $('signupEmail').value.trim(),
        password: $('signupPassword').value
      })
    });

    currentUser = d.user;
    currentUsage = d.usage;
    updateAuthUI();
    closeAuth();

    if (d.verificationPreviewUrl) {
      toast('Account created — opening local verification link');
      window.open(d.verificationPreviewUrl, '_blank');
    } else {
      toast('Account created — check your email to verify');
    }
  } catch (err) {
    toast(err.message || 'Could not create account');
  }
};

$('loginBtn').onclick = async () => {
  try {
    const d = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value
      })
    });

    currentUser = d.user;
    currentUsage = d.usage;
    updateAuthUI();
    closeAuth();
    toast('Signed in');
  } catch (err) {
    toast(err.message || 'Could not sign in');
  }
};

$('forgotBtn').onclick = async () => {
  try {
    const d = await api('/api/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email: $('forgotEmail').value.trim() })
    });
    closeAuth();
    toast(d.message || 'Reset link sent');
    if (d.previewUrl) window.open(d.previewUrl, '_blank');
  } catch (err) {
    toast(err.message || 'Could not send reset link');
  }
};

$('verifyEmailBtn').onclick = async () => {
  try {
    const d = await api('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (d.alreadyVerified) {
      toast('Email is already verified');
      return;
    }
    toast('Verification email sent');
    if (d.previewUrl) window.open(d.previewUrl, '_blank');
  } catch (err) {
    toast(err.message || 'Could not send verification');
  }
};

$('resetFromAccountBtn').onclick = async () => {
  if (!currentUser) return;
  try {
    const d = await api('/api/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email: currentUser.email })
    });
    toast(d.message || 'Reset link sent');
    if (d.previewUrl) window.open(d.previewUrl, '_blank');
  } catch (err) {
    toast(err.message || 'Could not send reset link');
  }
};

$('billingBtn').onclick = async () => {
  if (!currentUser) return openAuth('login');

  try {
    $('billingBtn').disabled = true;
    $('billingBtn').textContent = 'Opening billing…';

    const d = await api('/api/stripe/create-portal-session', {
      method: 'POST',
      body: JSON.stringify({})
    });

    if (!d.url) throw new Error('Stripe billing portal URL was not returned.');
    window.location.href = d.url;
  } catch (err) {
    toast(err.message || 'Could not open billing');
    $('billingBtn').disabled = false;
    $('billingBtn').textContent = 'Manage Billing';
  }
};

async function signOut() {
  try {
    await api('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({})
    });
    currentUser = null;
    currentUsage = null;
    updateAuthUI();
    renderProjects();
    showView('home');
    toast('Signed out');
  } catch (err) {
    toast(err.message || 'Could not sign out');
  }
}
$('logoutBtn').onclick = signOut;
$('headerLogoutBtn').onclick = signOut;

$('proBtn').onclick = async () => {
  if (!currentUser) {
    openAuth('login');
    return toast('Sign in first to start Pro checkout');
  }

  try {
    const d = await api('/api/stripe/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (d.url) window.location.href = d.url;
  } catch (err) {
    alert('Stripe setup message:\n\n' + (err.message || 'Stripe not ready'));
  }
};

async function handleUrlActions() {
  const params = new URLSearchParams(location.search);

  const verifyToken = params.get('verify');
  if (verifyToken) {
    try {
      const d = await api('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verifyToken })
      });
      if (currentUser) currentUser = d.user;
      await refreshSession();
      showView('account');
      toast('Email verified successfully');
      history.replaceState({}, '', location.pathname);
    } catch (err) {
      alert('Email verification error:\n\n' + err.message);
    }
  }

  const resetToken = params.get('reset');
  if (resetToken) {
    resetTokenFromUrl = resetToken;
    $('resetModal').classList.remove('hidden');
  }

  if (params.get('checkout') === 'success') {
    toast('Stripe checkout returned successfully');
    history.replaceState({}, '', location.pathname);
    setTimeout(refreshSession, 1000);
  }
  if (params.get('checkout') === 'cancel') {
    toast('Stripe checkout canceled');
    history.replaceState({}, '', location.pathname);
  }
  if (params.get('billing') === 'return') {
    await refreshSession();
    showView('account');
    toast('Billing information refreshed');
    history.replaceState({}, '', location.pathname);
  }
}

$('resetPasswordBtn').onclick = async () => {
  try {
    await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: resetTokenFromUrl,
        newPassword: $('resetPassword').value
      })
    });
    $('resetModal').classList.add('hidden');
    history.replaceState({}, '', location.pathname);
    resetTokenFromUrl = null;
    toast('Password updated — you can sign in now');
    openAuth('login');
  } catch (err) {
    toast(err.message || 'Could not reset password');
  }
};


async function loadReadiness() {
  const grid = $('readinessGrid');
  if (!grid) return;
  grid.innerHTML = '';
  $('statusOverall').textContent = 'Checking staging configuration…';

  try {
    const response = await fetch('/api/readiness', { credentials: 'same-origin' });
    const data = await response.json();
    const labels = {
      openai: 'OpenAI API',
      postgres: 'PostgreSQL',
      sessionSecret: 'Session Secret',
      email: 'Resend Email',
      storage: 'Cloud Storage',
      stripe: 'Stripe',
      verificationRequired: 'Email Verification',
      productionMode: 'Production Mode'
    };

    Object.entries(data.checks || {}).forEach(([key, ok]) => {
      const card = document.createElement('div');
      card.className = `readiness-card ${ok ? 'pass' : 'fail'}`;
      card.innerHTML = `
        <strong>${labels[key] || key}</strong>
        <span class="readiness-state">${ok ? 'READY' : 'NOT CONFIGURED'}</span>
      `;
      grid.appendChild(card);
    });

    $('statusOverall').textContent = data.ok
      ? '✅ Core staging services are ready.'
      : '⚠️ Staging is not fully configured yet. Connect the red services below.';
  } catch (err) {
    $('statusOverall').textContent = 'Could not load staging readiness.';
  }
}

if ($('refreshStatusBtn')) $('refreshStatusBtn').onclick = loadReadiness;

(async function init() {
  await checkHealth();
  await refreshSession();
  await handleUrlActions();
})();
