const reason = new URLSearchParams(location.search).get('error');
if (reason) {
  const error = document.getElementById('error');
  error.textContent =
    reason === 'locked'
      ? 'Too many wrong passwords. Wait 15 minutes, then try again.'
      : 'That password didn’t match. Try again.';
  error.hidden = false;
  document.getElementById('password').setAttribute('aria-invalid', 'true');
}
