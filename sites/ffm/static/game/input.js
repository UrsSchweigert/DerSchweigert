// input.js — Input management for Arithmo Slayer

export class InputManager {
  constructor(onAnswer) {
    this._onAnswer = onAnswer;
    this._enabled = false;
    this._mode = 'free-text';  // tracks whether MC shortcuts are active
    this._answerInput = document.getElementById('answer-input');
    this._strikeBtn = document.getElementById('strike-btn');
    this._mcContainer = document.getElementById('mc-buttons');
    this._mcButtons = [...this._mcContainer.querySelectorAll('.mc-btn')];
    
    this._answerInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && this._enabled) {
        this._submit(this._answerInput.value, this._answerInput);
      }
    });
    
    this._strikeBtn.addEventListener('click', () => {
      if (this._enabled) {
        this._submit(this._answerInput.value, this._strikeBtn);
      }
    });
    
    this._mcButtons.forEach(btn => this._bindMCButton(btn));

    // Where the last press landed, so answer feedback can erupt from the tap
    // instead of the middle of the screen. Keyboard submissions fall back to
    // the effect's own origin because a stale point is ignored.
    this._lastPress = null;
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('pointerdown', e => {
        this._lastPress = { x: e.clientX, y: e.clientY, time: performance.now() };
      }, { capture: true, passive: true });
    }

    document.addEventListener('keydown', e => {
      if (!this._enabled || this._mode !== 'multiple-choice') return;
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.target?.isContentEditable
        || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
      if (!/^\d$/.test(e.key)) return;
      // Match by label value so pressing '4' submits the button showing '4', not the 4th button
      const match = this._mcButtons.find(btn => btn.textContent.trim() === e.key);
      if (match) this._submit(match.textContent.trim(), match);
    });
    this._syncDisabled();
  }

  _syncDisabled() {
    this._answerInput.disabled = !this._enabled || this._mode === 'multiple-choice';
    this._strikeBtn.disabled = !this._enabled || this._mode === 'multiple-choice';
    for (const button of this._mcButtons) button.disabled = !this._enabled || this._mode !== 'multiple-choice';
    const focused = document.activeElement;
    if (focused?.disabled && (focused === this._answerInput || focused === this._strikeBtn
      || this._mcButtons.includes(focused))) focused.blur();
  }

  _bindMCButton(btn) {
    let secondarySubmitted = false;
    const submit = () => {
      if (this._enabled && this._mode === 'multiple-choice') this._submit(btn.textContent.trim(), btn);
    };
    btn.addEventListener('pointerdown', () => { secondarySubmitted = false; });
    btn.addEventListener('keydown', e => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    });
    // Secondary heal-hold touches do not synthesize clicks. Primary pointers,
    // keyboard Enter/Space and assistive activation use the native click path.
    btn.addEventListener('pointerup', e => {
      if (e.isPrimary !== false || (e.pointerType && e.pointerType !== 'touch')) return;
      secondarySubmitted = true;
      submit();
    });
    btn.addEventListener('click', e => {
      if (secondarySubmitted && e.detail > 0) return;
      submit();
    });
  }

  _freshPress() {
    const press = this._lastPress;
    if (!press) return null;
    if (typeof performance === 'undefined' || performance.now() - press.time > 1500) return null;
    return { x: press.x, y: press.y };
  }

  _elementRect(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return null;
    const rect = element.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return rect;
  }

  // Keyboard Enter/Space and assistive activation produce a click with no
  // pointerdown, so fall back to the centre of the control that fired it.
  _elementCentre(element) {
    const rect = this._elementRect(element);
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }

  _rectContains(rect, point) {
    return Boolean(rect && point
      && point.x >= rect.left && point.x <= rect.left + rect.width
      && point.y >= rect.top && point.y <= rect.top + rect.height);
  }

  // The press only describes this submission when it landed on the control that
  // fired it. A keyboard activation shortly after an unrelated tap would
  // otherwise inherit that tap and erupt from the wrong place on screen.
  _submit(value, source) {
    if (!value || value.trim() === '') return;
    this._enabled = false;
    this._syncDisabled();
    const press = this._freshPress();
    const rect = this._elementRect(source);
    const point = this._rectContains(rect, press)
      ? press
      : (this._elementCentre(source) || press);
    if (point) this._onAnswer(value.toString().trim(), point);
    else this._onAnswer(value.toString().trim());
  }

  enable(mode) {
    this._enabled = true;
    this._mode = mode;
    this._syncDisabled();
    const isMC = mode === 'multiple-choice';
    this._mcContainer.style.display = '';
    this._mcContainer.hidden = !isMC;
    const freeText = document.getElementById('free-text-zone');
    freeText.style.display = '';
    freeText.hidden = isMC;
    if (!isMC) {
      this._answerInput.value = '';
      if (document.activeElement) document.activeElement.blur();
      this._answerInput.focus();
    }
  }

  disable() {
    this._enabled = false;
    this._syncDisabled();
    this._answerInput.value = '';
  }

  setMCOptions(options) {
    while (this._mcButtons.length > options.length) {
      this._mcButtons.pop().remove();
    }
    while (this._mcButtons.length < options.length) {
      const btn = document.createElement('button');
      btn.className = 'mc-btn';
      btn.type = 'button';
      btn.disabled = !this._enabled || this._mode !== 'multiple-choice';
      btn.setAttribute('touch-action', 'manipulation');
      this._bindMCButton(btn);
      this._mcContainer.appendChild(btn);
      this._mcButtons.push(btn);
    }
    this._mcContainer.dataset.optionCount = String(options.length);
    options.forEach((val, i) => {
      this._mcButtons[i].dataset.index = String(i);
      this._mcButtons[i].textContent = String(val);
    });
    this._syncDisabled();
  }
}
