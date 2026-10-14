// The server's address under the logo, so it's clear which mStream this is.
document.getElementById('server-name').textContent = location.host;

// Sign-in through the server's OIDC provider (Authelia, …): a button beside
// the form, or instead of it when the server allows no password sign-in.
fetch('../api/v1/auth/oidc').then((r) => (r.ok ? r.json() : null)).then((o) => {
  if (!o || o.mode === 'off') { return; }
  document.getElementById('sso-label').textContent = 'Sign in with SSO';
  document.getElementById('sso').hidden = false;
  if (o.password === false) {
    for (const el of document.querySelectorAll('#login > .field, #form-submit, #login-error, #sso-or')) { el.hidden = true; }
    document.getElementById('sso-link').classList.add('primary');
  }
}).catch(() => {});

document.getElementById("login").addEventListener("submit", async e => {
  e.preventDefault();

  const button = document.getElementById("form-submit");
  const error = document.getElementById("login-error");
  button.disabled = true;
  error.textContent = '';

  try {
    const res = await axios({
      method: 'POST',
      url: `${API.url()}/api/v1/auth/login`,
      data: {
        username: document.getElementById('email').value,
        password: document.getElementById('password').value
      }
    });

    localStorage.setItem("token", res.data.token);

    window.location.assign(window.location.href.replace('/login', ''));
  } catch (err) {
    // Shown under the form (the page no longer loads a toast library).
    error.textContent = t('login.failed');
    document.getElementById('password').select();
    button.disabled = false;
  }
});
