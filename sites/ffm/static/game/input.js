// input.js — Input management for Math Fiend Slayer

export class InputManager {
  constructor(onAnswer) {
    this._onAnswer = onAnswer;
    this._enabled = false;
    this._answerInput = document.getElementById('answer-input');
    this._strikeBtn = document.getElementById('strike-btn');
    this._mcButtons = [...document.querySelectorAll('.mc-btn')];
    
    this._answerInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && this._enabled) {
        this._submit(this._answerInput.value);
      }
    });
    
    this._strikeBtn.addEventListener('click', () => {
      if (this._enabled) {
        this._submit(this._answerInput.value);
      }
    });
    
    this._mcButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (this._enabled) {
          this._submit(btn.textContent.trim());
        }
      });
    });
    
    document.addEventListener('keydown', e => {
      if (this._enabled && e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key) - 1;
        if (this._mcButtons[idx]) {
          this._submit(this._mcButtons[idx].textContent.trim());
        }
      }
    });
  }

  _submit(value) {
    if (!value || value.trim() === '') return;
    this._enabled = false;
    this._onAnswer(value.toString().trim());
  }

  enable(mode) {
    this._enabled = true;
    const isMC = mode === 'multiple-choice';
    document.getElementById('mc-buttons').style.display = isMC ? 'flex' : 'none';
    document.getElementById('free-text-zone').style.display = isMC ? 'none' : 'flex';
    if (!isMC) {
      this._answerInput.value = '';
      this._answerInput.focus();
    }
  }

  disable() {
    this._enabled = false;
    this._answerInput.value = '';
  }

  setMCOptions(options) {
    options.forEach((val, i) => {
      if (this._mcButtons[i]) {
        this._mcButtons[i].textContent = val;
      }
    });
  }
}
