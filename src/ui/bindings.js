export function bindRange(input, output, { format = (value) => String(value), onChange = null } = {}) {
  const sync = () => {
    const value = Number(input.value);
    if (output) output.textContent = format(value);
    if (onChange) onChange(value, input);
  };

  input.addEventListener("input", sync);
  sync();
  return sync;
}

export function bindSelect(select, output, { format = (value) => String(value), onChange = null } = {}) {
  const sync = () => {
    const value = select.value;
    if (output) output.textContent = format(value);
    if (onChange) onChange(value, select);
  };

  select.addEventListener("change", sync);
  sync();
  return sync;
}

export function bindButton(button, onClick) {
  button.addEventListener("click", onClick);
  return () => button.removeEventListener("click", onClick);
}

export function bindButtonGroup(container, { selector = "button[data-preset]", activeClass = "is-active", onSelect = null } = {}) {
  const buttons = [...container.querySelectorAll(selector)];

  const setActive = (value) => {
    for (const button of buttons) {
      const buttonValue = button.dataset.preset ?? button.dataset.value ?? button.value ?? "";
      button.classList.toggle(activeClass, buttonValue === value);
    }
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset.preset ?? button.dataset.value ?? button.value ?? "";
      setActive(value);
      if (onSelect) onSelect(value, button);
    });
  }

  return { buttons, setActive };
}

export function bindFileInput(input, onFile) {
  input.addEventListener("change", () => {
    const file = input.files && input.files[0] ? input.files[0] : null;
    if (file) onFile(file);
  });
}
