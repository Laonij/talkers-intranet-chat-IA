fetch('/api/me', { credentials: 'include' })
  .then((res) => {
    if (res.ok) {
      window.location.replace('/intranet.html');
    } else {
      window.location.replace('/login.html');
    }
  })
  .catch(() => {
    window.location.replace('/login.html');
  });
