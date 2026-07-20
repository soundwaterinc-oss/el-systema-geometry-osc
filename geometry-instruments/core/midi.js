// midi.js — thin Web MIDI helper shared by every instrument.
// Parses raw MIDI bytes into callbacks. No timing/BPM assumptions.

export class MidiHub {
  constructor() {
    this.access = null;
    this.inputs = [];
    this.current = null;
    this.handlers = { note: [], cc: [], pitch: [], aftertouch: [] };
  }

  on(type, fn) { this.handlers[type].push(fn); return this; }
  _emit(type, ...a) { for (const fn of this.handlers[type]) fn(...a); }

  async init(selectEl) {
    if (!navigator.requestMIDIAccess) {
      if (selectEl) selectEl.innerHTML = '<option>MIDI unsupported</option>';
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch (err) {
      // Permission denied or unavailable — the instrument still works via mouse/touch.
      if (selectEl) selectEl.innerHTML = '<option>MIDI blocked</option>';
      return false;
    }
    const refresh = () => {
      this.inputs = [...this.access.inputs.values()];
      if (selectEl) {
        selectEl.innerHTML = '';
        const none = document.createElement('option');
        none.value = ''; none.textContent = this.inputs.length ? '— select MIDI —' : 'no MIDI device';
        selectEl.appendChild(none);
        for (const inp of this.inputs) {
          const o = document.createElement('option');
          o.value = inp.id; o.textContent = inp.name;
          selectEl.appendChild(o);
        }
      }
    };
    refresh();
    this.access.onstatechange = refresh;
    if (selectEl) selectEl.onchange = () => this.select(selectEl.value);
    return true;
  }

  select(id) {
    for (const inp of this.inputs) inp.onmidimessage = null;
    this.current = this.inputs.find((i) => i.id === id) || null;
    if (this.current) this.current.onmidimessage = (e) => this._parse(e.data);
  }

  _parse(data) {
    const status = data[0] & 0xf0;
    const ch = data[0] & 0x0f;
    if (status === 0x90 && data[2] > 0) this._emit('note', data[1], data[2] / 127, true, ch);
    else if (status === 0x80 || (status === 0x90 && data[2] === 0)) this._emit('note', data[1], 0, false, ch);
    else if (status === 0xb0) this._emit('cc', data[1], data[2] / 127, ch);
    else if (status === 0xe0) this._emit('pitch', (((data[2] << 7) | data[1]) - 8192) / 8192, ch);
    else if (status === 0xd0) this._emit('aftertouch', data[1] / 127, ch);
    else if (status === 0xa0) this._emit('aftertouch', data[2] / 127, ch); // poly AT → mono
  }
}

// Start an AudioContext on first user gesture (autoplay policy).
export function armAudio(ctx, buttonEl) {
  const go = async () => {
    if (ctx.state !== 'running') await ctx.resume();
    if (buttonEl) buttonEl.classList.add('armed');
  };
  (buttonEl || document.body).addEventListener('pointerdown', go, { once: false });
  window.addEventListener('keydown', go, { once: true });
  return go;
}
