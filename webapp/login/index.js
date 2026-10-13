// The server's address under the logo, so it's clear which mStream this is.
document.getElementById('server-name').textContent = location.host;

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
