document.addEventListener('DOMContentLoaded', () => {
  const PIN = '3009';
  const STORAGE_KEY = 'derschweigert_pin_ok';

  const unlocked = localStorage.getItem(STORAGE_KEY) === 'true';

  if (!unlocked) {
    const overlay = document.createElement('div');
    overlay.id = 'pin-lock-overlay';
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="pin-lock-backdrop"></div>
      <div class="pin-lock-box">
        <h2>Seite gesperrt</h2>
        <p>Bitte geben Sie den PIN ein, um die Seite zu öffnen.</p>
        <form id="pin-lock-form">
          <input type="password" name="pin" placeholder="PIN eingeben" autocomplete="one-time-code" required />
          <button type="submit">Freischalten</button>
        </form>
        <div class="pin-lock-error" aria-live="polite"></div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #pin-lock-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        background: rgba(10, 47, 95, 0.28);
        backdrop-filter: blur(8px);
      }
      .pin-lock-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(15, 32, 54, 0.28);
      }
      .pin-lock-box {
        position: relative;
        width: min(420px, calc(100% - 32px));
        background: #ffffff;
        border-radius: 22px;
        box-shadow: 0 24px 56px rgba(10, 47, 95, 0.2);
        padding: 28px 24px;
        color: #14253d;
      }
      .pin-lock-box h2 {
        margin: 0 0 10px;
        font-size: 2rem;
        letter-spacing: -0.05em;
      }
      .pin-lock-box p {
        margin: 0 0 18px;
        color: #49607c;
      }
      .pin-lock-box input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(20, 37, 61, 0.12);
        border-radius: 12px;
        padding: 14px 16px;
        font-size: 1.05rem;
        margin-bottom: 12px;
      }
      .pin-lock-box button {
        width: 100%;
        border: none;
        border-radius: 12px;
        padding: 14px 16px;
        background: linear-gradient(135deg, #0f4c81, #0a2f5f);
        color: #fff;
        font-weight: 700;
        cursor: pointer;
      }
      .pin-lock-error {
        min-height: 20px;
        margin-top: 12px;
        font-weight: 600;
        color: #8d1f1f;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    const form = overlay.querySelector('#pin-lock-form');
    const error = overlay.querySelector('.pin-lock-error');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = new FormData(form).get('pin')?.toString().trim();
      if (value === PIN) {
        localStorage.setItem(STORAGE_KEY, 'true');
        overlay.remove();
        style.remove();
        return;
      }
      error.textContent = 'Falscher PIN. Bitte erneut versuchen.';
    });

    return;
  }

  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  const status = document.querySelector('[data-contact-status]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      status.textContent = data.detail || 'Please review your details and try again.';
      status.classList.add('visible');
      return;
    }

    form.reset();
    status.textContent = data.message || 'Message sent.';
    status.classList.add('visible');
  });
});
